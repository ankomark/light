// A #tag's page: the tag, how many posts carry it, and those posts as a grid.
// Opened by tapping a hashtag in any caption.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather, Ionicons } from '@expo/vector-icons';
import { fetchHashtagInfo, fetchPostsByTag } from '../services/api';
import RotatingBackground from './RotatingBackground';
import formatCount from '../utils/formatCount';
import { useI18n } from '../context/I18nContext';
import { colors, spacing, radius } from '../constants/theme';

const COLS = 3;
const GAP = 2;

const thumbOf = (post) =>
  post.thumbnail_url || post.media_items?.[0]?.optimized_url || post.media_items?.[0]?.media_url || post.media_url;

const HashtagScreen = ({ route, navigation }) => {
  const { t } = useI18n();
  const tag = String(route.params?.tag || '').replace(/^#/, '').toLowerCase();
  const { width } = useWindowDimensions();
  const cell = (width - GAP * (COLS - 1)) / COLS;

  const [count, setCount] = useState(null);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const pageRef = useRef(1);
  const hasMoreRef = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    pageRef.current = 1;
    try {
      const [info, res] = await Promise.all([
        fetchHashtagInfo(tag).catch(() => null),
        fetchPostsByTag(tag, 1),
      ]);
      if (info) setCount(info.posts_count);
      setPosts(res?.results ?? (Array.isArray(res) ? res : []));
      hasMoreRef.current = !!res?.next;
    } catch {
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, [tag]);

  useEffect(() => { load(); }, [load]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMoreRef.current) return;
    setLoadingMore(true);
    try {
      const res = await fetchPostsByTag(tag, pageRef.current + 1);
      pageRef.current += 1;
      const more = res?.results ?? [];
      setPosts((prev) => {
        const have = new Set(prev.map((p) => p.id));
        return [...prev, ...more.filter((p) => !have.has(p.id))];
      });
      hasMoreRef.current = !!res?.next;
    } catch {
      hasMoreRef.current = false;
    } finally {
      setLoadingMore(false);
    }
  }, [tag, loadingMore]);

  const renderItem = useCallback(({ item }) => (
    <TouchableOpacity
      style={{ width: cell, height: cell * 1.3 }}
      activeOpacity={0.85}
      onPress={() => navigation.navigate('PostDetail', { postId: item.id })}
    >
      <Image source={{ uri: thumbOf(item) }} style={styles.thumb} contentFit="cover" cachePolicy="memory-disk" transition={120} />
      {item.content_type === 'video' && (
        <View style={styles.videoBadge}><Ionicons name="play" size={12} color="#fff" /></View>
      )}
    </TouchableOpacity>
  ), [cell, navigation]);

  return (
    <View style={styles.root}>
      <RotatingBackground intervalMs={60000} scrimColor="rgba(8,18,34,0.78)" />
      <SafeAreaView edges={['top']} style={styles.flex}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} style={styles.back}>
            <Feather name="arrow-left" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <View style={styles.hashBadge}><Text style={styles.hashBig}>#</Text></View>
          <View style={styles.flex}>
            <Text style={styles.title} numberOfLines={1}>{tag}</Text>
            <Text style={styles.sub}>
              {count == null ? ' ' : t('sound.uses', { count: formatCount(count) })}
            </Text>
          </View>
        </View>

        {loading ? (
          <ActivityIndicator style={styles.spinner} color={colors.primary} />
        ) : (
          <FlatList
            data={posts}
            keyExtractor={(p) => String(p.id)}
            numColumns={COLS}
            columnWrapperStyle={{ gap: GAP }}
            contentContainerStyle={{ gap: GAP, paddingBottom: spacing.xl }}
            renderItem={renderItem}
            onEndReached={loadMore}
            onEndReachedThreshold={0.6}
            ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.spinnerSmall} color={colors.primary} /> : null}
            ListEmptyComponent={<Text style={styles.empty}>{t('hashtag.empty')}</Text>}
          />
        )}
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  hashBadge: {
    width: 52, height: 52, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(29,161,242,0.16)', borderWidth: 1, borderColor: 'rgba(29,161,242,0.5)',
  },
  hashBig: { color: colors.primary, fontSize: 28, fontWeight: '900' },
  title: { color: colors.textPrimary, fontSize: 22, fontWeight: '800' },
  sub: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  thumb: { flex: 1, backgroundColor: colors.surface },
  videoBadge: { position: 'absolute', top: 6, right: 6 },
  spinner: { marginTop: spacing.xl },
  spinnerSmall: { marginVertical: spacing.md },
  empty: { color: colors.textMuted, textAlign: 'center', marginTop: spacing.xl },
});

export default HashtagScreen;
