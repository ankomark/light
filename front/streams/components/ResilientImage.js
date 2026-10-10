/**
 * An image that never sits as a black box while the person is online.
 *
 * - Drawn on the app's navy with a faint picture mark until it paints, and
 *   with the small preview (the server's 640px still) first when there is one.
 * - A failed load is tried again by itself — after 1 s, 3 s, then 8 s — and a
 *   load that hangs (no answer in 20 s) counts as failed. A blip on a phone
 *   connection is the usual cause; showing "unavailable" for it was wrong.
 * - Offline, it waits: the next time the phone is online it tries again.
 * - Only when every try has failed does it hand over to `renderFailed`
 *   (the caller's "unavailable — Retry"), or to the navy placeholder.
 *
 * Takes expo-image's props; `uri`, `previewUri`, `onFailed`, `renderFailed`
 * are its own.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import useOnline from '../hooks/useOnline';

export const PLACEHOLDER_BG = '#0F1C30';
export const RETRY_DELAYS = [1000, 3000, 8000];
export const HANG_MS = 20000;

const ResilientImage = ({
  uri, previewUri, style, imageStyle, contentFit = 'cover', recyclingKey, onLoad, onFailed, renderFailed,
  showMark = true, testID, ...rest
}) => {
  const online = useOnline();
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const timers = useRef({ retry: null, hang: null });

  const clear = () => {
    clearTimeout(timers.current.retry);
    clearTimeout(timers.current.hang);
  };

  // A new picture starts afresh.
  useEffect(() => {
    clear();
    setAttempt(0);
    setLoaded(false);
    setFailed(false);
    return clear;
  }, [uri]);

  const giveUpOrRetry = useCallback(() => {
    clear();
    if (attempt < RETRY_DELAYS.length) {
      timers.current.retry = setTimeout(() => setAttempt((a) => a + 1), RETRY_DELAYS[attempt]);
    } else {
      setFailed(true);
      onFailed?.();
    }
  }, [attempt, onFailed]);

  // A load that never answers is a failed one.
  useEffect(() => {
    if (loaded || failed || !uri || online === false) return undefined;
    timers.current.hang = setTimeout(giveUpOrRetry, HANG_MS);
    return () => clearTimeout(timers.current.hang);
  }, [attempt, loaded, failed, uri, online, giveUpOrRetry]);

  // Back online after giving up: one more round.
  useEffect(() => {
    if (online && failed) {
      setFailed(false);
      setAttempt(0);
    }
  }, [online]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleError = () => {
    if (online === false) return;          // offline: the online effect retries
    giveUpOrRetry();
  };

  const handleLoad = (e) => {
    clear();
    setLoaded(true);
    onLoad?.(e);
  };

  if (failed && renderFailed) return renderFailed(() => { setFailed(false); setAttempt(0); });

  return (
    <View style={[styles.box, style]} testID={testID}>
      {!loaded && showMark ? (
        <View style={styles.mark} pointerEvents="none">
          {/* A faint frame, drawn (no icon set needed): "a picture goes here". */}
          <View style={styles.frame}><View style={styles.sun} /></View>
        </View>
      ) : null}
      {uri && !failed ? (
        <Image
          // A fresh element per attempt: the native view really fetches again.
          key={`${uri}#${attempt}`}
          source={{ uri }}
          placeholder={previewUri && previewUri !== uri ? { uri: previewUri } : undefined}
          placeholderContentFit={contentFit}
          style={[StyleSheet.absoluteFill, imageStyle]}
          contentFit={contentFit}
          transition={150}
          cachePolicy="memory-disk"
          recyclingKey={recyclingKey ? `${recyclingKey}#${attempt}` : undefined}
          onLoad={handleLoad}
          onError={handleError}
          {...rest}
        />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  box: { backgroundColor: PLACEHOLDER_BG, overflow: 'hidden' },
  mark: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  frame: {
    width: 40, height: 30, borderRadius: 5, borderWidth: 2, borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'flex-end', padding: 4,
  },
  sun: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.12)' },
});

export default ResilientImage;
