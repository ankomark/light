// Where the viewer is, for "near me" in Services: the phone's location (if
// they allow it, and the app build has it), or a town they pick (found by
// name — the same free place search the Weather page uses). Remembered, so
// the next visit is near them at once.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { searchPlaces } from './weather';

const KEY = 'services:near:v1';
let kept;                                   // undefined: not read yet

/** The place last used: { lat, lng, label, mine?: true } or null. */
export const keptPlace = async () => {
  if (kept === undefined) {
    try { kept = JSON.parse(await AsyncStorage.getItem(KEY)) || null; } catch { kept = null; }
  }
  return kept;
};
export const peekPlace = () => (kept === undefined ? null : kept);

export const keepPlace = async (place) => {
  kept = place || null;
  try {
    if (kept) await AsyncStorage.setItem(KEY, JSON.stringify(kept));
    else await AsyncStorage.removeItem(KEY);
  } catch { /* best effort */ }
  return kept;
};

/** The phone's location → { lat, lng, mine: true }. Throws 'denied' (they
 *  said no) or 'unavailable' (no location on this build / device / web). */
export const hereNow = async () => {
  let Location;
  try {
    Location = require('expo-location');
  } catch {
    throw new Error('unavailable');
  }
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') throw new Error('denied');
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy?.Balanced ?? 3 });
    return { lat: pos.coords.latitude, lng: pos.coords.longitude, mine: true };
  } catch (e) {
    throw new Error(e?.message === 'denied' ? 'denied' : 'unavailable');
  }
};

/** Towns and places by name → [{ label, lat, lng }]. */
export const findPlaces = async (query, language = 'en') => {
  const rows = await searchPlaces(query, language);
  return rows.map((r) => ({
    label: [r.name, r.region, r.country].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(', '),
    lat: r.latitude, lng: r.longitude,
  }));
};

export const pointParam = (place) => (place ? `${place.lat.toFixed(4)},${place.lng.toFixed(4)}` : null);

export const __resetServiceLocation = () => { kept = undefined; };
