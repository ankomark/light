// The floating pill for background uploads, plus the side effects of a job
// finishing: the "your post is live" notification, and telling the feed / the
// track list so the new item appears without a refresh.
//
// Mounted once, above the navigator, so it stays visible on every screen.
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Animated } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import { initialWindowMetrics } from 'react-native-safe-area-context';
import {
  useUploads, configureUploadQueue, retryUpload, dismissUpload,
} from '../services/uploadQueue';
import { emit, EVENTS } from '../utils/appEvents';
import { navigate } from '../services/navigationRef';
import { useI18n } from '../context/I18nContext';
import { colors, radius, spacing, shadows } from '../constants/theme';

// How long a finished upload stays on screen before the pill clears itself.
const DONE_LINGER_MS = 4000;

// A local notification — best-effort. With notifications off the pill still
// says "Posted", so a refusal here must never surface as an error.
const notify = async (title, body, data) => {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;
    await Notifications.scheduleNotificationAsync({
      content: { title, body, data: data || {} },
      trigger: null,
    });
  } catch {
    // no notifications on this device / build — the pill covers it
  }
};

const statusLabel = (job, t) => {
  if (job.status === 'queued') return t('upload.queued');
  if (job.status === 'failed') return t('upload.failed');
  if (job.status === 'done') return job.kind === 'track' ? t('upload.doneTrack') : t('upload.donePost');
  if (job.stage === 'processing') return t('upload.processing');
  if (job.stage === 'finishing') return t('upload.finishing');
  return t('upload.uploading', { pct: Math.round(job.progress * 100) });
};

const UploadPill = ({ job }) => {
  const { t } = useI18n();
  const failed = job.status === 'failed';
  const done = job.status === 'done';

  const onPress = () => {
    if (failed) retryUpload(job.id);
    else if (done && job.kind === 'post' && job.result?.id) {
      dismissUpload(job.id);
      navigate('PostDetail', { postId: job.result.id });
    }
  };

  return (
    <Pressable
      onPress={onPress}
      style={[styles.pill, failed && styles.pillFailed, done && styles.pillDone]}
      accessibilityRole="button"
      accessibilityLabel={statusLabel(job, t)}
    >
      <View style={styles.thumb}>
        {job.thumbUri ? (
          <Image source={{ uri: job.thumbUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <Feather name={job.kind === 'track' ? 'music' : 'video'} size={14} color={colors.textSecondary} />
        )}
      </View>
      <View style={styles.body}>
        <Text style={styles.label} numberOfLines={1}>{statusLabel(job, t)}</Text>
        {!done && !failed && (
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.max(4, Math.round(job.progress * 100))}%` }]} />
          </View>
        )}
      </View>
      {done && <Feather name="check-circle" size={18} color={colors.success} />}
      {failed && (
        <Pressable onPress={() => dismissUpload(job.id)} hitSlop={10} accessibilityLabel={t('common.cancel')}>
          <Feather name="x" size={18} color={colors.textSecondary} />
        </Pressable>
      )}
    </Pressable>
  );
};

const UploadStatus = () => {
  const { t } = useI18n();
  const jobs = useUploads();
  // The queue calls these long after the screen that queued the job is gone,
  // so they read the latest translator through a ref.
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    configureUploadQueue({
      onDone: (job, result) => {
        const tr = tRef.current;
        if (job.kind === 'track') {
          emit(EVENTS.TRACK_CREATED, result);
          notify(tr('upload.notifyTrackTitle'), tr('upload.notifyTrackBody', { title: job.title || '' }));
        } else {
          emit(EVENTS.POST_CREATED, result);
          notify(tr('upload.notifyPostTitle'), tr('upload.notifyPostBody'),
            result?.id ? { postId: result.id } : undefined);
        }
      },
      onFailed: () => {
        const tr = tRef.current;
        notify(tr('upload.notifyFailedTitle'), tr('upload.notifyFailedBody'));
      },
    });
  }, []);

  // Finished uploads clear themselves; failed ones wait for retry or dismiss.
  useEffect(() => {
    const timers = jobs
      .filter((j) => j.status === 'done')
      .map((j) => setTimeout(
        () => dismissUpload(j.id),
        Math.max(0, DONE_LINGER_MS - (Date.now() - (j.finishedAt || 0))),
      ));
    return () => timers.forEach(clearTimeout);
  }, [jobs]);

  const visible = jobs.length > 0;
  const slide = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(slide, { toValue: visible ? 1 : 0, useNativeDriver: true, friction: 8 }).start();
  }, [visible, slide]);

  if (!visible) return null;
  const top = (initialWindowMetrics?.insets?.top ?? 24) + spacing.xs;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        { top, opacity: slide, transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] }) }] },
      ]}
    >
      {jobs.slice(-2).map((job) => <UploadPill key={job.id} job={job} />)}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: spacing.xs,
    zIndex: 1000,
    elevation: 1000,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minWidth: 200,
    maxWidth: 320,
    paddingVertical: 6,
    paddingLeft: 6,
    paddingRight: spacing.sm + 2,
    borderRadius: radius.full,
    backgroundColor: 'rgba(12,26,46,0.96)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
    ...shadows.md,
  },
  pillFailed: { borderColor: 'rgba(229,57,53,0.7)' },
  pillDone: { borderColor: 'rgba(67,160,71,0.7)' },
  thumb: {
    width: 30,
    height: 30,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 4 },
  label: { color: colors.textPrimary, fontSize: 13, fontWeight: '700' },
  track: { height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.14)', overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 2, backgroundColor: colors.primary },
});

export default UploadStatus;
