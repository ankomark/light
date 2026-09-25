import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Linking,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import {
  deletePublication, togglePublicationLike, togglePublicationBookmark, requestBookExport, fetchBookExport,
} from '../services/api';
import { formatWhen } from '../components/ScheduleSheet';
import {
  peekBook, readBook, fetchBook, forgetBook, patchBook, notePublicationsChanged,
  keptChapterCount, downloadBook,
} from '../services/publicationStore';
import FollowButton from '../components/FollowButton';
import ReportModal from '../components/ReportModal';
import { ChapterListSkeleton } from '../components/SkeletonLoader';
import BookReviews from '../components/BookReviews';
import { Stars } from '../components/BooksHome';
import { categoryLabel } from '../utils/publications';
import { confirmAction, notify } from '../utils/adminConfirm';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';
import { useI18n } from '../context/I18nContext';
import { useAuth } from '../context/useAuth';

const WORDS_PER_MIN = 200;

/** 45 → "45 min", 130 → "2 h 10 min". */
export const formatMinutes = (m, t) => (m < 60
  ? t('time.minutes', { n: m })
  : t('time.hoursMinutes', { h: Math.floor(m / 60), m: m % 60 }));

const PublicationDetail = ({ route, navigation }) => {
  const { t } = useI18n();
  const { currentUser, isAuthenticated } = useAuth();
  const uid = currentUser?.id;
  const { id, preview = null } = route.params;
  const [reportVisible, setReportVisible] = useState(false);

  // Opened again: the page as it was, at once. Opened from the list: its top
  // (title, cover, author) from the row while the contents load.
  const [pub, setPub] = useState(() => peekBook(uid, id));
  const [loading, setLoading] = useState(() => !peekBook(uid, id));
  const [failed, setFailed] = useState(false);     // nothing to show, and it didn't load
  const [gone, setGone] = useState(false);         // deleted, taken down, or not yours to see
  const [offline, setOffline] = useState(false);   // showing the kept page; the refresh failed

  // Engagement state (optimistic).
  const [liked, setLiked] = useState(!!pub?.is_liked);
  const [likes, setLikes] = useState(pub?.likes_count || 0);
  const [bookmarked, setBookmarked] = useState(!!pub?.is_bookmarked);
  const busy = useRef({ like: false, save: false });

  // Offline copy of the whole book: 'idle' | 'running' | 'done' | 'failed'.
  const [download, setDownload] = useState({ state: 'idle', done: 0, total: 0 });

  const apply = useCallback((data) => {
    setPub(data);
    setLiked(!!data.is_liked);
    setLikes(data.likes_count || 0);
    setBookmarked(!!data.is_bookmarked);
  }, []);

  const request = useRef(0);
  const load = useCallback(async () => {
    const mine = ++request.current;
    setFailed(false);
    let shown = !!peekBook(uid, id);
    if (!shown) {
      const kept = await readBook(uid, id);
      if (mine !== request.current) return;
      if (kept) { apply(kept); setLoading(false); shown = true; }
    }
    try {
      const data = await fetchBook(uid, id);
      if (mine !== request.current) return;
      apply(data);
      setOffline(false);
      setGone(false);
    } catch (err) {
      if (mine !== request.current) return;
      if (err?.status === 404 || err?.status === 403) {
        forgetBook(uid, id);
        setGone(true);
      } else if (shown) setOffline(true);
      else setFailed(true);
    } finally {
      if (mine === request.current) setLoading(false);
    }
  }, [uid, id, apply]);

  // Every return (from the reader: "Continue" moves on) — the page is small now.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const chapters = pub?.chapters || [];
  const chapterIds = chapters.map((c) => c.id).join(',');
  useEffect(() => {
    let alive = true;
    if (!chapters.length) return undefined;
    keptChapterCount(id, chapters).then((n) => {
      if (alive && n === chapters.length) setDownload({ state: 'done', done: n, total: n });
    });
    return () => { alive = false; };
  }, [id, chapterIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const askToSignIn = async () => {
    const ok = await confirmAction({
      title: t('pubDetail.signInToEngage'), confirmLabel: t('auth.login'), cancelLabel: t('common.cancel'),
    });
    if (ok) navigation.navigate('Login');
  };

  const handleLike = async () => {
    if (!isAuthenticated) { askToSignIn(); return; }
    if (busy.current.like) return;
    busy.current.like = true;
    const prevLiked = liked, prevLikes = likes;
    setLiked(!prevLiked);
    setLikes(prevLiked ? Math.max(0, prevLikes - 1) : prevLikes + 1);
    try {
      const res = await togglePublicationLike(id);
      setLiked(res.is_liked);
      setLikes(res.likes_count);
      patchBook(uid, id, { is_liked: res.is_liked, likes_count: res.likes_count });
      notePublicationsChanged();
    } catch {
      setLiked(prevLiked); setLikes(prevLikes);
    } finally {
      busy.current.like = false;
    }
  };

  const handleBookmark = async () => {
    if (!isAuthenticated) { askToSignIn(); return; }
    if (busy.current.save) return;
    busy.current.save = true;
    const prev = bookmarked;
    setBookmarked(!prev);
    try {
      const res = await togglePublicationBookmark(id);
      setBookmarked(res.is_bookmarked);
      patchBook(uid, id, { is_bookmarked: res.is_bookmarked });
      notePublicationsChanged();                  // the Saved tab changes
    } catch {
      setBookmarked(prev);
    } finally {
      busy.current.save = false;
    }
  };

  // confirmAction, not Alert: on web Alert.alert shows nothing and never fires.
  const onDelete = async () => {
    const ok = await confirmAction({
      title: t('pubDetail.deleteTitle'), message: t('pubDetail.deleteConfirm', { title: pub.title }),
      confirmLabel: t('common.delete'), cancelLabel: t('common.cancel'), destructive: true,
    });
    if (!ok) return;
    try {
      await deletePublication(id);
      forgetBook(uid, id);
      notePublicationsChanged();
      navigation.goBack();
    } catch {
      notify(t('common.error'), t('pubDetail.deleteFailed'));
    }
  };

  const onDownload = async () => {
    setDownload({ state: 'running', done: 0, total: chapters.length });
    try {
      await downloadBook(id, chapters, (done, total) => setDownload({ state: 'running', done, total }));
      setDownload({ state: 'done', done: chapters.length, total: chapters.length });
    } catch {
      setDownload((d) => ({ ...d, state: 'failed' }));
    }
  };

  // The reader gets the contents, not the book: it loads each chapter itself.
  // The book's writers: the author, and co-authors / editors invited to it.
  const canWrite = !!pub && (pub.is_owner || ['coauthor', 'editor'].includes(pub.my_role));

  // EPUB: made by the worker; asked for, then checked every few seconds, and
  // opened when it's ready (the phone downloads it or opens it in a reader).
  const [exporting, setExporting] = useState(false);
  const onExport = async () => {
    setExporting(true);
    try {
      await requestBookExport(id);
      for (let i = 0; i < 40; i += 1) {
        await new Promise((r) => setTimeout(r, 3000));
        const res = await fetchBookExport(id);
        if (res.status === 'done' && res.url) { Linking.openURL(res.url).catch(() => {}); return; }
        if (res.status === 'failed') throw new Error(res.error || 'failed');
      }
      notify(t('studio.export'), t('studio.exportSlow'));
    } catch {
      notify(t('common.error'), t('studio.exportFailed'));
    } finally {
      setExporting(false);
    }
  };

  const openDiscussion = (index, ch) => navigation.navigate('ChapterDiscussion', {
    id: pub.id, index, chapterTitle: ch?.title || '', isBookAuthor: !!pub.is_owner,
  });

  // Opening at the reader's place carries how far into that chapter it was
  // (another phone's place, when this one has none of its own).
  const read = (index) => navigation.navigate('ChapterReader', {
    id: pub.id,
    index,
    ...(index === lastRead && pub.last_read_position > 0 ? { position: pub.last_read_position } : {}),
    book: {
      id: pub.id, title: pub.title, theme: pub.theme, updated_at: pub.updated_at, is_owner: !!pub.is_owner,
      chapters: chapters.map(({ id: cid, order, title, version, status, word_count, comment_count }) => ({
        id: cid, order, title, version, status, word_count, comment_count,
      })),
    },
  });

  // ── Nothing to show ──
  const head = pub || preview;
  if (gone || (!head && (failed || !loading))) {
    return (
      <View style={styles.centered}>
        <MaterialIcons name={gone ? 'error-outline' : 'cloud-off'} size={46} color={colors.textMuted} />
        <Text style={styles.errorText}>{gone ? t('pubDetail.unavailable') : t('pubDetail.loadFailed')}</Text>
        <View style={styles.errorActions}>
          {!gone ? (
            <TouchableOpacity style={styles.retryBtn} onPress={() => { setLoading(true); load(); }} testID="pub-retry">
              <Text style={styles.retryBtnText}>{t('common.retry')}</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity style={[styles.retryBtn, styles.secondaryBtn]} onPress={() => navigation.goBack()}>
            <Text style={styles.retryBtnText}>{t('common.goBack')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }
  if (!head) {
    return <View style={styles.centered}><ActivityIndicator size="large" color={colors.primary} /></View>;
  }

  const chapterTotal = pub ? chapters.length : (head.chapter_count || 0);
  const lastRead = Math.min(pub?.last_read_chapter || 0, Math.max(0, chapters.length - 1));
  const totalWords = chapters.reduce((n, c) => n + (c.word_count || 0), 0);
  const minutesLeft = pub && !pub.my_finished && totalWords
    ? Math.max(1, Math.round((totalWords * (1 - (pub.my_percent || 0))) / WORDS_PER_MIN)) : 0;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={10}
          accessibilityRole="button" accessibilityLabel={t('common.back')}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        {canWrite && (
          <View style={styles.ownerActions}>
            <TouchableOpacity style={styles.iconBtn} onPress={onExport} hitSlop={8} disabled={exporting}
              accessibilityRole="button" accessibilityLabel={t('studio.export')} testID="pub-export">
              {exporting ? <ActivityIndicator size="small" color={colors.textSecondary} />
                : <MaterialIcons name="file-download" size={21} color={colors.textSecondary} />}
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.navigate('PublicationEditor', { id: pub.id })} hitSlop={8}
              accessibilityRole="button" accessibilityLabel={t('pub.editTitle')} testID="pub-edit">
              <MaterialIcons name="edit" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
            {pub.is_owner ? (
              <TouchableOpacity style={styles.iconBtn} onPress={onDelete} hitSlop={8}
                accessibilityRole="button" accessibilityLabel={t('pubDetail.deleteTitle')} testID="pub-delete">
                <MaterialIcons name="delete-outline" size={21} color={colors.error} />
              </TouchableOpacity>
            ) : null}
          </View>
        )}
      </View>

      {offline ? (
        <View style={styles.offlineBar} testID="pub-offline">
          <Ionicons name="cloud-offline-outline" size={14} color={colors.textSecondary} />
          <Text style={styles.offlineText}>{t('pubDetail.offline')}</Text>
        </View>
      ) : null}

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.page}>
          <View style={styles.hero}>
            {head.cover ? (
              <Image source={{ uri: head.cover }} style={styles.cover} contentFit="cover" transition={150} />
            ) : (
              <View style={[styles.cover, styles.coverFallback]}>
                <MaterialIcons name="menu-book" size={40} color={colors.textMuted} />
              </View>
            )}
            <View style={styles.heroInfo}>
              <View style={styles.badgeRow}>
                <Text style={styles.catBadge}>{categoryLabel(head.category, t)}</Text>
                {head.status === 'draft' && <Text style={styles.draftBadge}>{t('pubDetail.draft')}</Text>}
              </View>
              <Text style={styles.title}>{head.title}</Text>
              <TouchableOpacity
                disabled={!head.author?.id}
                onPress={() => navigation.navigate('AuthorPage', { userId: head.author.id, username: head.author.username })}
                accessibilityRole="link"
                testID="pub-author"
              >
                <Text style={styles.author}>{t('pubDetail.by', { name: head.author?.username || t('articles.unknownAuthor') })}</Text>
              </TouchableOpacity>
              {pub?.rating_avg ? <View style={{ marginTop: 2 }}><Stars avg={pub.rating_avg} count={pub.rating_count} size={13} /></View> : null}
              <Text style={styles.meta}>
                {chapterTotal === 1 ? t('pubDetail.chapterCountOne') : t('pubDetail.chapterCount', { n: chapterTotal })}
                {pub?.reading_minutes ? ` · ${t('pubDetail.minRead', { n: pub.reading_minutes })}` : ''}
              </Text>
              {pub && !pub.is_owner && pub.author?.id && isAuthenticated ? (
                <View style={styles.followWrap}>
                  <FollowButton userId={pub.author.id} initialFollowing={pub.author_is_following} />
                </View>
              ) : null}
            </View>
          </View>

          {/* Engagement actions */}
          <View style={styles.actionsRow}>
            <TouchableOpacity style={styles.actionBtn} onPress={handleLike} activeOpacity={0.8} disabled={!pub}
              accessibilityRole="button" accessibilityState={{ selected: liked }} testID="pub-like">
              <Ionicons name={liked ? 'heart' : 'heart-outline'} size={20} color={liked ? colors.error : colors.textSecondary} />
              <Text style={styles.actionText}>{likes > 0 ? likes : t('pubDetail.like')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn} onPress={handleBookmark} activeOpacity={0.8} disabled={!pub}
              accessibilityRole="button" accessibilityState={{ selected: bookmarked }} testID="pub-save">
              <Ionicons name={bookmarked ? 'bookmark' : 'bookmark-outline'} size={19} color={bookmarked ? colors.primary : colors.textSecondary} />
              <Text style={styles.actionText}>{bookmarked ? t('pubDetail.saved') : t('pubDetail.save')}</Text>
            </TouchableOpacity>
            {pub && !pub.is_owner && isAuthenticated && (
              <TouchableOpacity style={styles.actionBtn} onPress={() => setReportVisible(true)} activeOpacity={0.8}
                accessibilityRole="button">
                <Ionicons name="flag-outline" size={19} color={colors.error} />
                <Text style={[styles.actionText, { color: colors.error }]}>{t('common.report')}</Text>
              </TouchableOpacity>
            )}
          </View>

          {head.summary ? <Text style={styles.summary}>{head.summary}</Text> : null}

          {/* The reader's own progress: how far, and how long is left. */}
          {pub && (pub.my_finished || pub.my_percent > 0) ? (
            <View style={styles.progressWrap} testID="pub-progress">
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.round((pub.my_finished ? 1 : pub.my_percent) * 100)}%` }]} />
              </View>
              <Text style={styles.progressText}>
                {pub.my_finished ? t('pubDetail.finished') : [
                  t('pubDetail.percentRead', { n: Math.max(1, Math.round(pub.my_percent * 100)) }),
                  minutesLeft ? t('pubDetail.timeLeft', { time: formatMinutes(minutesLeft, t) }) : null,
                ].filter(Boolean).join(' · ')}
              </Text>
            </View>
          ) : null}

          {chapters.length > 0 && (
            <TouchableOpacity style={styles.readBtn} onPress={() => read(lastRead)} activeOpacity={0.9}
              accessibilityRole="button" testID="pub-read">
              <Ionicons name="book-outline" size={18} color={colors.white} />
              <Text style={styles.readBtnText}>
                {lastRead > 0 ? t('pubDetail.continue', { n: lastRead + 1 }) : t('pubDetail.startReading')}
              </Text>
            </TouchableOpacity>
          )}

          {chapters.length > 0 && (
            <TouchableOpacity
              style={styles.downloadBtn}
              onPress={onDownload}
              disabled={download.state === 'running' || download.state === 'done'}
              activeOpacity={0.85}
              accessibilityRole="button"
              testID="pub-download"
            >
              {download.state === 'running'
                ? <ActivityIndicator size="small" color={colors.textSecondary} />
                : <Ionicons
                    name={download.state === 'done' ? 'checkmark-circle' : download.state === 'failed' ? 'alert-circle-outline' : 'download-outline'}
                    size={18}
                    color={download.state === 'done' ? colors.success || colors.accent : download.state === 'failed' ? colors.error : colors.textSecondary}
                  />}
              <Text style={[styles.downloadText, download.state === 'failed' && { color: colors.error }]}>
                {download.state === 'running'
                  ? t('pubDetail.downloading', { done: download.done, total: download.total })
                  : download.state === 'done' ? t('pubDetail.downloaded')
                    : download.state === 'failed' ? t('pubDetail.downloadFailed') : t('pubDetail.download')}
              </Text>
            </TouchableOpacity>
          )}

          <Text style={styles.tocTitle}>{t('common.contents')}</Text>
          {!pub ? (
            <ChapterListSkeleton count={Math.min(6, Math.max(2, head.chapter_count || 4))} />
          ) : chapters.length === 0 ? (
            <Text style={styles.emptyToc}>{t('pubDetail.noChapters')}</Text>
          ) : (
            chapters.map((ch, idx) => (
              <TouchableOpacity
                key={ch.id ?? idx}
                style={styles.tocRow}
                activeOpacity={0.8}
                onPress={() => read(idx)}
                accessibilityRole="button"
              >
                <Text style={styles.tocNum}>{idx + 1}</Text>
                <Text style={styles.tocChapter} numberOfLines={1}>{ch.title || t('pubDetail.chapterN', { n: idx + 1 })}</Text>
                {/* The author's own marks: readers never get these chapters. */}
                {ch.is_removed ? <Text style={[styles.tocMark, styles.tocMarkRemoved]}>{t('pubDetail.removedChapter')}</Text>
                  : ch.status === 'draft' ? <Text style={styles.tocMark}>{t('pubDetail.draft')}</Text> : null}
                {idx === lastRead && lastRead > 0 ? <Ionicons name="bookmark" size={14} color={colors.accent} /> : null}
                {pub.status === 'published' && !ch.is_removed && ch.status !== 'draft' ? (
                  <TouchableOpacity
                    style={styles.talk}
                    hitSlop={8}
                    onPress={() => openDiscussion(idx, ch)}
                    accessibilityRole="button"
                    accessibilityLabel={t('discussion.title')}
                    testID={`pub-discuss-${idx}`}
                  >
                    <Ionicons name="chatbubble-outline" size={15} color={colors.textSecondary} />
                    {ch.comment_count ? <Text style={styles.talkN}>{ch.comment_count}</Text> : null}
                  </TouchableOpacity>
                ) : null}
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            ))
          )}
          {/* Serial publishing: what's coming, and when. */}
          {pub?.upcoming?.length ? (
            <View style={styles.upcoming} testID="pub-upcoming">
              <Text style={styles.upcomingTitle}>{t('studio.comingSoon')}</Text>
              {pub.upcoming.map((u) => (
                <View key={u.id} style={styles.upcomingRow}>
                  <Ionicons name="time-outline" size={16} color={colors.accent} />
                  <Text style={styles.upcomingName} numberOfLines={1}>{u.title || t('studio.newChapter')}</Text>
                  <Text style={styles.upcomingWhen}>{formatWhen(u.publish_at)}</Text>
                </View>
              ))}
              {!bookmarked ? <Text style={styles.upcomingHint}>{t('studio.saveToHear')}</Text> : null}
            </View>
          ) : null}
          {pub && pub.status === 'published' ? <BookReviews pubId={pub.id} navigation={navigation} onChanged={load} /> : null}
          <View style={{ height: spacing.xxl }} />
        </View>
      </ScrollView>

      {pub ? (
        <ReportModal
          visible={reportVisible}
          onClose={() => setReportVisible(false)}
          contentType="publication"
          objectId={pub.id}
        />
      ) : null}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, gap: spacing.sm, padding: spacing.lg },
  errorText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  errorActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  retryBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  secondaryBtn: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  retryBtnText: { ...typography.label, color: colors.white, fontWeight: '600' },

  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  ownerActions: { flexDirection: 'row', alignItems: 'center' },
  iconBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },

  offlineBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 6, backgroundColor: 'rgba(255,255,255,0.06)',
  },
  offlineText: { ...typography.caption, color: colors.textSecondary },

  content: { padding: spacing.md },
  // A readable column on tablets rather than a stretched phone layout.
  page: { width: '100%', maxWidth: 760, alignSelf: 'center' },
  hero: { flexDirection: 'row', gap: spacing.md },
  cover: { width: 110, height: 150, borderRadius: radius.md, backgroundColor: colors.surface },
  coverFallback: { alignItems: 'center', justifyContent: 'center' },
  heroInfo: { flex: 1, justifyContent: 'center' },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  catBadge: { ...typography.caption, color: colors.accent, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  draftBadge: {
    ...typography.caption, color: colors.warning, fontWeight: '700', textTransform: 'uppercase',
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

  progressWrap: { marginTop: spacing.lg, gap: 6 },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.surface, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3, backgroundColor: colors.accent },
  progressText: { ...typography.caption, color: colors.textSecondary },
  readBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    backgroundColor: colors.primary, borderRadius: radius.md,
    paddingVertical: spacing.sm + 4, marginTop: spacing.lg, ...shadows.sm,
  },
  readBtnText: { ...typography.button, color: colors.white },
  downloadBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    paddingVertical: spacing.sm, marginTop: spacing.sm,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
  },
  downloadText: { ...typography.label, color: colors.textSecondary, fontWeight: '600', flexShrink: 1, textAlign: 'center' },

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
  upcoming: {
    marginTop: spacing.md, padding: spacing.md, gap: spacing.sm, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.accent, borderStyle: 'dashed',
  },
  upcomingTitle: { ...typography.label, color: colors.accent, fontWeight: '800' },
  upcomingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  upcomingName: { ...typography.label, color: colors.textPrimary, flex: 1 },
  upcomingWhen: { ...typography.caption, color: colors.textSecondary },
  upcomingHint: { ...typography.caption, color: colors.textMuted },
  talk: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 4 },
  talkN: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  tocMark: {
    ...typography.caption, color: colors.warning, fontWeight: '700', fontSize: 10, textTransform: 'uppercase',
    borderWidth: 1, borderColor: colors.warning, borderRadius: radius.sm, paddingHorizontal: 5,
  },
  tocMarkRemoved: { color: colors.error, borderColor: colors.error },
});

export default PublicationDetail;
