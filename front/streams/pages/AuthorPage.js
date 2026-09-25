// An author's page: who they are (verified tick), followers, readers (people
// who've read their books), books finished by readers, a follow button, and
// their books. Paints its last copy at once and refreshes behind it.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { fetchAuthorPage } from '../services/api';
import FollowButton from '../components/FollowButton';
import { Stars } from '../components/BooksHome';
import { peekCache, readCache, writeCache, userKey } from '../utils/screenCache';
import { categoryLabel } from '../utils/publications';
import { colors, typography, spacing, radius } from '../constants/theme';
import { useI18n } from '../context/I18nContext';
import { useAuth } from '../context/useAuth';

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');

const count = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : String(n || 0));

const AuthorPage = ({ route, navigation }) => {
  const { t } = useI18n();
  const { currentUser, isAuthenticated } = useAuth();
  const { userId, username = '' } = route.params || {};
  const key = userKey(currentUser?.id, `author:${userId}`);
  const [data, setData] = useState(() => peekCache(key));
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    if (!peekCache(key)) {
      const kept = await readCache(key);
      if (kept) setData(kept);
    }
    try {
      const fresh = await fetchAuthorPage(userId);
      setData(fresh);
      writeCache(key, fresh);
    } catch {
      setFailed(true);
    }
  }, [key, userId]);
  useEffect(() => { load(); }, [load]);

  const a = data?.author;
  const header = a ? (
    <View style={styles.head}>
      <Image source={a.profile_picture ? { uri: a.profile_picture } : DEFAULT_AVATAR} style={styles.avatar} contentFit="cover" />
      <View style={styles.nameRow}>
        <Text style={styles.name}>{a.username}</Text>
        {a.verified ? <MaterialIcons name="verified" size={20} color={colors.primary} /> : null}
      </View>
      {a.verified ? <Text style={styles.verified}>{t('author.verified')}</Text> : null}
      <View style={styles.stats}>
        <View style={styles.stat}><Text style={styles.statN}>{count(data.readers_count)}</Text><Text style={styles.statL}>{t('author.readers')}</Text></View>
        <View style={styles.stat}><Text style={styles.statN}>{count(data.followers_count)}</Text><Text style={styles.statL}>{t('author.followers')}</Text></View>
        <View style={styles.stat}><Text style={styles.statN}>{count(data.finished_count)}</Text><Text style={styles.statL}>{t('author.finished')}</Text></View>
      </View>
      {isAuthenticated && currentUser?.id !== a.id ? (
        <View style={styles.follow}><FollowButton userId={a.id} initialFollowing={data.is_following} /></View>
      ) : null}
      <TouchableOpacity onPress={() => navigation.navigate('UserProfile', { userId: a.id, username: a.username })}
        style={styles.profileLink} testID="author-profile">
        <Text style={styles.profileLinkText}>{t('author.fullProfile')}</Text>
      </TouchableOpacity>
      <Text style={styles.booksTitle}>{t('author.books', { n: data.books.length })}</Text>
    </View>
  ) : null;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={10}
          accessibilityRole="button" accessibilityLabel={t('common.back')}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topTitle} numberOfLines={1}>{a?.username || username}</Text>
        <View style={styles.iconBtn} />
      </View>
      {!data ? (
        <View style={styles.centered}>
          {failed ? (
            <>
              <Ionicons name="cloud-offline-outline" size={40} color={colors.textMuted} />
              <Text style={styles.muted}>{t('author.loadFailed')}</Text>
              <TouchableOpacity style={styles.btn} onPress={load} testID="author-retry">
                <Text style={styles.btnText}>{t('common.retry')}</Text>
              </TouchableOpacity>
            </>
          ) : <ActivityIndicator color={colors.primary} />}
        </View>
      ) : (
        <FlatList
          data={data.books}
          keyExtractor={(b) => String(b.id)}
          ListHeaderComponent={header}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.muted}>{t('author.noBooks')}</Text>}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.row} activeOpacity={0.85} testID={`author-book-${item.id}`}
              onPress={() => navigation.navigate('PublicationDetail', { id: item.id, preview: item })}>
              {item.cover ? <Image source={{ uri: item.cover }} style={styles.cover} contentFit="cover" />
                : <View style={[styles.cover, styles.coverFallback]}><MaterialIcons name="menu-book" size={24} color={colors.textMuted} /></View>}
              <View style={styles.rowBody}>
                <Text style={styles.cat}>{categoryLabel(item.category, t)}</Text>
                <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
                {item.summary ? <Text style={styles.summary} numberOfLines={2}>{item.summary}</Text> : null}
                <Stars avg={item.rating_avg} count={item.rating_count} />
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  topTitle: { ...typography.h3, color: colors.textPrimary, flex: 1, textAlign: 'center' },
  iconBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.lg },
  muted: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
  btn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  btnText: { ...typography.label, color: colors.white, fontWeight: '700' },
  list: { padding: spacing.md, width: '100%', maxWidth: 760, alignSelf: 'center' },
  head: { alignItems: 'center', marginBottom: spacing.md },
  avatar: { width: 96, height: 96, borderRadius: 48, backgroundColor: colors.surface },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm },
  name: { ...typography.h2, color: colors.textPrimary },
  verified: { ...typography.caption, color: colors.primary, fontWeight: '700', marginTop: 2 },
  stats: { flexDirection: 'row', gap: spacing.xl, marginTop: spacing.md },
  stat: { alignItems: 'center' },
  statN: { ...typography.h3, color: colors.textPrimary, fontWeight: '800' },
  statL: { ...typography.caption, color: colors.textMuted },
  follow: { marginTop: spacing.md },
  profileLink: { marginTop: spacing.sm, padding: spacing.xs },
  profileLinkText: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  booksTitle: { ...typography.h3, color: colors.textPrimary, alignSelf: 'flex-start', marginTop: spacing.lg },
  row: {
    flexDirection: 'row', gap: spacing.md, padding: spacing.sm, marginBottom: spacing.sm,
    backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
  },
  cover: { width: 64, height: 88, borderRadius: radius.sm, backgroundColor: colors.surface },
  coverFallback: { alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1, justifyContent: 'center' },
  cat: { ...typography.caption, color: colors.accent, fontWeight: '800', fontSize: 10.5, textTransform: 'uppercase' },
  title: { ...typography.label, color: colors.textPrimary, fontWeight: '700', marginTop: 2 },
  summary: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
});

export default AuthorPage;
