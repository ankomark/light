import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import {
  fetchPublication, deletePublication, togglePublicationLike, togglePublicationBookmark,
} from '../services/api';
import FollowButton from '../components/FollowButton';
import ReportModal from '../components/ReportModal';
import { categoryLabel } from '../utils/publications';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const PublicationDetail = ({ route, navigation }) => {
  const [reportVisible, setReportVisible] = useState(false);
  const { t } = useI18n();
  const { id } = route.params;
  const [pub, setPub] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Engagement state (optimistic).
  const [liked, setLiked] = useState(false);
  const [likes, setLikes] = useState(0);
  const [bookmarked, setBookmarked] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(false);
      const data = await fetchPublication(id);
      setPub(data);
      setLiked(!!data.is_liked);
      setLikes(data.likes_count || 0);
      setBookmarked(!!data.is_bookmarked);
    } catch (err) {
      console.error('Error loading publication:', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleLike = async () => {
    if (busy) return;
    setBusy(true);
    const prevLiked = liked, prevLikes = likes;
    setLiked(!prevLiked);
    setLikes(prevLiked ? Math.max(0, prevLikes - 1) : prevLikes + 1);
    try {
      const res = await togglePublicationLike(id);
      setLiked(res.is_liked);
      setLikes(res.likes_count);
    } catch {
      setLiked(prevLiked); setLikes(prevLikes);
    } finally {
      setBusy(false);
    }
  };

  const handleBookmark = async () => {
    const prev = bookmarked;
    setBookmarked(!prev);
    try {
      const res = await togglePublicationBookmark(id);
      setBookmarked(res.is_bookmarked);
    } catch {
      setBookmarked(prev);
    }
  };

  const onDelete = () => {
    Alert.alert(t('pubDetail.deleteTitle'), t('pubDetail.deleteConfirm', { title: pub.title }), [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          try {
            await deletePublication(id);
            navigation.goBack();
          } catch {
            Alert.alert(t('common.error'), t('pubDetail.deleteFailed'));
          }
        },
      },
    ]);
  };

  if (loading) {
    return <View style={styles.centered}><ActivityIndicator size="large" color={colors.primary} /></View>;
  }
  if (error || !pub) {
    return (
      <View style={styles.centered}>
        <MaterialIcons name="error-outline" size={46} color={colors.textMuted} />
        <Text style={styles.errorText}>{t('pubDetail.unavailable')}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.retryBtnText}>{t('common.goBack')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const chapters = pub.chapters || [];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={10}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        {pub.is_owner && (
          <View style={styles.ownerActions}>
            <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.navigate('PublicationEditor', { id: pub.id })} hitSlop={8}>
              <MaterialIcons name="edit" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconBtn} onPress={onDelete} hitSlop={8}>
              <MaterialIcons name="delete-outline" size={21} color={colors.error} />
            </TouchableOpacity>
          </View>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          {pub.cover ? (
            <Image source={{ uri: pub.cover }} style={styles.cover} />
          ) : (
            <View style={[styles.cover, styles.coverFallback]}>
              <MaterialIcons name="menu-book" size={40} color={colors.textMuted} />
            </View>
          )}
          <View style={styles.heroInfo}>
            <View style={styles.badgeRow}>
              <Text style={styles.catBadge}>{categoryLabel(pub.category)}</Text>
              {pub.status === 'draft' && <Text style={styles.draftBadge}>{t('pubDetail.draft')}</Text>}
            </View>
            <Text style={styles.title}>{pub.title}</Text>
            <Text style={styles.author}>by {pub.author?.username || 'Unknown'}</Text>
            <Text style={styles.meta}>
              {chapters.length} {chapters.length === 1 ? 'chapter' : 'chapters'}
              {pub.reading_minutes ? ` · ${pub.reading_minutes} min read` : ''}
            </Text>
            {!pub.is_owner && pub.author?.id ? (
              <View style={styles.followWrap}>
                <FollowButton
                  userId={pub.author.id}
                  initialFollowing={pub.author_is_following}
                />
              </View>
            ) : null}
          </View>
        </View>

        {/* Engagement actions */}
        <View style={styles.actionsRow}>
          <TouchableOpacity style={styles.actionBtn} onPress={handleLike} activeOpacity={0.8}>
            <Ionicons
              name={liked ? 'heart' : 'heart-outline'}
              size={20}
              color={liked ? colors.error : colors.textSecondary}
            />
            <Text style={styles.actionText}>{likes > 0 ? likes : 'Like'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={handleBookmark} activeOpacity={0.8}>
            <Ionicons
              name={bookmarked ? 'bookmark' : 'bookmark-outline'}
              size={19}
              color={bookmarked ? colors.primary : colors.textSecondary}
            />
            <Text style={styles.actionText}>{bookmarked ? 'Saved' : 'Save'}</Text>
          </TouchableOpacity>
          {!pub.is_owner && (
            <TouchableOpacity style={styles.actionBtn} onPress={() => setReportVisible(true)} activeOpacity={0.8}>
              <Ionicons name="flag-outline" size={19} color={colors.error} />
              <Text style={[styles.actionText, { color: colors.error }]}>{t('common.report')}</Text>
            </TouchableOpacity>
          )}
        </View>

        {pub.summary ? <Text style={styles.summary}>{pub.summary}</Text> : null}

        {chapters.length > 0 && (
          <TouchableOpacity
            style={styles.readBtn}
            onPress={() => navigation.navigate('ChapterReader', {
              publication: pub,
              index: Math.min(pub.last_read_chapter || 0, chapters.length - 1),
            })}
            activeOpacity={0.9}
          >
            <Ionicons name="book-outline" size={18} color={colors.white} />
            <Text style={styles.readBtnText}>
              {pub.last_read_chapter > 0 ? `Continue · Chapter ${pub.last_read_chapter + 1}` : 'Start Reading'}
            </Text>
          </TouchableOpacity>
        )}

        <Text style={styles.tocTitle}>{t('common.contents')}</Text>
        {chapters.length === 0 ? (
          <Text style={styles.emptyToc}>{t('pubDetail.noChapters')}</Text>
        ) : (
          chapters.map((ch, idx) => (
            <TouchableOpacity
              key={ch.id ?? idx}
              style={styles.tocRow}
              activeOpacity={0.8}
              onPress={() => navigation.navigate('ChapterReader', { publication: pub, index: idx })}
            >
              <Text style={styles.tocNum}>{idx + 1}</Text>
              <Text style={styles.tocChapter} numberOfLines={1}>{ch.title || `Chapter ${idx + 1}`}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          ))
        )}
        <View style={{ height: spacing.xxl }} />
      </ScrollView>

      <ReportModal
        visible={reportVisible}
        onClose={() => setReportVisible(false)}
        contentType="publication"
        objectId={pub.id}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, gap: spacing.sm, padding: spacing.lg },
  errorText: { ...typography.body, color: colors.textSecondary },
  retryBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, marginTop: spacing.xs },
  retryBtnText: { ...typography.label, color: colors.white, fontWeight: '600' },

  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  ownerActions: { flexDirection: 'row', alignItems: 'center' },
  iconBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },

  content: { padding: spacing.md },
  hero: { flexDirection: 'row', gap: spacing.md },
  cover: { width: 110, height: 150, borderRadius: radius.md, backgroundColor: colors.surface },
  coverFallback: { alignItems: 'center', justifyContent: 'center' },
  heroInfo: { flex: 1, justifyContent: 'center' },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  catBadge: { ...typography.caption, color: colors.accent, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  draftBadge: {
    ...typography.caption, color: colors.warning, fontWeight: '700',
    borderWidth: 1, borderColor: colors.warning, borderRadius: radius.sm, paddingHorizontal: 6, fontSize: 10,
  },
  title: { ...typography.h2, color: colors.textPrimary },
  author: { ...typography.body, color: colors.textSecondary, marginTop: 2 },
  meta: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs },

  followWrap: { flexDirection: 'row', marginTop: spacing.sm },
  actionsRow: {
    flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg,
  },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    flex: 1, paddingVertical: spacing.sm, borderRadius: radius.md,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
  },
  actionText: { ...typography.label, color: colors.textSecondary, fontWeight: '600' },

  summary: { ...typography.body, color: colors.textSecondary, marginTop: spacing.lg, lineHeight: 22 },

  readBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    backgroundColor: colors.primary, borderRadius: radius.md,
    paddingVertical: spacing.sm + 4, marginTop: spacing.lg, ...shadows.sm,
  },
  readBtnText: { ...typography.button, color: colors.white },

  tocTitle: { ...typography.h3, color: colors.textPrimary, marginTop: spacing.xl, marginBottom: spacing.sm },
  emptyToc: { ...typography.body, color: colors.textMuted },
  tocRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.card, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, marginBottom: spacing.sm,
    ...shadows.sm,
  },
  tocNum: { ...typography.label, color: colors.primary, fontWeight: '800', width: 24 },
  tocChapter: { ...typography.label, color: colors.textPrimary, flex: 1 },
});

export default PublicationDetail;
