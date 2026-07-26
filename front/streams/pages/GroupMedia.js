import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator,
  Modal, Pressable, useWindowDimensions, Linking,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { fetchGroupMedia } from '../services/api';
import RotatingBackground from '../components/RotatingBackground';
import { colors, typography, spacing } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const COLS = 3;
const GAP = 3;

const GroupMedia = (props) => {
  const { t } = useI18n();
  // Reactive media-grid tile — reflows on rotation / web resize (was a
  // module-scope Dimensions.get snapshot).
  const { width: winW } = useWindowDimensions();
  const tile = Math.floor((winW - GAP * (COLS - 1)) / COLS);
  const groupSlug = props.groupSlug ?? props.route?.params?.groupSlug;
  const onClose = props.onClose ?? (() => props.navigation?.goBack());

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [viewer, setViewer] = useState(null);

  const load = useCallback(async (pageNum = 1) => {
    try {
      if (pageNum === 1) setLoading(true); else setLoadingMore(true);
      const res = await fetchGroupMedia(groupSlug, pageNum);
      const rows = res?.results ?? (Array.isArray(res) ? res : []);
      setItems((prev) => (pageNum === 1 ? rows : [...prev, ...rows]));
      setHasNext(!!res?.next);
      setPage(pageNum);
    } catch {
      // silent — the screen just shows what loaded
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [groupSlug]);

  useEffect(() => { load(1); }, [load]);

  const openItem = (item) => {
    if (item.message_type === 'image') setViewer(item.attachment);
    else if (item.attachment) Linking.openURL(item.attachment).catch(() => {});
  };

  const renderTile = ({ item }) => (
    <TouchableOpacity style={[styles.tile, { width: tile, height: tile }]} activeOpacity={0.85} onPress={() => openItem(item)}>
      {item.message_type === 'image' ? (
        <Image
          source={{ uri: item.attachment }}
          style={styles.tileImage}
          contentFit="cover"
          transition={150}
          placeholder={item.attachment_blurhash ? { blurhash: item.attachment_blurhash } : undefined}
        />
      ) : (
        <View style={styles.tileDoc}>
          <Ionicons
            name={item.message_type === 'audio' ? 'mic' : 'document-text'}
            size={26}
            color={colors.accent}
          />
          <Text style={styles.tileDocName} numberOfLines={2}>
            {item.message_type === 'audio' ? t('group.media.voiceNote') : (item.file_name || t('group.media.file'))}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );

  return (
    <Modal animationType="slide" transparent={false} visible onRequestClose={onClose}>
      <View style={styles.root}>
        <RotatingBackground intervalMs={45000} scrimColor="rgba(10,22,40,0.78)" />
        <SafeAreaView style={styles.safe} edges={['top']}>
          <View style={styles.header}>
            <Text style={styles.title}>{t('group.media.title')}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.centered}><ActivityIndicator size="large" color={colors.accent} /></View>
          ) : (
            <FlatList
              data={items}
              keyExtractor={(item) => String(item.id)}
              renderItem={renderTile}
              numColumns={COLS}
              columnWrapperStyle={{ gap: GAP }}
              contentContainerStyle={styles.grid}
              showsVerticalScrollIndicator={false}
              onEndReachedThreshold={0.5}
              onEndReached={() => { if (hasNext && !loadingMore) load(page + 1); }}
              ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.accent} style={{ marginVertical: spacing.md }} /> : null}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Ionicons name="images-outline" size={48} color={colors.textMuted} />
                  <Text style={styles.emptyText}>{t('group.media.empty')}</Text>
                </View>
              }
            />
          )}
        </SafeAreaView>

        <Modal visible={!!viewer} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
          <Pressable style={styles.viewerRoot} onPress={() => setViewer(null)}>
            <Image source={{ uri: viewer }} style={styles.viewerImage} contentFit="contain" transition={150} />
            <View style={styles.viewerClose}><Ionicons name="close" size={28} color={colors.white} /></View>
          </Pressable>
        </Modal>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0A1628' },
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  title: { ...typography.h2, color: colors.textPrimary, fontWeight: '800' },
  closeBtn: {
    width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)',
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  grid: { gap: GAP, paddingBottom: spacing.xl, flexGrow: 1 },
  tile: { borderRadius: 4, overflow: 'hidden', backgroundColor: 'rgba(16,46,80,0.55)' },  // width/height inline (reactive)
  tileImage: { width: '100%', height: '100%' },
  tileDoc: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.xs, padding: spacing.xs },
  tileDocName: { ...typography.caption, color: colors.textSecondary, fontSize: 10, textAlign: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 80, gap: spacing.sm },
  emptyText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },

  viewerRoot: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', alignItems: 'center', justifyContent: 'center' },
  viewerImage: { width: '100%', height: '80%' },
  viewerClose: { position: 'absolute', top: 48, right: 20 },
});

export default GroupMedia;
