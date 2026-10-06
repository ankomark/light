// An event banner from the photo library, kept at its own shape - portrait or
// landscape - as the home feed keeps photos: every screen now draws a banner
// at its true width:height (TicketKit: bannerRatio). It was forced to a 4:5
// crop (and on iOS, which ignores the aspect, to a square), so a landscape
// flyer lost its sides. Shrunk to 1600 px wide before it goes up - the
// ticketing guide's advice, as it cuts the upload on mobile data. Shared by
// creating and editing an event.
import * as ImagePicker from 'expo-image-picker';
import { compressImage } from '../../services/imageProcessing';

const MAX_WIDTH = 1600;

export class BannerPermissionError extends Error {}

/** `{ uri, width, height }` of a local JPEG, or null when nothing was chosen. */
export const pickBanner = async () => {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (perm.status !== 'granted') throw new BannerPermissionError('photos');
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'], allowsEditing: false, quality: 1,
  });
  const asset = !res.canceled && res.assets?.[0];
  if (!asset) return null;
  const out = await compressImage(asset.uri, { maxWidth: MAX_WIDTH, sourceWidth: asset.width, quality: 0.85 });
  return { uri: out.uri, width: out.width, height: out.height };
};
