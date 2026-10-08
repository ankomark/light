/**
 * Pick a song to link to a product (Add / Edit product). The newest songs
 * at first; typing searches the whole catalogue on the server (typos
 * forgiven). The chosen song goes back through route.params.onSelect.
 *
 * It was never registered as a screen: "Link a song" on the product forms
 * did nothing. It also read /tracks/ as a plain list - it is paginated.
 */
import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, ActivityIndicator,
} from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { useI18n } from '../../context/I18nContext';
import { fetchTracks, searchSongs } from '../../services/api';
import { formTheme as F } from './formTheme';

const listOf = (data) => (Array.isArray(data) ? data : data?.results || []);

const SelectTrack = ({ navigation, route }) => {
  const { t } = useI18n();
  const { onSelect, currentTrack } = route?.params || {};
  const [query, setQuery] = useState('');
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const mine = ++seq.current;
    const q = query.trim();
    // Typing: wait a moment, so each letter is not its own search.
    const id = setTimeout(async () => {
      setLoading(true);
      try {
        const data = q ? await searchSongs(q) : await fetchTracks(1, '', '', 40);
        if (mine === seq.current) { setTracks(listOf(data)); setFailed(false); }
      } catch {
        if (mine === seq.current) setFailed(true);
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, q ? 300 : 0);
    return () => clearTimeout(id);
  }, [query]);

  const pick = (track) => {
    onSelect?.(track);
    navigation.goBack();
  };

  return (
    <View style={styles.container}>
      <View style={styles.searchRow}>
        <Icon name="search" size={15} color={F.muted} />
        <TextInput
          style={styles.search}
          placeholderTextColor={F.placeholder}
          placeholder={t('market.track.searchPlaceholder')}
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
          autoCorrect={false}
          testID="track-search"
        />
      </View>

      {!!currentTrack && (
        <TouchableOpacity style={styles.unlink} onPress={() => pick(null)} accessibilityRole="button" testID="track-unlink">
          <Icon name="chain-broken" size={14} color={F.danger} />
          <Text style={styles.unlinkText}>{t('market.track.unlink')}</Text>
        </TouchableOpacity>
      )}

      {loading && !tracks.length ? (
        <ActivityIndicator color={F.accent} style={{ marginTop: 32 }} />
      ) : (
        <FlatList
          data={tracks}
          keyExtractor={(item) => String(item.id)}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const chosen = currentTrack?.id === item.id;
            return (
              <TouchableOpacity style={[styles.row, chosen && styles.rowChosen]} onPress={() => pick(item)}
                accessibilityRole="button" testID={`track-${item.id}`}>
                <Icon name={chosen ? 'check-circle' : 'music'} size={16} color={chosen ? F.ok : F.accent} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
                  <Text style={styles.artist} numberOfLines={1}>{item.artist?.username || ''}</Text>
                </View>
              </TouchableOpacity>
            );
          }}
          contentContainerStyle={styles.list}
          ListEmptyComponent={(
            <Text style={styles.empty}>{failed ? t('market.track.loadFailed') : t('market.track.none')}</Text>
          )}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, borderRadius: 12,
    backgroundColor: F.field, borderWidth: 1, borderColor: F.border, marginBottom: 12,
  },
  search: { flex: 1, color: F.text, fontSize: 15.5, paddingVertical: 12 },
  unlink: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 12, borderRadius: 12,
    marginBottom: 12, borderWidth: 1, borderColor: F.danger,
  },
  unlinkText: { color: F.danger, fontWeight: '700' },
  list: { paddingBottom: 24, gap: 8 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 12, minHeight: 56,
    backgroundColor: F.card, borderWidth: 1, borderColor: F.cardBorder,
  },
  rowChosen: { borderColor: F.ok },
  title: { color: F.text, fontSize: 15, fontWeight: '700' },
  artist: { color: F.muted, fontSize: 13, marginTop: 2 },
  empty: { color: F.muted, textAlign: 'center', marginTop: 32, fontSize: 15 },
});

export default SelectTrack;
