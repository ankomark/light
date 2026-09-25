// Discover's shelves, over the list of every book: Continue reading, Editor's
// picks, Trending this week (by readers who finish, not clicks), From authors
// you follow, New releases, Rising authors. Paints its last copy at once and
// refreshes behind it; a shelf with nothing on it isn't shown.
import React, { memo, useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { fetchBooksHome } from '../services/api';
import { peekCache, readCache, writeCache, userKey } from '../utils/screenCache';
import { colors, typography, spacing, radius } from '../constants/theme';
import { useI18n } from '../context/I18nContext';
import { useAuth } from '../context/useAuth';

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');
const SHELVES = ['continue', 'picks', 'trending', 'following', 'new'];

export const Stars = ({ avg, count, size = 11, color = colors.accent }) => (avg ? (
  <View style={styles.stars}>
    <Ionicons name="star" size={size} color={color} />
    <Text style={[styles.starsText, { fontSize: size }]}>{`${avg}${count ? ` (${count})` : ''}`}</Text>
  </View>
) : null);

const BookTile = memo(({ item, onOpen, t, showProgress }) => {
  const pct = item.my_finished ? 1 : item.my_percent || 0;
  return (
    <TouchableOpacity style={styles.tile} onPress={() => onOpen(item)} activeOpacity={0.85}
      accessibilityRole="button" accessibilityLabel={item.title} testID={`home-book-${item.id}`}>
      {item.cover ? (
        <Image source={{ uri: item.cover }} style={styles.cover} contentFit="cover" transition={150} />
      ) : (
        <View style={[styles.cover, styles.coverFallback]}>
          <MaterialIcons name="menu-book" size={30} color={colors.textMuted} />
          <Text style={styles.coverTitle} numberOfLines={3}>{item.title}</Text>
        </View>
      )}
      {showProgress && pct > 0 ? (
        <View style={styles.track}><View style={[styles.fill, { width: `${Math.round(pct * 100)}%` }]} /></View>
      ) : null}
      <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
      <Text style={styles.author} numberOfLines={1}>{item.author?.username || t('articles.unknownAuthor')}</Text>
      <Stars avg={item.rating_avg} />
    </TouchableOpacity>
  );
});

const AuthorChip = memo(({ item, onOpen, t }) => (
  <TouchableOpacity style={styles.author_} onPress={() => onOpen(item)} activeOpacity={0.85}
    accessibilityRole="button" accessibilityLabel={item.username} testID={`home-author-${item.id}`}>
    <Image source={item.profile_picture ? { uri: item.profile_picture } : DEFAULT_AVATAR} style={styles.avatar} contentFit="cover" />
    <Text style={styles.authorName} numberOfLines={1}>{item.username}</Text>
    <Text style={styles.growth} numberOfLines={1}>
      {item.growth > 0 ? t('home.risingGrowth', { n: Math.round(item.growth * 100) }) : t('home.readers', { n: item.readers })}
    </Text>
  </TouchableOpacity>
));

// A publisher (a verified organisation) on Discover: its logo and name.
const PublisherChip = memo(({ item, navigation, t }) => (
  <TouchableOpacity style={styles.author_} testID={`publisher-${item.slug}`}
    onPress={() => navigation.navigate('OrganizationPage', { slug: item.slug, name: item.name })}>
    {item.logo ? <Image source={{ uri: item.logo }} style={styles.orgLogo} contentFit="cover" /> : (
      <View style={[styles.orgLogo, styles.orgLogoFallback]}><Ionicons name="business" size={26} color={colors.accent} /></View>
    )}
    <View style={styles.orgNameRow}>
      <Text style={styles.authorName} numberOfLines={1}>{item.name}</Text>
      <Ionicons name="checkmark-circle" size={12} color={colors.primary} />
    </View>
    <Text style={styles.growth}>{t('home.booksN', { n: item.books_count })}</Text>
  </TouchableOpacity>
));

const Shelf = ({ title, subtitle, data, renderItem, keyOf, testID }) => (data?.length ? (
  <View style={styles.shelf} testID={testID}>
    <Text style={styles.shelfTitle}>{title}</Text>
    {subtitle ? <Text style={styles.shelfSub} numberOfLines={2}>{subtitle}</Text> : null}
    <FlatList
      horizontal
      data={data}
      keyExtractor={keyOf}
      renderItem={renderItem}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.rail}
      initialNumToRender={4}
    />
  </View>
) : null);

const BooksHome = ({ navigation }) => {
  const { t } = useI18n();
  const { currentUser } = useAuth();
  const key = userKey(currentUser?.id, 'books:home');
  const [home, setHome] = useState(() => peekCache(key));

  const load = useCallback(async () => {
    if (!peekCache(key)) {
      const kept = await readCache(key);
      if (kept) setHome(kept);
    }
    try {
      const fresh = await fetchBooksHome();
      setHome(fresh);
      writeCache(key, fresh);
    } catch {
      // offline: the kept shelves stand (or none, and the list below still shows)
    }
  }, [key]);
  useEffect(() => { load(); }, [load]);
  // Back from a book: Continue reading moved on.
  const [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => {
    if (focused) load(); else setFocused(true);
  }, [focused, load]));

  const openBook = useCallback((b) => navigation.navigate('PublicationDetail', { id: b.id, preview: b }), [navigation]);
  const openAuthor = useCallback((u) => navigation.navigate('AuthorPage', { userId: u.id, username: u.username }), [navigation]);

  if (!home) return null;
  return (
    <View testID="books-home">
      {SHELVES.map((s) => (
        <React.Fragment key={s}>
          <Shelf
            title={t(`home.${s}`)}
            data={home[s]}
            keyOf={(b) => `${s}_${b.id}`}
            renderItem={({ item }) => <BookTile item={item} onOpen={openBook} t={t} showProgress={s === 'continue'} />}
          />
          {/* Right after what they're reading: books near the passage they last marked. */}
          {s === 'continue' && home.because ? (
            <Shelf
              testID="home-because"
              title={t('home.because', { title: home.because.title })}
              subtitle={`“${home.because.quote}”`}
              data={home.because.books}
              keyOf={(b) => `because_${b.id}`}
              renderItem={({ item }) => <BookTile item={item} onOpen={openBook} t={t} />}
            />
          ) : null}
        </React.Fragment>
      ))}
      {home.publishers?.length ? (
        <View style={styles.shelf} testID="home-publishers">
          <View style={styles.shelfHead}>
            <Text style={[styles.shelfTitle, styles.flex]}>{t('home.publishers')}</Text>
            <TouchableOpacity onPress={() => navigation.navigate('Organizations')} hitSlop={8} testID="home-publishers-all">
              <Text style={styles.seeAll}>{t('home.seeAll')}</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            horizontal
            data={home.publishers}
            keyExtractor={(o) => `org_${o.slug}`}
            renderItem={({ item }) => <PublisherChip item={item} navigation={navigation} t={t} />}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.rail}
          />
        </View>
      ) : null}
      <Shelf
        title={t('home.rising')}
        data={home.rising}
        keyOf={(u) => `rising_${u.id}`}
        renderItem={({ item }) => <AuthorChip item={item} onOpen={openAuthor} t={t} />}
      />
      <Text style={styles.allTitle}>{t('home.allBooks')}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  shelf: { marginBottom: spacing.md },
  shelfTitle: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.sm },
  shelfSub: { ...typography.caption, color: colors.textSecondary, fontStyle: 'italic', marginTop: -spacing.xs, marginBottom: spacing.sm },
  rail: { gap: spacing.md, paddingRight: spacing.md },
  tile: { width: 112 },
  cover: { width: 112, height: 160, borderRadius: radius.md, backgroundColor: colors.surface },
  coverFallback: { alignItems: 'center', justifyContent: 'center', padding: spacing.sm, gap: 6 },
  coverTitle: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', fontWeight: '700' },
  track: { height: 3, borderRadius: 2, backgroundColor: colors.surface, marginTop: 4, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.accent },
  title: { ...typography.caption, color: colors.textPrimary, fontWeight: '700', marginTop: 6, lineHeight: 16 },
  author: { ...typography.caption, color: colors.textMuted, fontSize: 11, marginTop: 1 },
  stars: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  starsText: { color: colors.textSecondary, fontWeight: '700' },
  author_: { width: 96, alignItems: 'center' },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.surface },
  authorName: { ...typography.caption, color: colors.textPrimary, fontWeight: '700', marginTop: 6 },
  growth: { ...typography.caption, color: colors.accent, fontSize: 11 },
  flex: { flex: 1 },
  shelfHead: { flexDirection: 'row', alignItems: 'baseline' },
  seeAll: { ...typography.caption, color: colors.primary, fontWeight: '800' },
  orgLogo: { width: 64, height: 64, borderRadius: 14, backgroundColor: colors.surface },
  orgLogoFallback: { alignItems: 'center', justifyContent: 'center' },
  orgNameRow: { flexDirection: 'row', alignItems: 'center', gap: 3, maxWidth: 96 },
  allTitle: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.sm, marginTop: spacing.xs },
});

export default BooksHome;
