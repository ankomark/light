/**
 * Weather, dressed as an instrument like the calculator is.
 *
 * Three decisions worth knowing about:
 *
 * · The ground is the photograph, and it is black. Painting the sky's colour
 *   over it was the first attempt and it turned the picture into a slab of
 *   blue. The condition still reads — in the accent, which colours the icons,
 *   the rule under the temperature and the week's bars — but the black is the
 *   black it was chosen for.
 *
 * · The first visit guesses your town from the device's timezone and asks you
 *   to confirm it. That costs no permission, no dependency and no IP sent to a
 *   third party — "Africa/Nairobi" already carries the answer. A guess is
 *   always offered, never saved silently.
 *
 * · The chosen place is saved to the server as well as the device, because the
 *   morning briefing is pushed by a cron job that cannot ask a sleeping phone
 *   where it is.
 *
 * Data: Open-Meteo, no API key — see services/weather.js.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, RefreshControl, Switch, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../context/I18nContext';
import { getPreference, setPreference, PREF_KEYS } from '../utils/preferences';
import {
  searchPlaces, fetchForecast, describe, guessPlace, describePlace,
} from '../services/weather';
import { fetchWeatherPlace, saveWeatherPlace } from '../services/api';

const DISPLAY = 'Cinzel_700Bold';
const DISPLAY_MID = 'Cinzel_600SemiBold';
const PARCHMENT = '#ECE7DE';
const WEEKDAY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * The sky no longer sets the ground — the photograph does, and it is black.
 *
 * A tint over it was the first attempt, and it washed the picture into a slab
 * of blue. The condition still shows, but in the accent alone: the icons, the
 * rule under the temperature and the week's bars change colour, and the ground
 * stays the black it was chosen for.
 */
const ACCENTS = {
  clear: '#F7C948', partly: '#8FC1E3', cloudy: '#9FB3C8', fog: '#B6C2C9',
  drizzle: '#7FB6D9', rain: '#5FA8D3', showers: '#5FA8D3', snow: '#CFE3F2',
  thunder: '#B39DDB',
};

const hour = (iso) => {
  const d = new Date(iso);
  const h = d.getHours();
  return `${((h + 11) % 12) + 1}${h < 12 ? 'am' : 'pm'}`;
};
const clock = (iso) => (iso ? new Date(iso).toTimeString().slice(0, 5) : '');

const Weather = ({ navigation }) => {
  const { t, resolvedLanguage } = useI18n();

  const [place, setPlace] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [briefing, setBriefing] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const [suggestion, setSuggestion] = useState(null);   // first-run guess
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [picking, setPicking] = useState(false);        // the search sheet is open
  const searchSeq = useRef(0);

  const load = useCallback(async (target) => {
    if (!target) return;
    try {
      setError('');
      setForecast(await fetchForecast(target));
    } catch (e) {
      setError(e?.message || t('weather.failed'));
    }
  }, [t]);

  // Open on the saved place; failing that, guess one and ask.
  useEffect(() => {
    let alive = true;
    (async () => {
      let chosen = null;
      try {
        const remote = await fetchWeatherPlace();     // the server's copy wins
        if (remote && remote.latitude != null) {
          chosen = remote;
          setBriefing(remote.briefing !== false);
        }
      } catch {
        // Offline, or signed out. The device's own copy will do.
      }
      if (!chosen) {
        const local = await getPreference(PREF_KEYS.weatherPlace);
        if (local && local.latitude != null) chosen = local;
      }
      if (!alive) return;

      if (chosen) {
        setPlace(chosen);
        await load(chosen);
      } else {
        setSuggestion(await guessPlace(resolvedLanguage || 'en'));
      }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [load, resolvedLanguage]);

  // Search as you type; only the newest answer is allowed to land.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); setSearching(false); return undefined; }
    const seq = ++searchSeq.current;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const found = await searchPlaces(q, resolvedLanguage || 'en');
        if (seq === searchSeq.current) setResults(found);
      } catch {
        if (seq === searchSeq.current) setResults([]);
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [query, resolvedLanguage]);

  const choose = useCallback(async (found) => {
    setPlace(found);
    setSuggestion(null);
    setPicking(false);
    setQuery('');
    setResults([]);
    setForecast(null);
    setLoading(true);
    await setPreference(PREF_KEYS.weatherPlace, found);
    try {
      await saveWeatherPlace({ ...found, briefing });   // so the morning push knows
    } catch {
      // Saved on the device regardless; the briefing simply will not send.
    }
    await load(found);
    setLoading(false);
  }, [briefing, load]);

  const toggleBriefing = useCallback(async (value) => {
    setBriefing(value);
    try {
      await saveWeatherPlace({ ...place, briefing: value });
    } catch {
      setBriefing(!value);                              // it did not stick
    }
  }, [place]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load(place);
    setRefreshing(false);
  }, [load, place]);

  // The place written the way a map app writes it: the name, then everything
  // that locates it.
  const where = useMemo(() => describePlace(place), [place]);

  const now = forecast?.current;
  const sky = now ? describe(now.code, now.isDay) : null;
  const accent = sky ? (ACCENTS[sky.key] || '#9FB3C8') : '#9FB3C8';

  // The week's full range, so each day's bar can show where it sits in it.
  const span = useMemo(() => {
    const days = forecast?.days || [];
    if (!days.length) return null;
    const lo = Math.min(...days.map((d) => d.min));
    const hi = Math.max(...days.map((d) => d.max));
    return { lo, hi, width: Math.max(1, hi - lo) };
  }, [forecast]);

  const searchBox = (
    <View style={styles.searchWrap}>
      <Ionicons name="search" size={18} color="rgba(236,231,222,0.5)" />
      <TextInput
        style={styles.search}
        placeholder={t('weather.searchPlaceholder')}
        placeholderTextColor="rgba(236,231,222,0.45)"
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
        autoFocus={picking}
        returnKeyType="search"
      />
      {searching && <ActivityIndicator size="small" color={accent} />}
      {!!query && !searching && (
        <TouchableOpacity onPress={() => setQuery('')} hitSlop={10}>
          <Ionicons name="close-circle" size={18} color="rgba(236,231,222,0.5)" />
        </TouchableOpacity>
      )}
    </View>
  );

  const resultList = !!results.length && (
    <View style={styles.results}>
      {results.map((r) => {
        const { title, detail } = describePlace(r);
        return (
          <TouchableOpacity key={r.id} style={styles.result} onPress={() => choose(r)}>
            <Ionicons
              name={r.isNeighbourhood ? 'navigate-outline' : 'location-outline'}
              size={16}
              color="rgba(236,231,222,0.55)"
            />
            <View style={styles.flex}>
              <Text style={styles.resultText} numberOfLines={1}>{title}</Text>
              {!!detail && (
                <Text style={styles.resultSub} numberOfLines={1}>{detail}</Text>
              )}
            </View>
            {/* Population is what separates a town from a hamlet of the same
                name, and it is the only ranking signal the geocoder gives. */}
            {r.population > 1000 && (
              <Text style={styles.resultPop}>
                {r.population >= 1000000
                  ? `${(r.population / 1000000).toFixed(1)}M`
                  : `${Math.round(r.population / 1000)}k`}
              </Text>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );

  return (
    <View style={styles.root}>
      {/* The photograph is the ground, and the sky still colours it: the
          gradient sits over the image at low opacity, so a clear noon and a
          wet night are still visibly different screens without losing the
          picture. Both are dark, so the type's contract holds either way. */}
      <Image
        source={require('../assets/weather-bg.jpg')}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
        accessibilityIgnoresInvertColors
      />
      {/* The only thing over the picture: black deepening toward the foot of
          the screen, so the cards and the credit line have ground to sit on
          rather than floating over the rain. */}
      <LinearGradient
        colors={['rgba(0,0,0,0.15)', 'rgba(0,0,0,0.45)', 'rgba(0,0,0,0.82)']}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFill}
      />
      {/* No title bar of its own: the app header above already names the
          screen and carries the way back. Changing place moved onto the place
          name itself, where someone would reach for it anyway. */}
      <SafeAreaView style={styles.flex} edges={['bottom']}>

        {picking && <View style={styles.pickWrap}>{searchBox}{resultList}</View>}

        {loading ? (
          <View style={styles.centered}><ActivityIndicator size="large" color={accent} /></View>
        ) : !place ? (
          /* ── First visit: confirm a guess, or search ────────────────────── */
          <ScrollView contentContainerStyle={styles.firstRun} keyboardShouldPersistTaps="handled">
            <Ionicons name="partly-sunny-outline" size={48} color={accent} />
            <Text style={styles.firstTitle}>{t('weather.pickTitle')}</Text>
            <Text style={styles.firstBody}>{t('weather.pickBody')}</Text>

            {!!suggestion && (
              <TouchableOpacity
                style={[styles.suggestion, { borderColor: accent }]}
                onPress={() => choose(suggestion)}
                activeOpacity={0.85}
              >
                <Ionicons name="navigate-circle-outline" size={22} color={accent} />
                <View style={styles.flex}>
                  <Text style={styles.suggestionLabel}>{t('weather.suggested')}</Text>
                  <Text style={styles.suggestionName}>
                    {describePlace(suggestion).title}
                  </Text>
                  {!!describePlace(suggestion).detail && (
                    <Text style={styles.suggestionWhere} numberOfLines={1}>
                      {describePlace(suggestion).detail}
                    </Text>
                  )}
                </View>
                <Ionicons name="checkmark-circle" size={24} color={accent} />
              </TouchableOpacity>
            )}

            {searchBox}
            {resultList}
            <Text style={styles.firstNote}>{t('weather.briefingNote')}</Text>
          </ScrollView>
        ) : (
          /* ── The forecast ──────────────────────────────────────────────── */
          <ScrollView
            contentContainerStyle={styles.scroll}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={accent} />
            }
          >
            {!!error && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
                <TouchableOpacity onPress={refresh}>
                  <Text style={[styles.retry, { color: accent }]}>{t('common.retry')}</Text>
                </TouchableOpacity>
              </View>
            )}

            {!!now && (
              <View style={styles.hero}>
                <TouchableOpacity
                  style={styles.placeRow}
                  onPress={() => setPicking((p) => !p)}
                  activeOpacity={0.75}
                  accessibilityLabel={t('weather.changePlace')}
                >
                  <Text style={styles.place} numberOfLines={1}>{where.title}</Text>
                  <Ionicons
                    name={picking ? 'close' : 'chevron-down'}
                    size={15}
                    color="rgba(236,231,222,0.65)"
                  />
                </TouchableOpacity>
                {!!where.detail && (
                  <Text style={styles.placeDetail} numberOfLines={1}>{where.detail}</Text>
                )}
                <Text style={styles.temp}>{Math.round(now.temperature)}°</Text>
                <View style={styles.skyRow}>
                  <Ionicons name={sky.icon} size={20} color={accent} />
                  <Text style={styles.skyText}>{t(`weather.sky.${sky.key}`)}</Text>
                </View>
                <Text style={styles.feels}>
                  {t('weather.feelsLike', { value: Math.round(now.feelsLike) })}
                </Text>
                <LinearGradient
                  colors={['transparent', accent, 'transparent']}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  style={styles.rule}
                />
                <View style={styles.stats}>
                  <Stat icon="water-outline" label={t('weather.humidity')} value={`${now.humidity}%`} />
                  <Stat icon="rainy-outline" label={t('weather.rain')} value={`${now.precipitation ?? 0} mm`} />
                  <Stat icon="navigate-outline" label={t('weather.wind')} value={`${Math.round(now.wind)} km/h`} />
                </View>
              </View>
            )}

            {!!forecast?.hours?.length && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>{t('weather.hours')}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {forecast.hours.map((h, i) => {
                    const d = describe(h.code, true);
                    return (
                      <View style={styles.hourCol} key={h.time}>
                        <Text style={styles.hourLabel}>{i === 0 ? t('weather.now') : hour(h.time)}</Text>
                        <Ionicons name={d.icon} size={19} color={accent} />
                        <Text style={styles.hourTemp}>{Math.round(h.temperature)}°</Text>
                        <Text style={styles.hourRain}>
                          {h.rainChance != null && h.rainChance >= 20 ? `${h.rainChance}%` : ' '}
                        </Text>
                      </View>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            {!!forecast?.days?.length && span && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>{t('weather.week')}</Text>
                {forecast.days.map((day, i) => {
                  const d = describe(day.code, true);
                  const date = new Date(`${day.date}T00:00:00`);
                  // Where this day's range sits inside the week's range.
                  const left = ((day.min - span.lo) / span.width) * 100;
                  const width = Math.max(6, ((day.max - day.min) / span.width) * 100);
                  return (
                    <View style={styles.dayRow} key={day.date}>
                      <Text style={styles.dayName}>
                        {i === 0 ? t('weather.today') : t(`weather.day.${WEEKDAY[date.getDay()]}`)}
                      </Text>
                      <Ionicons name={d.icon} size={17} color="rgba(236,231,222,0.75)" />
                      <Text style={styles.dayMin}>{Math.round(day.min)}°</Text>
                      <View style={styles.track}>
                        <View style={[styles.bar, {
                          left: `${left}%`, width: `${width}%`, backgroundColor: accent,
                        }]} />
                      </View>
                      <Text style={styles.dayMax}>{Math.round(day.max)}°</Text>
                    </View>
                  );
                })}
                {!!forecast.days[0]?.sunrise && (
                  <View style={styles.sunRow}>
                    <Ionicons name="sunny-outline" size={15} color={accent} />
                    <Text style={styles.sunText}>{clock(forecast.days[0].sunrise)}</Text>
                    <Ionicons name="moon-outline" size={15} color={accent} />
                    <Text style={styles.sunText}>{clock(forecast.days[0].sunset)}</Text>
                  </View>
                )}
              </View>
            )}

            <View style={styles.card}>
              <View style={styles.briefRow}>
                <View style={styles.flex}>
                  <Text style={styles.briefTitle}>{t('weather.morningBriefing')}</Text>
                  <Text style={styles.briefBody}>{t('weather.briefingNote')}</Text>
                </View>
                <Switch
                  value={briefing}
                  onValueChange={toggleBriefing}
                  trackColor={{ false: 'rgba(236,231,222,0.2)', true: accent }}
                  thumbColor="#FFFFFF"
                />
              </View>
            </View>

            <Text style={styles.credit}>{t('weather.credit')}</Text>
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
};

const Stat = ({ icon, label, value }) => (
  <View style={styles.stat}>
    <Ionicons name={icon} size={15} color="rgba(236,231,222,0.6)" />
    <Text style={styles.statValue}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

// On black these read as charcoal plates; the same values over the old blue
// ground read as barely-there. Nudged up so the cards still have edges.
const PANEL = 'rgba(255,255,255,0.055)';
const HAIRLINE = 'rgba(255,255,255,0.11)';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },

  pickWrap: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, height: 46, borderRadius: 14,
    backgroundColor: PANEL, borderWidth: StyleSheet.hairlineWidth, borderColor: HAIRLINE,
  },
  search: { flex: 1, color: PARCHMENT, fontSize: 15, paddingVertical: 0 },
  results: {
    marginTop: 8, borderRadius: 14, overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: HAIRLINE,
  },
  result: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  resultText: { color: PARCHMENT, fontSize: 14.5 },
  resultSub: { color: 'rgba(236,231,222,0.55)', fontSize: 12, marginTop: 1 },
  resultPop: { color: 'rgba(236,231,222,0.4)', fontSize: 11.5 },

  firstRun: { padding: 24, alignItems: 'center', gap: 14 },
  firstTitle: {
    fontFamily: DISPLAY, fontSize: 20, color: PARCHMENT, textAlign: 'center', marginTop: 6,
  },
  firstBody: {
    fontSize: 14, lineHeight: 21, color: 'rgba(236,231,222,0.75)',
    textAlign: 'center', maxWidth: 320,
  },
  suggestion: {
    flexDirection: 'row', alignItems: 'center', gap: 12, alignSelf: 'stretch',
    padding: 14, borderRadius: 16, backgroundColor: PANEL, borderWidth: 1,
  },
  suggestionLabel: {
    fontFamily: DISPLAY_MID, fontSize: 10, letterSpacing: 1.3,
    textTransform: 'uppercase', color: 'rgba(236,231,222,0.6)',
  },
  suggestionName: { fontSize: 17, color: PARCHMENT, marginTop: 2 },
  suggestionWhere: { fontSize: 12, color: 'rgba(236,231,222,0.55)', marginTop: 1 },
  firstNote: {
    fontSize: 12.5, lineHeight: 19, color: 'rgba(236,231,222,0.55)',
    textAlign: 'center', maxWidth: 320, marginTop: 4,
  },

  scroll: { padding: 16, gap: 14, paddingBottom: 40 },
  hero: { alignItems: 'center', paddingVertical: 10 },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  place: { fontSize: 16, color: PARCHMENT, letterSpacing: 0.4 },
  // The chain beneath the name — county, country — small and quiet, the way a
  // map app writes it under the pin.
  placeDetail: {
    fontSize: 11.5, color: 'rgba(236,231,222,0.55)', letterSpacing: 0.3, marginTop: 1,
  },
  temp: { fontFamily: DISPLAY, fontSize: 78, color: PARCHMENT, marginTop: 2 },
  skyRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: -6 },
  skyText: { fontFamily: DISPLAY_MID, fontSize: 15, letterSpacing: 0.8, color: PARCHMENT },
  feels: { fontSize: 13, color: 'rgba(236,231,222,0.6)', marginTop: 6 },
  rule: { height: 1, alignSelf: 'stretch', marginTop: 16, opacity: 0.6 },
  stats: { flexDirection: 'row', alignSelf: 'stretch', marginTop: 14 },
  stat: { flex: 1, alignItems: 'center', gap: 3 },
  statValue: { fontFamily: DISPLAY_MID, fontSize: 15, color: PARCHMENT },
  statLabel: { fontSize: 11, color: 'rgba(236,231,222,0.55)' },

  card: {
    padding: 14, borderRadius: 18, backgroundColor: PANEL,
    borderWidth: StyleSheet.hairlineWidth, borderColor: HAIRLINE,
  },
  cardTitle: {
    fontFamily: DISPLAY_MID, fontSize: 10.5, letterSpacing: 1.4,
    textTransform: 'uppercase', color: 'rgba(236,231,222,0.6)', marginBottom: 10,
  },

  hourCol: { alignItems: 'center', width: 56, gap: 6 },
  hourLabel: { fontSize: 11.5, color: 'rgba(236,231,222,0.7)' },
  hourTemp: { fontFamily: DISPLAY_MID, fontSize: 15, color: PARCHMENT },
  hourRain: { fontSize: 10.5, color: 'rgba(236,231,222,0.6)', minHeight: 13 },

  dayRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 7 },
  dayName: { width: 68, fontSize: 13.5, color: PARCHMENT },
  dayMin: { width: 32, fontSize: 13, color: 'rgba(236,231,222,0.6)', textAlign: 'right' },
  // The bar shows where a day's range sits within the whole week's range —
  // which is what makes "22°" mean something at a glance.
  track: {
    flex: 1, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden',
  },
  bar: { position: 'absolute', top: 0, bottom: 0, borderRadius: 2 },
  dayMax: { width: 34, fontFamily: DISPLAY_MID, fontSize: 14, color: PARCHMENT, textAlign: 'right' },

  sunRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 10, paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: HAIRLINE,
  },
  sunText: { fontSize: 12.5, color: 'rgba(236,231,222,0.7)', marginRight: 10 },

  briefRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  briefTitle: { fontFamily: DISPLAY_MID, fontSize: 14, color: PARCHMENT },
  briefBody: { fontSize: 12.5, lineHeight: 18, color: 'rgba(236,231,222,0.6)', marginTop: 3 },

  errorBox: { padding: 12, borderRadius: 12, gap: 6, backgroundColor: 'rgba(0,0,0,0.3)' },
  errorText: { color: '#FF9A8B', fontSize: 13 },
  retry: { fontWeight: '700', fontSize: 13 },

  credit: { fontSize: 11, color: 'rgba(236,231,222,0.45)', textAlign: 'center' },
});

export default Weather;
