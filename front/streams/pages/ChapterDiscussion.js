// A chapter's discussion. A reader who hasn't reached this chapter is told
// so before anything is shown ("you're on chapter 3 — this may spoil it"),
// and can choose to read on. One level of replies; the book's author is
// marked; people remove their own comments, and the author their book's.
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, ActivityIndicator, Platform, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { fetchChapterDiscussion, postChapterComment, deleteChapterComment } from '../services/api';
import ReportModal from '../components/ReportModal';
import { confirmAction, notify } from '../utils/adminConfirm';
import { colors, typography, spacing, radius } from '../constants/theme';
import { useI18n } from '../context/I18nContext';
import { useAuth } from '../context/useAuth';

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');
const MAX = 2000;

const ago = (iso) => {
  try {
    return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
};

const Comment = ({ c, t, onReply, onRemove, onReport, canRemove, reply }) => (
  <View style={[styles.comment, reply && styles.reply]} testID={`discussion-comment-${c.id}`}>
    <Image source={c.user?.profile_picture ? { uri: c.user.profile_picture } : DEFAULT_AVATAR}
      style={reply ? styles.avatarSmall : styles.avatar} contentFit="cover" />
    <View style={styles.commentBody}>
      <View style={styles.commentHead}>
        <Text style={styles.name} numberOfLines={1}>{c.user?.username}</Text>
        {c.is_author ? <Text style={styles.authorTag}>{t('discussion.author')}</Text> : null}
        <Text style={styles.when}>{ago(c.created_at)}</Text>
      </View>
      <Text style={styles.text}>{c.body}</Text>
      <View style={styles.commentActions}>
        {!reply ? (
          <TouchableOpacity onPress={() => onReply(c)} hitSlop={8} testID={`discussion-reply-${c.id}`}>
            <Text style={styles.action}>{t('discussion.reply')}</Text>
          </TouchableOpacity>
        ) : null}
        {canRemove(c) ? (
          <TouchableOpacity onPress={() => onRemove(c)} hitSlop={8} testID={`discussion-remove-${c.id}`}>
            <Text style={styles.action}>{t('common.remove')}</Text>
          </TouchableOpacity>
        ) : onReport ? (
          <TouchableOpacity onPress={() => onReport(c)} hitSlop={8}>
            <Text style={styles.action}>{t('common.report')}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  </View>
);

const ChapterDiscussion = ({ route, navigation }) => {
  const { t } = useI18n();
  const { currentUser, isAuthenticated } = useAuth();
  const { id, index, chapterTitle = '', isBookAuthor = false } = route.params || {};
  const [data, setData] = useState(null);         // { locked, reached, count, results }
  const [failed, setFailed] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [sending, setSending] = useState(false);
  const [reporting, setReporting] = useState(null);

  // Runs again when the reader chooses to see past a spoiler warning.
  const load = useCallback(async () => {
    setFailed(false);
    try {
      setData(await fetchChapterDiscussion(id, index, { reveal }));
    } catch {
      setFailed(true);
    }
  }, [id, index, reveal]);
  useEffect(() => { load(); }, [load]);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    if (!isAuthenticated) { navigation.navigate('Login'); return; }
    setSending(true);
    try {
      const c = await postChapterComment(id, index, body, replyTo?.id);
      setText('');
      setReplyTo(null);
      setData((d) => {
        if (!d) return d;
        if (!c.parent) return { ...d, count: d.count + 1, results: [...d.results, { ...c, replies: [] }] };
        return {
          ...d, count: d.count + 1,
          results: d.results.map((p) => (p.id === c.parent ? { ...p, replies: [...(p.replies || []), c] } : p)),
        };
      });
    } catch (err) {
      notify(t('common.error'), err?.response?.data?.error || t('discussion.sendFailed'));
    } finally {
      setSending(false);
    }
  };

  const remove = async (c) => {
    const ok = await confirmAction({
      title: t('discussion.removeTitle'), confirmLabel: t('common.remove'), cancelLabel: t('common.cancel'), destructive: true,
    });
    if (!ok) return;
    try {
      await deleteChapterComment(id, c.id);
      setData((d) => ({
        ...d,
        count: Math.max(0, d.count - 1 - (c.replies?.length || 0)),
        results: d.results.filter((p) => p.id !== c.id)
          .map((p) => ({ ...p, replies: (p.replies || []).filter((r) => r.id !== c.id) })),
      }));
    } catch {
      notify(t('common.error'), t('discussion.removeFailed'));
    }
  };

  const canRemove = (c) => !!(c.is_mine || isBookAuthor);

  const header = (
    <View style={styles.headerBox}>
      <Text style={styles.chapter}>{t('pubDetail.chapterN', { n: index + 1 })}{chapterTitle ? ` · ${chapterTitle}` : ''}</Text>
      {data ? <Text style={styles.count}>{t('discussion.count', { n: data.count })}</Text> : null}
    </View>
  );

  let body;
  if (failed && !data) {
    body = (
      <View style={styles.centered}>
        <Ionicons name="cloud-offline-outline" size={40} color={colors.textMuted} />
        <Text style={styles.muted}>{t('discussion.loadFailed')}</Text>
        <TouchableOpacity style={styles.btn} onPress={() => load()} testID="discussion-retry">
          <Text style={styles.btnText}>{t('common.retry')}</Text>
        </TouchableOpacity>
      </View>
    );
  } else if (!data) {
    body = <View style={styles.centered}><ActivityIndicator color={colors.primary} /></View>;
  } else if (data.locked) {
    body = (
      <View style={styles.centered} testID="discussion-locked">
        {header}
        <Ionicons name="eye-off-outline" size={40} color={colors.warning} />
        <Text style={styles.lockTitle}>{t('discussion.spoilerTitle')}</Text>
        <Text style={styles.muted}>
          {data.reached >= 0
            ? t('discussion.spoilerReached', { n: data.reached + 1, count: data.count })
            : t('discussion.spoilerNotStarted', { count: data.count })}
        </Text>
        <TouchableOpacity style={[styles.btn, styles.btnQuiet]} onPress={() => setReveal(true)}
          testID="discussion-reveal">
          <Text style={styles.btnText}>{t('discussion.showAnyway')}</Text>
        </TouchableOpacity>
      </View>
    );
  } else {
    body = (
      <FlatList
        data={data.results}
        keyExtractor={(c) => String(c.id)}
        ListHeaderComponent={header}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Text style={[styles.muted, styles.empty]}>{t('discussion.empty')}</Text>}
        renderItem={({ item }) => (
          <View>
            <Comment c={item} t={t} onReply={setReplyTo} onRemove={remove} canRemove={canRemove}
              onReport={isAuthenticated && !item.is_mine ? setReporting : null} />
            {(item.replies || []).map((r) => (
              <Comment key={r.id} c={r} t={t} reply onReply={setReplyTo} onRemove={remove} canRemove={canRemove}
                onReport={isAuthenticated && !r.is_mine ? setReporting : null} />
            ))}
          </View>
        )}
      />
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={10}
          accessibilityRole="button" accessibilityLabel={t('common.back')}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>{t('discussion.title')}</Text>
        <View style={styles.iconBtn} />
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.flex}>{body}</View>

        {data && !data.locked ? (
          <View style={styles.composer}>
            {replyTo ? (
              <View style={styles.replying}>
                <Text style={styles.replyingText} numberOfLines={1}>{t('discussion.replyingTo', { name: replyTo.user?.username })}</Text>
                <TouchableOpacity onPress={() => setReplyTo(null)} hitSlop={8}>
                  <Ionicons name="close" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
            ) : null}
            {isAuthenticated ? (
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.input}
                  value={text}
                  onChangeText={setText}
                  placeholder={t('discussion.placeholder')}
                  placeholderTextColor={colors.placeholder}
                  multiline
                  maxLength={MAX}
                  testID="discussion-input"
                />
                <TouchableOpacity onPress={send} disabled={!text.trim() || sending} style={styles.sendBtn}
                  accessibilityRole="button" accessibilityLabel={t('discussion.send')} testID="discussion-send">
                  {sending ? <ActivityIndicator size="small" color={colors.white} />
                    : <Ionicons name="send" size={18} color={colors.white} />}
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={styles.btn} onPress={() => navigation.navigate('Login')}>
                <Text style={styles.btnText}>{t('discussion.signIn')}</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : null}
      </KeyboardAvoidingView>

      {reporting ? (
        <ReportModal visible onClose={() => setReporting(null)} contentType="chaptercomment" objectId={reporting.id} />
      ) : null}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  topTitle: { ...typography.h3, color: colors.textPrimary },
  iconBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  headerBox: { marginBottom: spacing.md, alignSelf: 'stretch' },
  chapter: { ...typography.label, color: colors.accent, fontWeight: '800' },
  count: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  list: { padding: spacing.md, width: '100%', maxWidth: 760, alignSelf: 'center' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: spacing.sm },
  muted: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
  empty: { marginTop: spacing.xl },
  lockTitle: { ...typography.h3, color: colors.textPrimary, textAlign: 'center' },
  btn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, alignSelf: 'center' },
  btnQuiet: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  btnText: { ...typography.label, color: colors.white, fontWeight: '700' },

  comment: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  reply: { marginLeft: 44 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface },
  avatarSmall: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surface },
  commentBody: { flex: 1 },
  commentHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { ...typography.label, color: colors.textPrimary, fontWeight: '700', flexShrink: 1 },
  authorTag: {
    ...typography.caption, color: colors.accent, fontWeight: '800', fontSize: 10, textTransform: 'uppercase',
    borderWidth: 1, borderColor: colors.accent, borderRadius: radius.sm, paddingHorizontal: 4,
  },
  when: { ...typography.caption, color: colors.textMuted, marginLeft: 'auto' },
  text: { ...typography.body, color: colors.textPrimary, marginTop: 2, lineHeight: 21 },
  commentActions: { flexDirection: 'row', gap: spacing.md, marginTop: 4 },
  action: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },

  composer: {
    padding: spacing.sm, gap: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.surface,
  },
  replying: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xs },
  replyingText: { ...typography.caption, color: colors.textSecondary, flex: 1 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  input: {
    flex: 1, maxHeight: 120, color: colors.textPrimary, fontSize: 15,
    backgroundColor: colors.inputBg, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderWidth: 1, borderColor: colors.border,
  },
  sendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
});

export default ChapterDiscussion;
