// "Posting…" cards at the top of the home feed, TikTok-style: the author sees
// their post in place the moment they tap Post, until the real one arrives
// (UploadStatus then inserts it into the feed and the card disappears). A
// failed upload stays as a card with Retry / Remove.
//
// Deliberately no progress bar here: the pill at the top of the screen is the
// one place upload progress is shown, so there are never two bars at once.
//
// Its own component, subscribed to the queue itself, so queue changes never
// re-render the feed around it — and each card skips progress ticks entirely,
// since it no longer shows progress.
import React, { memo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { useUploads, retryUpload, dismissUpload } from '../services/uploadQueue';
import { useI18n } from '../context/I18nContext';
import { colors, radius, spacing } from '../constants/theme';

const PendingCard = memo(({ job, t }) => {
  const failed = job.status === 'failed';
  const p = job.preview || {};
  const uri = job.thumbUri || p.uri;
  return (
    <View style={[styles.card, failed && styles.cardFailed]}>
      <View style={styles.thumb}>
        {uri ? (
          <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} />
        ) : (
          <Feather name={p.contentType === 'video' ? 'video' : 'image'} size={22} color={colors.textMuted} />
        )}
        {!failed && <View style={styles.dim} />}
      </View>
      <View style={styles.body}>
        <Text style={styles.status} numberOfLines={1}>
          {failed ? t('upload.failedShort') : job.stage === 'processing' ? t('upload.processing') : t('upload.posting')}
        </Text>
        {!!p.caption && <Text style={styles.caption} numberOfLines={2}>{p.caption}</Text>}
        {failed ? (
          <View style={styles.actions}>
            <TouchableOpacity style={styles.retry} onPress={() => retryUpload(job.id)}>
              <Feather name="rotate-cw" size={14} color="#fff" />
              <Text style={styles.retryText}>{t('upload.retry')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.remove} onPress={() => dismissUpload(job.id)}>
              <Text style={styles.removeText}>{t('upload.remove')}</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    </View>
  );
}, (a, b) => a.t === b.t
  && a.job.status === b.job.status
  && a.job.stage === b.job.stage
  && a.job.thumbUri === b.job.thumbUri
  && a.job.preview === b.job.preview);
PendingCard.displayName = 'PendingCard';

const PendingPosts = () => {
  const { t } = useI18n();
  const jobs = useUploads();
  const pending = jobs.filter((j) => j.kind === 'post' && j.status !== 'done');
  if (!pending.length) return null;
  return (
    <View style={styles.wrap}>
      {pending.map((job) => <PendingCard key={job.id} job={job} t={t} />)}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12, paddingTop: spacing.sm, gap: spacing.sm },
  card: {
    flexDirection: 'row', gap: spacing.sm, padding: spacing.sm, borderRadius: radius.lg,
    backgroundColor: 'rgba(14,30,52,0.9)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(29,161,242,0.45)',
  },
  cardFailed: { borderColor: 'rgba(229,57,53,0.7)' },
  thumb: {
    width: 64, height: 80, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  dim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.25)' },
  body: { flex: 1, justifyContent: 'center', gap: 4 },
  status: { color: colors.textPrimary, fontSize: 14, fontWeight: '800' },
  caption: { color: colors.textSecondary, fontSize: 13 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: 4 },
  retry: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: radius.full, backgroundColor: colors.primary,
  },
  retryText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  remove: { paddingHorizontal: 12, paddingVertical: 6 },
  removeText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
});

export default PendingPosts;
