// The notice board: official announcements from the leadership, pinned ones
// first. Opens on the last board seen (memory, then disk) and refreshes in
// place — a first-ever open shows notice-shaped placeholders, never a spinner
// — and loads 20 at a time as you scroll. Anyone can send the admins a
// private note; admins post notices and read the notes.
import React, { useState, useEffect, useCallback, useRef, memo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Modal, TextInput, Switch,
  ActivityIndicator, RefreshControl, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import {
  fetchNotices, createNotice, updateNotice, deleteNotice, markNoticesSeen,
  createAdminNote, fetchAdminNotes, fetchMyAdminNotes, replyToAdminNote, markAdminNoteRead, deleteAdminNote,
} from '../services/api';
import { useAuth } from '../context/useAuth';
import { useI18n } from '../context/I18nContext';
import { peekCache, readCache, writeCache, userKey } from '../utils/screenCache';
import { confirmAction, notify } from '../utils/adminConfirm';
import { NoticeListSkeleton } from '../components/SkeletonLoader';
import { announceDM } from '../services/dmSocket';
import { hasCapability } from '../utils/roles';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { compressImage } from '../services/imageProcessing';
import { uploadMedia } from '../services/cloudinary';
import LinkedText from '../components/LinkedText';
import { colors, typography, spacing, radius } from '../constants/theme';

// Calm, not bright: smoked glass cards and the warm accent (no light blue).
const GLASS = 'rgba(8,12,18,0.62)';
const GLASS_EDGE = 'rgba(255,255,255,0.09)';

const formatDateTime = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

const formatDate = (iso) => {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

// When a notice goes up, and when it comes down (the compose sheet's chips).
const WHEN = ['now', '1h', 'tomorrow'];
const EXPIRY = ['never', '1d', '7d', '30d'];
export const publishTime = (when, now = new Date()) => {
  if (when === '1h') return new Date(now.getTime() + 3600000);
  if (when === 'tomorrow') {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(8, 0, 0, 0);
    return d;
  }
  return null;                                   // now
};
export const expiryTime = (expiry, from) => {
  const days = { '1d': 1, '7d': 7, '30d': 30 }[expiry];
  return days ? new Date((from || new Date()).getTime() + days * 86400000) : null;
};

export const CATEGORIES = ['general', 'event', 'urgent', 'prayer'];

const NoticeCard = memo(({ item, onDelete, onEdit, onOpen, t }) => (
  <TouchableOpacity style={[styles.card, item.is_pinned && styles.cardPinned, item.category === 'urgent' && styles.cardUrgent]}
    testID={`notice-${item.id}`} activeOpacity={0.9} onPress={() => onOpen(item)}>
    {item.cover_image ? (
      <Image source={{ uri: item.cover_image }} style={styles.cardCover} contentFit="cover" transition={150} />
    ) : null}
    {item.is_pinned || item.is_new || (item.category && item.category !== 'general') || (item.can_manage && item.status && item.status !== 'live') ? (
      <View style={styles.tagRow}>
        {item.category && item.category !== 'general' ? (
          <View style={[styles.catTag, item.category === 'urgent' && styles.catTagUrgent]}>
            <Text style={[styles.catTagText, item.category === 'urgent' && styles.catTagTextUrgent]}>{t(`notice.category.${item.category}`)}</Text>
          </View>
        ) : null}
        {item.can_manage && item.status === 'scheduled' ? (
          <View style={styles.statusTag} testID={`notice-scheduled-${item.id}`}>
            <MaterialCommunityIcons name="clock-outline" size={12} color={colors.textSecondary} />
            <Text style={styles.statusText}>{t('notice.scheduledFor', { when: formatDateTime(item.publish_at) })}</Text>
          </View>
        ) : null}
        {item.can_manage && item.status === 'expired' ? (
          <View style={styles.statusTag}><Text style={styles.statusText}>{t('notice.expired')}</Text></View>
        ) : null}
        {item.is_pinned ? (
          <View style={styles.pinnedTag}>
            <MaterialCommunityIcons name="pin" size={12} color={colors.accent} />
            <Text style={styles.pinnedText}>{t('notice.pinned')}</Text>
          </View>
        ) : null}
        {item.is_new ? (
          <View style={styles.newTag} testID={`notice-new-${item.id}`}>
            <Text style={styles.newTagText}>{t('notice.new_tag')}</Text>
          </View>
        ) : null}
      </View>
    ) : null}
    <View style={styles.cardHeader}>
      <Text style={styles.cardTitle}>{item.title}</Text>
      {item.can_manage && (
        <View style={styles.manageRow}>
          <TouchableOpacity onPress={() => onEdit(item)} hitSlop={8} accessibilityLabel={t('notice.edit')}
            testID={`notice-edit-${item.id}`}>
            <Ionicons name="create-outline" size={18} color={colors.accent} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => onDelete(item)} hitSlop={8} accessibilityLabel={t('common.delete')}
            testID={`notice-delete-${item.id}`}>
            <Ionicons name="trash-outline" size={18} color={colors.error} />
          </TouchableOpacity>
        </View>
      )}
    </View>
    <LinkedText style={styles.cardBody} numberOfLines={6}>{item.body}</LinkedText>
    <View style={styles.cardFooter}>
      <MaterialCommunityIcons name="account-circle-outline" size={14} color={colors.textMuted} />
      <Text style={styles.cardMeta}>
        {item.created_by_username || t('notice.leadership')} · {formatDate(item.publish_at || item.created_at)}
        {item.edited_at ? `  ·  ${t('notice.edited')}` : ''}
        {item.can_manage && item.expires_at && item.status !== 'expired' ? `  ·  ${t('notice.until', { when: formatDate(item.expires_at) })}` : ''}
      </Text>
    </View>
  </TouchableOpacity>
));
NoticeCard.displayName = 'NoticeCard';

const NoticeBoard = ({ route, navigation }) => {
  const { t } = useI18n();
  const { currentUser } = useAuth();
  const insets = useSafeAreaInsets();
  // Staff, or a role that may manage the notice board.
  const isAdmin = !!currentUser?.is_staff || hasCapability(currentUser, 'manage_notices');

  // Filters: a category and a search; only the plain board is kept for next time.
  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { const h = setTimeout(() => setQ(query.trim()), 300); return () => clearTimeout(h); }, [query]);
  const filtered = !!(category || q);
  const filterRef = useRef({ category: '', q: '' });
  filterRef.current = { category, q };

  const cacheKey = userKey(currentUser?.id, 'notices');
  const [notices, setNotices] = useState(() => peekCache(cacheKey)?.results ?? []);
  const [loading, setLoading] = useState(() => !peekCache(cacheKey));
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const pageRef = useRef(1);
  const moreRef = useRef(false);
  const freshRef = useRef(false);

  const [composeVisible, setComposeVisible] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [posting, setPosting] = useState(false);
  const [editing, setEditing] = useState(null);      // the notice being edited (null: a new one)
  const [when, setWhen] = useState('now');          // 'keep' while editing
  const [expiry, setExpiry] = useState('never');
  const [noticeCategory, setNoticeCategory] = useState('general');
  const [cover, setCover] = useState('');           // an uploaded picture's address
  const [uploadingCover, setUploadingCover] = useState(false);

  // The notes I sent (anyone), and answering notes (admins).
  const [myNotesVisible, setMyNotesVisible] = useState(false);
  const [myNotes, setMyNotes] = useState(null);
  const [replyFor, setReplyFor] = useState(null);
  const [replyText, setReplyText] = useState('');

  // Private note to admins (any user can write; only admins can read).
  const [noteVisible, setNoteVisible] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [sendingNote, setSendingNote] = useState(false);

  // Admin inbox of received notes.
  const [inboxVisible, setInboxVisible] = useState(false);
  const [inboxNotes, setInboxNotes] = useState([]);
  const [inboxLoading, setInboxLoading] = useState(false);

  // Cold start: the disk copy, if the network hasn't answered first.
  useEffect(() => {
    if (peekCache(cacheKey)) return undefined;
    let cancelled = false;
    readCache(cacheKey).then((disk) => {
      if (cancelled || freshRef.current || !disk?.results?.length) return;
      setNotices(disk.results);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [cacheKey]);

  // Page 1 replaces the board (and is what the next open paints).
  const load = useCallback(async () => {
    try {
      const asked = { ...filterRef.current };
      const res = await fetchNotices(1, asked);
      if (filterRef.current.category !== asked.category || filterRef.current.q !== asked.q) return;   // they moved on
      const rows = res?.results ?? (Array.isArray(res) ? res : []);
      freshRef.current = true;
      setNotices(rows);
      setFailed(false);
      pageRef.current = 1;
      moreRef.current = !!res?.next;
      // Seen now: the next open shouldn't call these new again.
      if (!asked.category && !asked.q) writeCache(cacheKey, { results: rows.map((n) => (n.is_new ? { ...n, is_new: false } : n)) });
      if (rows.some((n) => n.is_new)) {
        markNoticesSeen().then(() => announceDM({ type: 'notices_seen' })).catch(() => {});
      }
    } catch {
      setFailed(true);   // what's on screen stays
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [cacheKey]);

  useEffect(() => { load(); }, [load, category, q]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !moreRef.current) return;
    setLoadingMore(true);
    try {
      const res = await fetchNotices(pageRef.current + 1, filterRef.current);
      pageRef.current += 1;
      moreRef.current = !!res?.next;
      setNotices((prev) => {
        const have = new Set(prev.map((n) => n.id));
        return [...prev, ...(res?.results ?? []).filter((n) => !have.has(n.id))];
      });
    } catch { /* scrolling again retries */ } finally { setLoadingMore(false); }
  }, [loadingMore]);

  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);

  const resetCompose = () => {
    setTitle(''); setBody(''); setPinned(false); setEditing(null); setWhen('now'); setExpiry('never');
    setNoticeCategory('general'); setCover('');
  };

  const startEdit = useCallback((item) => {
    setEditing(item);
    setTitle(item.title); setBody(item.body); setPinned(!!item.is_pinned);
    setWhen('keep'); setExpiry('keep');
    setNoticeCategory(item.category || 'general'); setCover(item.cover_image || '');
    setComposeVisible(true);
  }, []);

  // A picture at the top: picked, made smaller on the phone, uploaded.
  const pickCover = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== 'granted') { notify(t('chat.permissionRequired'), t('chat.permissionPhotos')); return; }
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
      if (res.canceled || !res.assets?.length) return;
      setUploadingCover(true);
      const small = await compressImage(res.assets[0].uri, { width: 1280, quality: 0.7 });
      const up = await uploadMedia({ uri: small.uri, name: `notice_${Date.now()}.jpg`, mimeType: 'image/jpeg' }, 'cover');
      setCover(up?.url || '');
    } catch {
      notify(t('common.error'), t('notice.coverFailed'));
    } finally {
      setUploadingCover(false);
    }
  };

  const openMyNotes = useCallback(async () => {
    setMyNotesVisible(true);
    setMyNotes(null);
    try {
      const res = await fetchMyAdminNotes();
      setMyNotes(res?.results ?? []);
    } catch {
      setMyNotes([]);
      notify(t('common.error'), t('notice.loadNotesFailed'));
    }
  }, [t]);

  // From the "the admins answered" push or bell: straight to my notes.
  useEffect(() => { if (route?.params?.openMyNotes) openMyNotes(); }, [route?.params?.openMyNotes, openMyNotes]);

  const sendReply = async (note) => {
    const text = replyText.trim();
    if (!text) return;
    try {
      const saved = await replyToAdminNote(note.id, text);
      setInboxNotes((prev) => prev.map((n) => (n.id === note.id ? { ...n, ...saved } : n)));
      setReplyFor(null); setReplyText('');
    } catch {
      notify(t('common.error'), t('notice.replyFailed'));
    }
  };

  const handlePost = async () => {
    if (!title.trim() || !body.trim()) {
      notify(t('dir.missingInfo'), t('notice.missingInfo'));
      return;
    }
    try {
      setPosting(true);
      const pub = when === 'keep' ? undefined : publishTime(when);
      const exp = expiry === 'keep' ? undefined
        : expiryTime(expiry, pub || (editing?.publish_at ? new Date(editing.publish_at) : null));
      const fields = {
        title: title.trim(), body: body.trim(), is_pinned: pinned, category: noticeCategory, cover_image: cover,
        ...(pub !== undefined ? { publish_at: pub ? pub.toISOString() : null } : {}),
        ...(exp !== undefined ? { expires_at: exp ? exp.toISOString() : null } : {}),
      };
      if (editing) await updateNotice(editing.id, fields);
      else await createNotice(fields);
      setComposeVisible(false);
      resetCompose();
      await load();
    } catch (error) {
      const msg = error?.response?.status === 403
        ? t('notice.adminsOnly')
        : (error?.response?.data?.detail || t('notice.postFailed'));
      notify(t('common.error'), msg);
    } finally {
      setPosting(false);
    }
  };

  const handleSendNote = async () => {
    if (!noteText.trim()) {
      notify(t('notice.emptyNoteTitle'), t('notice.emptyNoteBody'));
      return;
    }
    try {
      setSendingNote(true);
      await createAdminNote(noteText.trim());
      setNoteVisible(false);
      setNoteText('');
      notify(t('notice.sentTitle'), t('notice.sentBody'));
    } catch (error) {
      notify(t('common.error'), error?.response?.data?.detail || t('notice.sendNoteFailed'));
    } finally {
      setSendingNote(false);
    }
  };

  const openInbox = async () => {
    setInboxVisible(true);
    setInboxLoading(true);
    try {
      const data = await fetchAdminNotes();
      setInboxNotes(Array.isArray(data) ? data : []);
    } catch {
      notify(t('common.error'), t('notice.loadNotesFailed'));
    } finally {
      setInboxLoading(false);
    }
  };

  const handleToggleNoteRead = async (note) => {
    const next = !note.is_read;
    setInboxNotes((prev) => prev.map((n) => (n.id === note.id ? { ...n, is_read: next } : n)));
    try {
      await markAdminNoteRead(note.id, next);
    } catch {
      setInboxNotes((prev) => prev.map((n) => (n.id === note.id ? { ...n, is_read: !next } : n)));
    }
  };

  // Web-safe confirms (Alert's buttons never fire on web).
  const handleDeleteNote = async (note) => {
    const ok = await confirmAction({
      title: t('notice.deleteNoteTitle'), message: t('notice.deleteNoteBody'),
      confirmLabel: t('common.delete'), cancelLabel: t('common.cancel'), destructive: true,
    });
    if (!ok) return;
    const prev = inboxNotes;
    setInboxNotes((cur) => cur.filter((n) => n.id !== note.id));
    try {
      await deleteAdminNote(note.id);
    } catch {
      setInboxNotes(prev);
      notify(t('common.error'), t('notice.deleteNoteFailed'));
    }
  };

  const handleDelete = useCallback(async (item) => {
    const ok = await confirmAction({
      title: t('notice.deleteNoticeTitle'), message: t('notice.deleteNoticeConfirm', { title: item.title }),
      confirmLabel: t('common.delete'), cancelLabel: t('common.cancel'), destructive: true,
    });
    if (!ok) return;
    try {
      await deleteNotice(item.id);
      setNotices((prev) => {
        const next = prev.filter((n) => n.id !== item.id);
        writeCache(cacheKey, { results: next });
        return next;
      });
    } catch {
      notify(t('common.error'), t('notice.deleteNoticeFailed'));
    }
  }, [t, cacheKey]);

  const openNotice = useCallback((item) => navigation?.navigate('Notice', { id: item.id, notice: item }), [navigation]);
  const renderItem = useCallback(({ item }) => (
    <NoticeCard item={item} onDelete={handleDelete} onEdit={startEdit} onOpen={openNotice} t={t} />
  ), [handleDelete, startEdit, openNotice, t]);

  return (
    <View style={styles.root}>
      <FlatList
        data={notices}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderItem}
        contentContainerStyle={[styles.listContent, { paddingBottom: spacing.xxl * 2 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />
        }
        ListHeaderComponent={
          <View>
            <View style={styles.intro}>
              <MaterialCommunityIcons name="bullhorn-variant-outline" size={20} color={colors.accent} />
              <Text style={styles.introText}>
                {t('notice.intro')}{isAdmin ? ` ${t('notice.tapToPost')}` : ''}
              </Text>
            </View>

            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.actionBtn} onPress={() => setNoteVisible(true)} activeOpacity={0.85}>
                <MaterialCommunityIcons name="email-edit-outline" size={18} color={colors.accent} />
                <Text style={styles.actionBtnText}>{t('notice.noteToAdmins')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionBtn} onPress={openMyNotes} activeOpacity={0.85} testID="my-notes">
                <MaterialCommunityIcons name="email-check-outline" size={18} color={colors.accent} />
                <Text style={styles.actionBtnText}>{t('notice.myNotes')}</Text>
              </TouchableOpacity>
              {isAdmin && (
                <TouchableOpacity style={styles.actionBtn} onPress={openInbox} activeOpacity={0.85}>
                  <MaterialCommunityIcons name="inbox-arrow-down-outline" size={18} color={colors.accent} />
                  <Text style={styles.actionBtnText}>{t('notice.adminInbox')}</Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.searchBox}>
              <Ionicons name="search" size={16} color={colors.textMuted} />
              <TextInput value={query} onChangeText={setQuery} placeholder={t('notice.search')} placeholderTextColor={colors.placeholder}
                style={styles.searchInput} autoCorrect={false} returnKeyType="search" testID="notice-search" />
              {query ? (
                <TouchableOpacity onPress={() => setQuery('')} hitSlop={10} accessibilityLabel={t('common.clear')}>
                  <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              ) : null}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.catRow}>
              {['', ...CATEGORIES].map((c) => (
                <TouchableOpacity key={c || 'all'} onPress={() => setCategory(c)} testID={`cat-${c || 'all'}`}
                  style={[styles.chip, category === c && styles.chipOn]}>
                  <Text style={[styles.chipText, category === c && styles.chipTextOn]}>{c ? t(`notice.category.${c}`) : t('notice.all')}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        }
        ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.accent} style={styles.more} /> : null}
        ListEmptyComponent={
          loading ? <NoticeListSkeleton count={4} /> : failed ? (
            <View style={styles.empty}>
              <Ionicons name="cloud-offline-outline" size={48} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>{t('notice.loadFailed')}</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={() => { setLoading(true); load(); }} testID="notices-retry">
                <Text style={styles.retryText}>{t('common.retry')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.empty}>
              <MaterialCommunityIcons name="bulletin-board" size={56} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>{filtered ? t('notice.noMatch') : t('notice.none')}</Text>
              <Text style={styles.emptySub}>{isAdmin ? t('notice.postFirst') : t('notice.checkBack')}</Text>
            </View>
          )
        }
      />

      {isAdmin && (
        <TouchableOpacity style={[styles.fab, { bottom: spacing.lg + insets.bottom }]} onPress={() => setComposeVisible(true)}
          activeOpacity={0.85} accessibilityLabel={t('notice.new')} testID="notice-compose">
          <Ionicons name="add" size={28} color="#0A1628" />
        </TouchableOpacity>
      )}

      {/* Compose (admins only) */}
      <Modal visible={composeVisible} animationType="slide" transparent onRequestClose={() => setComposeVisible(false)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={[styles.modalSheet, { paddingBottom: spacing.md + insets.bottom }]}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editing ? t('notice.editTitle') : t('notice.new')}</Text>
              <TouchableOpacity onPress={() => { setComposeVisible(false); resetCompose(); }} accessibilityLabel={t('common.close')}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <TextInput style={styles.input} placeholder={t('notice.titlePlaceholder')} placeholderTextColor={colors.placeholder}
                value={title} onChangeText={setTitle} maxLength={200} testID="notice-title" />
              <TextInput style={[styles.input, styles.bodyInput]} placeholder={t('notice.bodyPlaceholder')}
                placeholderTextColor={colors.placeholder} value={body} onChangeText={setBody} multiline
                textAlignVertical="top" testID="notice-body" />
              <View style={styles.pinRow}>
                <View style={styles.pinLabelWrap}>
                  <MaterialCommunityIcons name="pin-outline" size={18} color={colors.textSecondary} />
                  <Text style={styles.pinLabel}>{t('notice.pinToTop')}</Text>
                </View>
                <Switch value={pinned} onValueChange={setPinned}
                  trackColor={{ false: 'rgba(255,255,255,0.15)', true: colors.accent }} thumbColor={colors.white} />
              </View>
              <Text style={styles.chipLabel}>{t('notice.kind')}</Text>
              <View style={styles.chipRow}>
                {CATEGORIES.map((c) => (
                  <TouchableOpacity key={c} onPress={() => setNoticeCategory(c)} style={[styles.chip, noticeCategory === c && styles.chipOn]} testID={`kind-${c}`}>
                    <Text style={[styles.chipText, noticeCategory === c && styles.chipTextOn]}>{t(`notice.category.${c}`)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {cover ? (
                <View style={styles.coverWrap}>
                  <Image source={{ uri: cover }} style={styles.coverPreview} contentFit="cover" />
                  <TouchableOpacity style={styles.coverRemove} onPress={() => setCover('')} accessibilityLabel={t('notice.removeCover')} testID="cover-remove">
                    <Ionicons name="close" size={16} color={colors.white} />
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={styles.coverAdd} onPress={pickCover} disabled={uploadingCover} testID="cover-add">
                  {uploadingCover ? <ActivityIndicator color={colors.accent} /> : (
                    <>
                      <Ionicons name="image-outline" size={18} color={colors.accent} />
                      <Text style={styles.coverAddText}>{t('notice.addCover')}</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
              <Text style={styles.chipLabel}>{t('notice.publish')}</Text>
              <View style={styles.chipRow}>
                {(editing ? ['keep', ...WHEN] : WHEN).map((k) => (
                  <TouchableOpacity key={k} onPress={() => setWhen(k)} style={[styles.chip, when === k && styles.chipOn]} testID={`when-${k}`}>
                    <Text style={[styles.chipText, when === k && styles.chipTextOn]}>{t(`notice.when.${k}`)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.chipLabel}>{t('notice.expires')}</Text>
              <View style={styles.chipRow}>
                {(editing ? ['keep', ...EXPIRY] : EXPIRY).map((k) => (
                  <TouchableOpacity key={k} onPress={() => setExpiry(k)} style={[styles.chip, expiry === k && styles.chipOn]} testID={`expiry-${k}`}>
                    <Text style={[styles.chipText, expiry === k && styles.chipTextOn]}>{t(`notice.expiry.${k}`)}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity style={[styles.postButton, posting && styles.postButtonDisabled]} onPress={handlePost}
                disabled={posting} activeOpacity={0.85} testID="notice-post">
                {posting ? <ActivityIndicator color="#0A1628" /> : (
                  <>
                    <Ionicons name="megaphone-outline" size={18} color="#0A1628" />
                    <Text style={styles.postButtonText}>{editing ? t('notice.save') : when === 'now' || when === 'keep' ? t('notice.post') : t('notice.schedule')}</Text>
                  </>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Note to admins (any signed-in user) */}
      <Modal visible={noteVisible} animationType="slide" transparent onRequestClose={() => setNoteVisible(false)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={[styles.modalSheet, { paddingBottom: spacing.md + insets.bottom }]}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('notice.noteToAdmins')}</Text>
              <TouchableOpacity onPress={() => { setNoteVisible(false); setNoteText(''); }} accessibilityLabel={t('common.close')}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <View style={styles.privacyHint}>
                <MaterialCommunityIcons name="lock-outline" size={16} color={colors.textMuted} />
                <Text style={styles.privacyHintText}>{t('notice.privateHint')}</Text>
              </View>
              <TextInput style={[styles.input, styles.bodyInput]} placeholder={t('notice.notePlaceholder')}
                placeholderTextColor={colors.placeholder} value={noteText} onChangeText={setNoteText} multiline
                textAlignVertical="top" maxLength={2000} testID="note-body" />
              <TouchableOpacity style={[styles.postButton, sendingNote && styles.postButtonDisabled]} onPress={handleSendNote}
                disabled={sendingNote} activeOpacity={0.85} testID="note-send">
                {sendingNote ? <ActivityIndicator color="#0A1628" /> : (
                  <>
                    <Ionicons name="send-outline" size={18} color="#0A1628" />
                    <Text style={styles.postButtonText}>{t('notice.sendToAdmins')}</Text>
                  </>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Admin inbox of received notes (admins only) */}
      <Modal visible={inboxVisible} animationType="slide" transparent onRequestClose={() => setInboxVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, styles.inboxSheet, { paddingBottom: spacing.md + insets.bottom }]}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('notice.notesFromUsers')}</Text>
              <TouchableOpacity onPress={() => setInboxVisible(false)} accessibilityLabel={t('common.close')}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            {inboxLoading ? <NoticeListSkeleton count={3} /> : (
              <FlatList
                data={inboxNotes}
                keyExtractor={(item) => item.id.toString()}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.inboxList}
                ListEmptyComponent={
                  <View style={styles.empty}>
                    <MaterialCommunityIcons name="email-open-outline" size={48} color={colors.textMuted} />
                    <Text style={styles.emptyTitle}>{t('notice.noNotes')}</Text>
                  </View>
                }
                renderItem={({ item }) => (
                  <View style={[styles.noteCard, !item.is_read && styles.noteCardUnread]}>
                    <Text style={styles.noteBody} selectable>{item.body}</Text>
                    <View style={styles.cardFooter}>
                      <MaterialCommunityIcons name="account-circle-outline" size={14} color={colors.textMuted} />
                      <Text style={styles.cardMeta}>{item.sender_username || t('notice.unknownSender')} · {formatDate(item.created_at)}</Text>
                    </View>
                    {item.reply ? (
                      <View style={styles.replyBox}>
                        <Text style={styles.replyLabel}>{t('notice.answered', { name: item.replied_by_username || t('notice.leadership') })}</Text>
                        <Text style={styles.replyText}>{item.reply}</Text>
                      </View>
                    ) : null}
                    {replyFor === item.id ? (
                      <View style={styles.replyEditor}>
                        <TextInput style={[styles.input, styles.replyInput]} value={replyText} onChangeText={setReplyText}
                          placeholder={t('notice.replyPlaceholder')} placeholderTextColor={colors.placeholder} multiline
                          maxLength={2000} testID={`reply-input-${item.id}`} />
                        <TouchableOpacity style={styles.replySend} onPress={() => sendReply(item)} testID={`reply-send-${item.id}`}>
                          <Ionicons name="send" size={16} color="#0A1628" />
                        </TouchableOpacity>
                      </View>
                    ) : null}
                    <View style={styles.noteActions}>
                      <TouchableOpacity style={styles.noteActionBtn} onPress={() => { setReplyFor(replyFor === item.id ? null : item.id); setReplyText(''); }}
                        testID={`reply-${item.id}`}>
                        <MaterialCommunityIcons name="reply-outline" size={16} color={colors.accent} />
                        <Text style={styles.noteActionText}>{item.reply ? t('notice.replyAgain') : t('notice.reply')}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.noteActionBtn} onPress={() => handleToggleNoteRead(item)}>
                        <MaterialCommunityIcons name={item.is_read ? 'email-outline' : 'email-open-outline'} size={16} color={colors.accent} />
                        <Text style={styles.noteActionText}>{item.is_read ? t('notice.markUnread') : t('notice.markRead')}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.noteActionBtn} onPress={() => handleDeleteNote(item)}>
                        <Ionicons name="trash-outline" size={16} color={colors.error} />
                        <Text style={[styles.noteActionText, styles.dangerText]}>{t('common.delete')}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              />
            )}
          </View>
        </View>
      </Modal>

      {/* The notes I sent: read yet, and the admins' answer */}
      <Modal visible={myNotesVisible} animationType="slide" transparent onRequestClose={() => setMyNotesVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, styles.inboxSheet, { paddingBottom: spacing.md + insets.bottom }]}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('notice.myNotes')}</Text>
              <TouchableOpacity onPress={() => setMyNotesVisible(false)} accessibilityLabel={t('common.close')}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            {myNotes === null ? <NoticeListSkeleton count={2} /> : (
              <FlatList
                data={myNotes}
                keyExtractor={(item) => item.id.toString()}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.inboxList}
                ListEmptyComponent={
                  <View style={styles.empty}>
                    <MaterialCommunityIcons name="email-outline" size={48} color={colors.textMuted} />
                    <Text style={styles.emptyTitle}>{t('notice.noMyNotes')}</Text>
                  </View>
                }
                renderItem={({ item }) => (
                  <View style={styles.noteCard} testID={`my-note-${item.id}`}>
                    <Text style={styles.noteBody} selectable>{item.body}</Text>
                    <View style={styles.cardFooter}>
                      <MaterialCommunityIcons name={item.is_read ? 'check-all' : 'check'} size={14} color={item.is_read ? colors.accent : colors.textMuted} />
                      <Text style={styles.cardMeta}>{formatDate(item.created_at)} · {item.is_read ? t('notice.readByAdmins') : t('notice.notReadYet')}</Text>
                    </View>
                    {item.reply ? (
                      <View style={styles.replyBox}>
                        <Text style={styles.replyLabel}>{t('notice.answered', { name: item.replied_by_username || t('notice.leadership') })}</Text>
                        <Text style={styles.replyText} selectable>{item.reply}</Text>
                      </View>
                    ) : null}
                  </View>
                )}
              />
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  manageRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cardCover: { width: '100%', height: 150, borderRadius: radius.md, marginBottom: spacing.sm, backgroundColor: 'rgba(255,255,255,0.05)' },
  cardUrgent: { borderColor: 'rgba(229,57,53,0.55)' },
  catTag: { paddingHorizontal: 7, paddingVertical: 1, borderRadius: radius.full, backgroundColor: 'rgba(244,162,97,0.14)' },
  catTagUrgent: { backgroundColor: 'rgba(229,57,53,0.18)' },
  catTagText: { ...typography.caption, color: colors.accent, fontWeight: '700' },
  catTagTextUrgent: { color: '#FF8A80' },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, minHeight: 40, marginBottom: spacing.sm,
    borderRadius: radius.full, backgroundColor: GLASS, borderWidth: StyleSheet.hairlineWidth, borderColor: GLASS_EDGE,
  },
  searchInput: { flex: 1, color: colors.textPrimary, paddingVertical: spacing.xs, fontSize: 15 },
  catRow: { gap: spacing.xs, paddingBottom: spacing.md },
  coverWrap: { marginBottom: spacing.md },
  coverPreview: { width: '100%', height: 150, borderRadius: radius.md },
  coverRemove: { position: 'absolute', top: 8, right: 8, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  coverAdd: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 48, marginBottom: spacing.md,
    borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(244,162,97,0.5)',
  },
  coverAddText: { ...typography.caption, color: colors.accent, fontWeight: '700' },
  statusTag: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 1,
    borderRadius: radius.full, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.25)',
  },
  statusText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  chipLabel: { ...typography.caption, color: colors.textSecondary, fontWeight: '700', marginBottom: 6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.md },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.full, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  chipOn: { backgroundColor: 'rgba(244,162,97,0.18)', borderColor: colors.accent },
  chipText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  chipTextOn: { color: colors.accent },
  replyBox: { marginTop: spacing.sm, padding: spacing.sm, borderRadius: radius.md, backgroundColor: 'rgba(244,162,97,0.08)', borderLeftWidth: 3, borderLeftColor: colors.accent },
  replyLabel: { ...typography.caption, color: colors.accent, fontWeight: '700', marginBottom: 2 },
  replyText: { ...typography.body, color: colors.textPrimary },
  replyEditor: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs, marginTop: spacing.sm },
  replyInput: { flex: 1, marginBottom: 0, minHeight: 44 },
  replySend: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  root: { flex: 1, backgroundColor: colors.bg },
  listContent: { padding: spacing.md, width: '100%', maxWidth: 820, alignSelf: 'center' },
  more: { marginVertical: spacing.md },

  intro: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: GLASS,
    borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: GLASS_EDGE,
    padding: spacing.md, marginBottom: spacing.md,
  },
  introText: { ...typography.caption, color: colors.textSecondary, flex: 1, lineHeight: 18 },

  actionRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: GLASS, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,162,97,0.35)',
    borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm,
  },
  actionBtnText: { ...typography.caption, color: colors.accent, fontWeight: '700' },

  privacyHint: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.md },
  privacyHintText: { ...typography.caption, color: colors.textMuted, flex: 1 },

  noteCard: {
    backgroundColor: GLASS, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth,
    borderColor: GLASS_EDGE, padding: spacing.md, marginBottom: spacing.md,
  },
  noteCardUnread: { borderColor: 'rgba(244,162,97,0.55)' },
  noteBody: { ...typography.body, color: colors.textPrimary },
  noteActions: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.md },
  noteActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  noteActionText: { ...typography.caption, color: colors.accent, fontWeight: '600' },
  dangerText: { color: colors.error },

  card: {
    backgroundColor: GLASS, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth,
    borderColor: GLASS_EDGE, padding: spacing.md, marginBottom: spacing.md,
  },
  cardPinned: { borderColor: 'rgba(244,162,97,0.55)', backgroundColor: 'rgba(24,18,12,0.7)' },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  pinnedTag: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  newTag: { paddingHorizontal: 7, paddingVertical: 1, borderRadius: radius.full, backgroundColor: colors.accent },
  newTagText: { color: '#0A1628', fontSize: 11, fontWeight: '800' },
  pinnedText: { ...typography.caption, color: colors.accent, fontWeight: '700' },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  cardTitle: { ...typography.h3, color: colors.textPrimary, flex: 1 },
  cardBody: { ...typography.body, color: colors.textSecondary, marginTop: spacing.xs },
  cardFooter: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: spacing.md },
  cardMeta: { ...typography.caption, color: colors.textMuted },

  empty: { alignItems: 'center', paddingVertical: spacing.xxl },
  emptyTitle: { ...typography.h3, color: colors.textPrimary, marginTop: spacing.md, textAlign: 'center' },
  emptySub: { ...typography.body, color: colors.textMuted, marginTop: spacing.xs, textAlign: 'center', paddingHorizontal: spacing.lg },
  retryBtn: { marginTop: spacing.md, backgroundColor: colors.accent, borderRadius: radius.full, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  retryText: { color: '#0A1628', fontWeight: '800' },

  fab: {
    position: 'absolute', right: spacing.lg, width: 56, height: 56, borderRadius: radius.full,
    backgroundColor: colors.accent, justifyContent: 'center', alignItems: 'center', elevation: 6,
    shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
  },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: '#0B1119', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    padding: spacing.md, maxHeight: '88%', width: '100%', maxWidth: 720, alignSelf: 'center',
    borderTopWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,162,97,0.3)',
  },
  inboxSheet: { maxHeight: '88%' },
  inboxList: { paddingBottom: spacing.xl },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: spacing.md },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  modalTitle: { ...typography.h2, color: colors.textPrimary },
  input: {
    backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: radius.md, padding: spacing.md, color: colors.textPrimary, fontSize: 15, marginBottom: spacing.md,
  },
  bodyInput: { minHeight: 140 },
  pinRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg },
  pinLabelWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pinLabel: { ...typography.body, color: colors.textPrimary },
  postButton: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.accent, height: 52, borderRadius: radius.md, marginBottom: spacing.md,
  },
  postButtonDisabled: { opacity: 0.6 },
  postButtonText: { ...typography.button, color: '#0A1628', fontSize: 16, fontWeight: '800' },
});

export default NoticeBoard;
