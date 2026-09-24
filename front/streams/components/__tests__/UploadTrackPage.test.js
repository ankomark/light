import React from 'react';

// Full renders of a big form: slow on this machine under a parallel run.
jest.setTimeout(20000);
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

const mockEnqueue = jest.fn();
const mockCreateAlbum = jest.fn(async ({ title }) => ({ id: 77, title }));
const mockGoBack = jest.fn();
const mockPick = jest.fn();
let mockParams = {};

jest.mock('expo-document-picker', () => ({ getDocumentAsync: (...a) => mockPick(...a) }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn(), MediaTypeOptions: { Images: 'Images' } }));
jest.mock('expo-file-system/legacy', () => ({ getInfoAsync: async () => ({ size: 4 * 1024 * 1024 }) }));
jest.mock('../../services/audioPlayer', () => ({ createSound: jest.fn(), measureDurationMs: async () => 200000 }));
jest.mock('../../services/imageProcessing', () => ({ compressImage: jest.fn() }));
jest.mock('../../services/uploadQueue', () => ({ enqueueUpload: (job) => mockEnqueue(job) }));
jest.mock('../../services/api', () => ({
  createAlbum: (d) => mockCreateAlbum(d),
  fetchAlbums: async () => [{ id: 5, title: 'Tenzi Vol 1', track_count: 8 }],
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack, addListener: () => () => {}, dispatch: jest.fn() }),
  useRoute: () => ({ params: mockParams }),
}));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) };
});
jest.mock('react-native-get-random-values', () => ({}));
jest.mock('../GenrePicker', () => () => null);
jest.mock('../RotatingBackground', () => () => null);
jest.mock('../../hooks/useKeyboardHeight', () => () => 0);
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@expo/vector-icons', () => ({ Feather: () => null, MaterialIcons: () => null, Ionicons: () => null }));
jest.mock('../../context/I18nContext', () => ({
  useI18n: () => ({ t: (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k) }),
}));

const UploadTrackPage = require('../UploadTrackPage').default;

const files = (...names) => ({
  canceled: false,
  assets: names.map((name) => ({ uri: `file:///${name}`, name, mimeType: 'audio/mpeg' })),
});

beforeEach(() => {
  mockEnqueue.mockClear(); mockCreateAlbum.mockClear(); mockGoBack.mockClear(); mockPick.mockReset();
  mockParams = {};
});

test('several files become an album upload: numbered titles, a new album, one job per song in order', async () => {
  // Picked out of order; the file names put them in album order.
  mockPick.mockResolvedValue(files('10 - Kumi.mp3', '02 - Mbili.mp3', '01 - Moja.mp3'));
  const r = render(<UploadTrackPage />);
  await act(async () => { fireEvent.press(r.getByText('track.upload.pickAudio')); });
  await waitFor(() => expect(r.getByText('upload.batch.title:3')).toBeTruthy());
  expect(mockPick.mock.calls[0][0].multiple).toBe(true);
  expect(r.getByLabelText('upload.batch.songTitle:1').props.value).toBe('Moja');
  expect(r.getByLabelText('upload.batch.songTitle:3').props.value).toBe('Kumi');

  // Rename one, move "Kumi" up to second, drop nothing.
  fireEvent.changeText(r.getByLabelText('upload.batch.songTitle:2'), 'Mbili (Live)');
  fireEvent.press(r.getAllByLabelText('upload.batch.moveUp')[2]);

  await waitFor(() => expect(r.getByText('upload.album.new')).toBeTruthy());
  fireEvent.press(r.getByText('upload.album.new'));
  fireEvent.changeText(r.getByPlaceholderText('upload.album.newPlaceholder'), 'Tenzi Vol 2');
  fireEvent.press(r.getByText('rights.confirmMany'));
  await act(async () => { fireEvent.press(r.getByText('upload.batch.share:3')); });

  expect(mockCreateAlbum).toHaveBeenCalledWith({ title: 'Tenzi Vol 2' });
  const snaps = mockEnqueue.mock.calls.map(([job]) => job.snap);
  expect(snaps.map((s) => [s.title, s.albumId, s.trackNumber])).toEqual([
    ['Moja', 77, 1], ['Kumi', 77, 2], ['Mbili (Live)', 77, 3],
  ]);
  expect(snaps.every((s) => s.rightsConfirmed && s.album === 'Tenzi Vol 2' && s.rights.isrc === '')).toBe(true);
  expect(mockGoBack).toHaveBeenCalled();
});

test('opened from an album: that album is chosen and one song goes last on it', async () => {
  mockParams = { albumId: 5 };
  mockPick.mockResolvedValue(files('Amazing_Grace.mp3'));
  const r = render(<UploadTrackPage />);
  await act(async () => { fireEvent.press(r.getByText('track.upload.pickAudio')); });
  await waitFor(() => expect(r.getByDisplayValue('Amazing Grace')).toBeTruthy());
  await waitFor(() => expect(r.getByText('Tenzi Vol 1').parent).toBeTruthy());
  fireEvent.press(r.getByText('rights.confirm'));
  await act(async () => { fireEvent.press(r.getByText('track.upload.share')); });
  expect(mockCreateAlbum).not.toHaveBeenCalled();
  const [{ snap }] = mockEnqueue.mock.calls[0];
  expect([snap.title, snap.albumId, snap.trackNumber, snap.album]).toEqual(['Amazing Grace', 5, null, 'Tenzi Vol 1']);
});

test('a batch without titles for every song does not upload', async () => {
  mockPick.mockResolvedValue(files('01 - A.mp3', '02 - B.mp3'));
  const r = render(<UploadTrackPage />);
  await act(async () => { fireEvent.press(r.getByText('track.upload.pickAudio')); });
  await waitFor(() => expect(r.getByText('upload.batch.title:2')).toBeTruthy());
  fireEvent.changeText(r.getByLabelText('upload.batch.songTitle:2'), '  ');
  fireEvent.press(r.getByText('rights.confirmMany'));
  await act(async () => { fireEvent.press(r.getByText('upload.batch.share:2')); });
  expect(mockEnqueue).not.toHaveBeenCalled();
  // Taking the untitled one out leaves one song: the single-song form again.
  fireEvent.press(r.getAllByLabelText('upload.batch.remove')[1]);
  expect(r.getByText('track.upload.title')).toBeTruthy();
  expect(r.getByDisplayValue('A')).toBeTruthy();
});
