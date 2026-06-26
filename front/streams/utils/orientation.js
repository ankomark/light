// Crash-proof wrapper around expo-screen-orientation.
//
// The ExpoScreenOrientation *native* module only exists in a custom dev/production
// build (not Expo Go), and an out-of-date build may lack it entirely if it was
// compiled before the package was added. Calling a missing native method throws
// *synchronously*, which a bare `.catch()` at the call site would NOT swallow —
// so it can crash the app. These helpers swallow that case and no-op, making
// orientation locking strictly best-effort.
//
// The JS import below is always safe (it's a normal node_modules package); only
// the native method calls can throw, which is why each is wrapped in try/catch.
import * as ScreenOrientation from 'expo-screen-orientation';

export const lockPortrait = async () => {
  try {
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
  } catch {
    /* native module unavailable (Expo Go or a stale build) — ignore */
  }
};

export const unlockOrientation = async () => {
  try {
    await ScreenOrientation.unlockAsync();
  } catch {
    /* native module unavailable — ignore */
  }
};
