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

// Full sensor-driven rotation in all orientations. Unlike unlockAsync()
// (SCREEN_ORIENTATION_UNSPECIFIED, which obeys the phone's auto-rotate toggle and
// makes Android pop a manual "rotate" suggestion icon), OrientationLock.ALL maps
// to SCREEN_ORIENTATION_FULL_SENSOR — the screen flips automatically with the
// device regardless of the system auto-rotate setting, like a TikTok live.
export const allowAllOrientations = async () => {
  try {
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.ALL);
  } catch {
    /* native module unavailable (Expo Go or a stale build) — ignore */
  }
};
