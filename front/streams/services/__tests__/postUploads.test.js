/**
 * The post/track upload jobs, with the network and native processing mocked.
 * What's pinned: files upload in parallel, the post payload the server
 * receives is exactly what the old inline code sent, and progress only moves
 * forward and ends at 100%.
 */
jest.mock('../cloudinary', () => ({ uploadMedia: jest.fn() }));
jest.mock('../api', () => ({ createSocialPost: jest.fn(), apiRequest: jest.fn() }));
jest.mock('../videoProcessing', () => ({
  processVideo: jest.fn(), cleanupProcessedVideos: jest.fn(),
}));
jest.mock('../audioProcessing', () => ({ compressAudio: jest.fn() }));

import { uploadMedia } from '../cloudinary';
import { createSocialPost, apiRequest } from '../api';
import { processVideo } from '../videoProcessing';
import { compressAudio } from '../audioProcessing';
import { buildPostJob, buildTrackJob, combinedProgress } from '../postUploads';

const ctx = () => {
  const seen = [];
  return {
    seen,
    progress: (p) => seen.push(p),
    stage: jest.fn(),
    thumbnail: jest.fn(),
  };
};

beforeEach(() => {
  jest.clearAllMocks();
  let n = 0;
  uploadMedia.mockImplementation(async (file, type, onProgress) => {
    onProgress?.(0.5);
    onProgress?.(1);
    n += 1;
    return { url: `https://r2/${type}/${n}`, publicId: `https://r2/${type}/${n}` };
  });
  createSocialPost.mockImplementation(async (data) => ({ id: 99, ...data }));
  apiRequest.mockImplementation(async (_m, _u, data) => ({ id: 5, ...data }));
});

describe('combinedProgress', () => {
  it('weights parts and maps onto a span', () => {
    const out = [];
    const [a, b] = combinedProgress((p) => out.push(p), [3, 1], [0.2, 1]);
    a(1);            // 3/4 of the work done
    expect(out.pop()).toBeCloseTo(0.2 + 0.8 * 0.75);
    b(1);
    expect(out.pop()).toBeCloseTo(1);
  });
});

describe('image post', () => {
  it('uploads every image at once and sends the gallery payload', async () => {
    const started = [];
    uploadMedia.mockImplementation((file) => new Promise((resolve) => {
      started.push(file.uri);
      setTimeout(() => resolve({ url: `https://r2/${file.uri}` }), 5);
    }));
    const c = ctx();
    const job = buildPostJob({
      contentType: 'image',
      caption: '  hello  ',
      images: [
        { uri: 'a.jpg', width: 1080, height: 1350 },
        { uri: 'b.jpg', width: 1080, height: 1080 },
      ],
    });
    const promise = job(c);
    await new Promise((r) => setTimeout(r, 0));
    expect(started).toEqual(['a.jpg', 'b.jpg']);   // both in flight before either finished
    const created = await promise;

    expect(createSocialPost).toHaveBeenCalledWith({
      caption: 'hello',
      content_type: 'image',
      media_file: 'https://r2/a.jpg',
      width: 1080,
      height: 1350,
      gallery: [
        { public_id: 'https://r2/a.jpg', width: 1080, height: 1350 },
        { public_id: 'https://r2/b.jpg', width: 1080, height: 1080 },
      ],
    });
    expect(created.id).toBe(99);
  });

  it('attaches a library song with its trim window', async () => {
    await buildPostJob({
      contentType: 'image', caption: 'c',
      images: [{ uri: 'a.jpg', width: 1, height: 1 }],
      song: { title: 'Amazing Grace', artist: 'Choir', audioUrl: 'https://r2/song.mp3', songId: 12, start: 10.123, end: 40 },
    })(ctx());
    expect(createSocialPost.mock.calls[0][0]).toMatchObject({
      song_audio_url: 'https://r2/song.mp3', song_title: 'Amazing Grace',
      song_artist: 'Choir', song_start_time: 10.12, song_end_time: 40, song_id: 12,
    });
  });

  it('compresses and uploads a local song, and never sends song_id for it', async () => {
    compressAudio.mockResolvedValue({ uri: 'small.m4a', compressed: true });
    await buildPostJob({
      contentType: 'image', caption: 'c',
      images: [{ uri: 'a.jpg', width: 1, height: 1 }],
      song: { title: 'Mine', artist: 'Local File', start: 0, end: 30, localAudio: { uri: 'big.mp3', name: 'big.mp3' } },
    })(ctx());
    const audioCall = uploadMedia.mock.calls.find((call) => call[1] === 'audio');
    expect(audioCall[0].uri).toBe('small.m4a');
    expect(audioCall[0].mimeType).toBe('audio/mp4');
    const sent = createSocialPost.mock.calls[0][0];
    expect(sent.song_audio_url).toMatch(/^https:\/\/r2\/audio\//);
    expect(sent).not.toHaveProperty('song_id');
  });
});

describe('video post', () => {
  it('processes, uploads clip + poster, and reports the poster as thumbnail', async () => {
    processVideo.mockResolvedValue({ uri: 'cut.mp4', processed: true, thumbnailUri: 'poster.jpg' });
    const c = ctx();
    await buildPostJob({
      contentType: 'video', caption: 'v',
      video: { uri: 'raw.mp4', width: 720, height: 1280, duration: 60000 },
      trim: { start: 5, end: 20.4 },
    })(c);
    expect(processVideo).toHaveBeenCalledWith(expect.objectContaining({ uri: 'raw.mp4', startSec: 5, endSec: 20.4 }));
    expect(c.thumbnail).toHaveBeenCalledWith('poster.jpg');
    const sent = createSocialPost.mock.calls[0][0];
    expect(sent).toMatchObject({ content_type: 'video', width: 720, height: 1280, duration: 15 });
    expect(sent.media_file).toMatch(/social-video/);
    expect(sent.thumbnail).toMatch(/social-image/);
  });

  it('still posts when the poster upload fails', async () => {
    processVideo.mockResolvedValue({ uri: 'cut.mp4', processed: true, thumbnailUri: 'poster.jpg' });
    uploadMedia.mockImplementation(async (file, type) => {
      if (type === 'social-image') throw new Error('poster boom');
      return { url: 'https://r2/clip.mp4' };
    });
    await buildPostJob({
      contentType: 'video', caption: 'v',
      video: { uri: 'raw.mp4', width: 720, height: 1280 }, trim: { start: 0, end: 10 },
    })(ctx());
    expect(createSocialPost.mock.calls[0][0]).not.toHaveProperty('thumbnail');
  });

  it('only moves progress forward and ends at 1', async () => {
    processVideo.mockResolvedValue({ uri: 'cut.mp4', processed: true, thumbnailUri: null });
    const c = ctx();
    await buildPostJob({
      contentType: 'video', caption: '', video: { uri: 'raw.mp4' }, trim: { start: 0, end: 10 },
    })(c);
    for (let i = 1; i < c.seen.length; i++) expect(c.seen[i]).toBeGreaterThanOrEqual(c.seen[i - 1]);
    expect(c.seen[c.seen.length - 1]).toBe(1);
  });
});

describe('track upload', () => {
  it('compresses audio, uploads audio + cover, and creates the track via apiRequest', async () => {
    compressAudio.mockResolvedValue({ uri: 'small.m4a', compressed: true });
    const track = await buildTrackJob({
      title: 'Hymn', album: '', lyrics: 'la',
      audio: { uri: 'big.wav', name: 'big.wav', mimeType: 'audio/wav' },
      cover: { uri: 'cover.jpg', mimeType: 'image/jpeg' },
    })(ctx());
    expect(uploadMedia.mock.calls.map((c) => c[1]).sort()).toEqual(['audio', 'cover']);
    expect(apiRequest).toHaveBeenCalledWith('post', '/tracks/upload/', {
      title: 'Hymn',
      audio_file: expect.stringMatching(/audio/),
      cover_image: expect.stringMatching(/cover/),
      album: null,
      lyrics: 'la',
    });
    expect(track.id).toBe(5);
  });
});
