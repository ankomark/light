// src/components/FavoritesPage.js
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { getFavoriteTracks } from '../services/api';
import TrackItem from './TrackItem';
import { colors, spacing, typography } from '../constants/theme';

const FavoritesPage = () => {
  const [favoriteTracks, setFavoriteTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await getFavoriteTracks();
      setFavoriteTracks(Array.isArray(data) ? data : []);
    } catch {
      setError('Could not load your favorites. Pull down to retry.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Reload every time the screen comes into focus so tracks favorited
  // elsewhere show up here immediately.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const handleRemoved = useCallback((id) => {
    setFavoriteTracks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  if (loading && !refreshing) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.header}>My Favorites</Text>

      <FlatList
        data={favoriteTracks}
        keyExtractor={(track) => track.id.toString()}
        renderItem={({ item }) => (
          <TrackItem track={item} onDelete={handleRemoved} onRefresh={load} />
        )}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="heart-outline" size={48} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>
              {error ? 'Something went wrong' : 'No favorites yet'}
            </Text>
            <Text style={styles.emptyText}>
              {error || 'Tap the heart on any track to save it here.'}
            </Text>
          </View>
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    ...typography.h2,
    color: colors.textPrimary,
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
  list: {
    paddingBottom: 110,
    flexGrow: 1,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
  },
  emptyTitle: {
    ...typography.h3,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
});

export default FavoritesPage;
