// The top of the Music screen, from one request (GET /music/home/):
//
//   Recently played · Made for you · Top 50 <your country> / Top 50 Global
//   · Trending this week · New releases · From artists you follow · Genres
//
// Sections with nothing in them are left out, so a brand-new app still
// opens on a tidy page. Rails play as a queue from the tapped song.
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import TrackRail from './TrackRail';
import PlaylistCover from './PlaylistCover';
import { countryName } from '../utils/region';
import { genreName } from '../utils/genres';
import { colors, spacing, radius } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const coversOf = (tracks = []) => tracks
  .map((tr) => tr.cover_small || tr.cover_image)
  .filter(Boolean)
  .slice(0, 4);

const ChartCard = ({ title, sub, tracks, onPress, tint }) => (
  <TouchableOpacity style={[styles.chartCard, { borderColor: tint }]} onPress={onPress} activeOpacity={0.85} accessibilityRole="button">
    <PlaylistCover images={coversOf(tracks)} size={64} radius={8} />
    <View style={styles.chartText}>
      <Text style={styles.chartTitle} numberOfLines={2}>{title}</Text>
      <Text style={styles.chartSub} numberOfLines={1}>{sub}</Text>
    </View>
  </TouchableOpacity>
);

const MusicHome = ({ home, sideMargin = 0, reasonLabel }) => {
  const { t } = useI18n();
  const navigation = useNavigation();
  if (!home) return null;
  const rail = { marginHorizontal: -sideMargin, marginTop: spacing.sm };
  const { top_country: topCountry, top_world: topWorld } = home;
  const openChart = (chart, country = '') => navigation.navigate('MusicChart', { chart, country });

  return (
    <View>
      <TrackRail title={t('music.recentlyPlayed')} tracks={home.recent} source="recent" style={rail} />
      <TrackRail title={t('music.madeForYou')} tracks={home.for_you} reasonLabel={reasonLabel} source="for_you" style={rail} />

      {(topCountry || topWorld) ? (
        <View style={styles.charts}>
          {topCountry ? (
            <ChartCard
              title={t('music.topCountry', { country: countryName(topCountry.country) })}
              sub={t('music.chartSub')}
              tracks={topCountry.tracks}
              tint="#E8C66B"
              onPress={() => openChart('top', topCountry.country)}
            />
          ) : null}
          {topWorld ? (
            <ChartCard
              title={t('music.topWorld')}
              sub={t('music.chartSub')}
              tracks={topWorld.tracks}
              tint={colors.primary}
              onPress={() => openChart('top')}
            />
          ) : null}
        </View>
      ) : null}

      <TrackRail
        title={t('music.trending')}
        tracks={home.trending}
        source="trending"
        style={rail}
        action={{ label: t('music.seeAll'), onPress: () => openChart('trending', topCountry?.country || '') }}
      />
      <TrackRail title={t('music.newReleases')} tracks={home.new_releases} source="new" style={rail} />
      <TrackRail title={t('music.fromFollowing')} tracks={home.following} source="following" style={rail} />

      {home.genres?.length ? (
        <View style={styles.genres}>
          <Text style={styles.heading}>{t('music.genres')}</Text>
          <View style={styles.genreGrid}>
            {home.genres.map((g) => (
              <TouchableOpacity
                key={g.slug}
                style={styles.genre}
                onPress={() => navigation.navigate('Genre', { slug: g.slug, name: genreName(t, g) })}
                activeOpacity={0.85}
                accessibilityRole="button"
              >
                {g.cover ? (
                  <Image source={{ uri: g.cover }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
                ) : null}
                <View style={styles.genreShade} />
                <Text style={styles.genreName} numberOfLines={2}>{genreName(t, g)}</Text>
                <View style={styles.genreCount}>
                  <Ionicons name="musical-notes" size={11} color="#fff" />
                  <Text style={styles.genreCountText}>{g.track_count}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : null}

      <Text style={[styles.heading, styles.allSongs]}>{t('music.allSongs')}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  heading: { color: colors.textPrimary, fontSize: 17, fontWeight: '800', marginBottom: spacing.sm },
  allSongs: { marginTop: spacing.md },
  charts: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, marginBottom: spacing.sm },
  chartCard: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm,
    borderRadius: radius.md, backgroundColor: colors.card, borderWidth: 1, minHeight: 80,
  },
  chartText: { flex: 1 },
  chartTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '800' },
  chartSub: { color: colors.textSecondary, fontSize: 11.5, marginTop: 2 },
  genres: { marginTop: spacing.md },
  genreGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  genre: {
    flexGrow: 1, flexBasis: '30%', minWidth: 100, height: 72, borderRadius: radius.md,
    overflow: 'hidden', backgroundColor: colors.surface, justifyContent: 'flex-end', padding: spacing.sm,
  },
  genreShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(10,22,40,0.55)' },
  genreName: { color: '#fff', fontSize: 14, fontWeight: '800' },
  genreCount: { position: 'absolute', top: 6, right: 8, flexDirection: 'row', alignItems: 'center', gap: 3 },
  genreCountText: { color: '#fff', fontSize: 11, fontWeight: '700' },
});

export default MusicHome;
