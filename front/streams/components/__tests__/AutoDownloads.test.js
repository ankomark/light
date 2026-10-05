/**
 * Smart downloads: liked songs are saved on Wi-Fi only, skipping what is
 * already on the phone and anything without audio.
 */
const mockNetwork = { type: 'wifi' };
jest.mock('../../services/playReporter', () => ({ currentNetwork: () => mockNetwork.type }));
const mockLiked = jest.fn();
jest.mock('../../services/api', () => ({ getFavoriteTracks: (...a) => mockLiked(...a) }));
const mockDownload = jest.fn(async () => ({}));
const mockHave = new Set();
jest.mock('../../utils/downloads', () => ({
  downloadTrack: (...a) => mockDownload(...a),
  isDownloaded: (id) => mockHave.has(id),
}));

const { downloadLiked } = require('../AutoDownloads');

beforeEach(() => { mockDownload.mockClear(); mockLiked.mockReset(); mockHave.clear(); mockNetwork.type = 'wifi'; });

test('on Wi-Fi: the liked songs not on the phone yet, one after another', async () => {
  mockHave.add(2);
  mockLiked.mockResolvedValue([{ id: 1, audio_file: 'a' }, { id: 2, audio_file: 'b' }, { id: 3 }, { id: 4, audio_file: 'd' }]);
  expect(await downloadLiked({ quality: 'high' })).toBe(2);
  expect(mockDownload.mock.calls.map((c) => c[0].id)).toEqual([1, 4]);
  expect(mockDownload.mock.calls[0][1]).toMatchObject({ quality: 'high', wifiOnly: true });
});

test('on mobile data: nothing at all', async () => {
  mockNetwork.type = 'cellular';
  mockLiked.mockResolvedValue([{ id: 1, audio_file: 'a' }]);
  expect(await downloadLiked()).toBe(0);
  expect(mockLiked).not.toHaveBeenCalled();         // not even the list
  expect(mockDownload).not.toHaveBeenCalled();
});
