// A short line at the foot of the screen — "Added to cart", "Only 2 left" —
// in place of an alert box the buyer has to dismiss before carrying on.
//
//   const [toast, showToast] = useMarketToast();
//   showToast('Added to cart');            // or showToast(text, { error: true })
//   return (<>…{toast}</>);
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, AccessibilityInfo } from 'react-native';

export default function useMarketToast() {
  const [message, setMessage] = useState(null);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const show = useCallback((text, { error = false, ms = 2400 } = {}) => {
    if (!text) return;
    clearTimeout(timer.current);
    setMessage({ text, error });
    AccessibilityInfo.announceForAccessibility?.(text);
    timer.current = setTimeout(() => setMessage(null), ms);
  }, []);

  const node = message ? (
    <View style={styles.wrap} pointerEvents="none" testID="market-toast">
      <View style={[styles.toast, message.error && styles.error]}>
        <Text style={styles.text}>{message.text}</Text>
      </View>
    </View>
  ) : null;

  return [node, show];
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 28, alignItems: 'center', zIndex: 50 },
  toast: {
    maxWidth: '88%', paddingHorizontal: 18, paddingVertical: 11, borderRadius: 22,
    backgroundColor: 'rgba(10,22,40,0.95)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,196,107,0.5)',
  },
  error: { borderColor: 'rgba(255,99,71,0.8)' },
  text: { color: '#FFFFFF', fontSize: 14, textAlign: 'center' },
});
