import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * True when the OS "reduce motion" accessibility setting is on. Use it to skip
 * looping/decorative animations (pulses, shimmers, drifting reactions) so the
 * UI respects users who are sensitive to motion.
 */
export default function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((v) => { if (mounted) setReduced(!!v); })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v) => setReduced(!!v));
    return () => { mounted = false; sub?.remove?.(); };
  }, []);
  return reduced;
}
