/**
 * What is trimmed off a video never reaches our storage. Where the phone's
 * build can't cut (no native trim module), a clip that needs cutting is
 * refused — never uploaded whole — for posts and stories alike.
 */
jest.mock('react-native-video-trim', () => { throw new Error('not in this build'); });
jest.mock('expo-image-manipulator', () => ({ SaveFormat: { JPEG: 'jpeg' }, manipulateAsync: jest.fn() }));
jest.mock('expo-file-system/legacy', () => ({ getInfoAsync: jest.fn(async () => ({ size: 1 })) }));
jest.mock('../cloudinary', () => ({ uploadMedia: jest.fn(async () => ({ url: 'https://r2/x' })) }));
jest.mock('../api', () => ({ createSocialPost: jest.fn(), createStory: jest.fn(), apiRequest: jest.fn() }));
jest.mock('../audioProcessing', () => ({ compressAudio: jest.fn() }));

const { needsCut, processVideo, isVideoProcessingAvailable } = require('../videoProcessing');
const { buildPostJob, buildStoryJob } = require('../postUploads');
const { uploadMedia } = require('../cloudinary');
const { createSocialPost, createStory } = require('../api');

const ctx = () => ({ progress: jest.fn(), stage: jest.fn(), thumbnail: jest.fn() });

beforeEach(() => jest.clearAllMocks());

test('needsCut: anything off the start or the end, or an unknown length', () => {
  expect(needsCut({ startSec: 0, endSec: 20, durationSec: 20 })).toBe(false);     // the whole clip
  expect(needsCut({ startSec: 0, endSec: 19.9, durationSec: 20 })).toBe(false);   // within the slack
  expect(needsCut({ startSec: 5, endSec: 20, durationSec: 20 })).toBe(true);
  expect(needsCut({ startSec: 0, endSec: 12, durationSec: 20 })).toBe(true);
  expect(needsCut({ startSec: 0, endSec: 12, durationSec: 0 })).toBe(true);       // unknown: assume yes
});

test('without the trim module, a clip that needs cutting is refused, not passed through', async () => {
  expect(isVideoProcessingAvailable()).toBe(false);
  await expect(processVideo({ uri: 'file:///raw.mp4', startSec: 10, endSec: 20, durationSec: 60 }))
    .rejects.toMatchObject({ code: 'trim_unavailable' });
  // The whole clip, nothing to cut: it may go as it is.
  await expect(processVideo({ uri: 'file:///raw.mp4', startSec: 0, endSec: 20, durationSec: 20 }))
    .resolves.toMatchObject({ uri: 'file:///raw.mp4', processed: false });
});

test('a story that needs cutting uploads nothing at all on such a phone', async () => {
  await expect(buildStoryJob({
    caption: 'x', video: { uri: 'file:///raw.mp4', duration: 60000 }, trim: { start: 10, end: 25 },
  })(ctx())).rejects.toMatchObject({ code: 'trim_unavailable' });
  expect(uploadMedia).not.toHaveBeenCalled();
  expect(createStory).not.toHaveBeenCalled();
});

test('a post that needs cutting uploads nothing at all on such a phone', async () => {
  await expect(buildPostJob({
    contentType: 'video', caption: 'x', video: { uri: 'file:///raw.mp4', duration: 90000 }, trim: { start: 0, end: 30 },
  })(ctx())).rejects.toMatchObject({ code: 'trim_unavailable' });
  expect(uploadMedia).not.toHaveBeenCalled();
  expect(createSocialPost).not.toHaveBeenCalled();
});
