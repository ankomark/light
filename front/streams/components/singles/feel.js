// A light touch under the thumb for Interested, a fuller one for a match.
// expo-haptics is in the build already (Bible reader, camera); never fails
// the action it accompanies.
let Haptics = null;
try {
  Haptics = require('expo-haptics');
} catch {
  Haptics = null;
}

export const tap = () => {
  try { Haptics?.impactAsync?.(Haptics.ImpactFeedbackStyle?.Light)?.catch?.(() => {}); } catch { /* none */ }
};

export const celebrate = () => {
  try { Haptics?.notificationAsync?.(Haptics.NotificationFeedbackType?.Success)?.catch?.(() => {}); } catch { /* none */ }
};
