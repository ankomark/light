// Save a downloaded song into the phone's own music library, without the
// "Allow this app to modify this file?" prompt on every save.
//
// Why that prompt used to appear: the old code saved the song, then MOVED it
// into a "Music Downloads" album. On Android 10+ moving an item that's
// already in the media library is a modification, so the system asked for
// consent every single time (and the move then failed with
// "need WRITE_EXTERNAL_STORAGE"). Creating a file is different — a file the
// app creates is its own, so no consent is needed. So:
//   - the first save creates the album *from* the song (no move);
//   - later saves create the song directly inside the album, whose id is
//     remembered so we never have to read the user's library to find it.
// Permission is write-only for audio: on Android 10+ that needs no dialog at
// all; on older Android it's asked once and the system remembers it.
//
// iOS keeps no music files in its media library (Photos only takes images and
// video), so there the song goes to the share sheet — "Save to Files".
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';

export const ALBUM_NAME = 'Music Downloads';
const ALBUM_KEY = '@savetophone:albumId';

const ensureWritePermission = async () => {
  try {
    const current = await MediaLibrary.getPermissionsAsync(true, ['audio']);
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    const asked = await MediaLibrary.requestPermissionsAsync(true, ['audio']);
    return asked.granted;
  } catch {
    // A build without the permission declared: on Android 10+ an app may add
    // its own new files without any permission, so try the save anyway.
    return true;
  }
};

/**
 * Put the local file `fileUri` (file:///…, with its extension) into the
 * phone's music. Resolves with 'library' (Android media library) or 'shared'
 * (iOS share sheet); throws with a readable message on failure.
 */
export const saveToPhone = async (fileUri) => {
  if (Platform.OS !== 'android') {
    if (!(await Sharing.isAvailableAsync())) throw new Error('Saving is not available on this device.');
    await Sharing.shareAsync(fileUri);
    return 'shared';
  }

  if (!(await ensureWritePermission())) {
    throw new Error('Allow storage access in Settings to save songs to your phone.');
  }

  // Into the remembered album, created in place (no move → no prompt).
  const albumId = await AsyncStorage.getItem(ALBUM_KEY).catch(() => null);
  if (albumId) {
    try {
      await MediaLibrary.createAssetAsync(fileUri, albumId);
      return 'library';
    } catch {
      // The album was deleted from the phone — make it again below.
      await AsyncStorage.removeItem(ALBUM_KEY).catch(() => {});
    }
  }

  try {
    // First save: the song itself becomes the album's first item.
    const album = await MediaLibrary.createAlbumAsync(ALBUM_NAME, undefined, undefined, fileUri);
    if (album?.id) await AsyncStorage.setItem(ALBUM_KEY, String(album.id)).catch(() => {});
    return 'library';
  } catch {
    // No album on this device/version — the song still lands in Music.
    await MediaLibrary.createAssetAsync(fileUri);
    return 'library';
  }
};
