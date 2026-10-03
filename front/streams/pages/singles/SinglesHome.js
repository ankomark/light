// Single & Searching: the one door in (the menu's Connect section). What it
// shows depends on where the person is:
//   can't join yet (too new, unverified…) → why, and when
//   no profile                            → the welcome and its promises
//   a profile not yet approved            → My profile, with its review state
//   approved                              → Discover · Matches · My profile
// A match opens a celebration with a way to begin, then the chat in Messages.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, TextInput, ScrollView, RefreshControl,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useI18n } from '../../context/I18nContext';
import { Image } from 'expo-image';
import {
  fetchSinglesMe, fetchSinglesDiscover, answerSingles, fetchSinglesMatches, fetchUnreadMessageCount,
} from '../../services/api';
import { subscribeDM } from '../../services/dmSocket';
import { notify } from '../../utils/adminConfirm';
import { peekCache, readCache, writeCache, userKey } from '../../utils/screenCache';
import { useAuth } from '../../context/useAuth';
import { tap, celebrate } from '../../components/singles/feel';
import useSingles from '../../components/singles/useSingles';
import {
  GOLD, FACE, SinglesScreen, GoldButton, Label, Card, Chip, Portrait, Ring, Title, Body, Centered, FadeIn,
  SkeletonList,
} from '../../components/singles/SinglesKit';
import ProfileCard from '../../components/singles/ProfileCard';
import SafetySheet from '../../components/singles/SafetySheet';
import MyProfilePane from '../../components/singles/MyProfilePane';
import HomeTab from '../../components/singles/HomeTab';
import ConnectionsTab from '../../components/singles/ConnectionsTab';
import ChatsTab from '../../components/singles/ChatsTab';
import MoreLinks from '../../components/singles/MoreLinks';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// The hub's bottom bar: home first (not a wall of faces), then Discover,
// your connections, your chats, and you.
const TABS = [
  ['home', 'home-heart'], ['discover', 'compass-outline'], ['connections', 'heart-multiple-outline'],
  ['chats', 'chat-outline'], ['me', 'account-circle-outline'],
];

export default function SinglesHome() {
  const { t } = useI18n();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState('home');
  const [unread, setUnread] = useState(0);
  // Drawn from the last copy at once (no spinner on a return visit), then
  // refreshed. "Switched off" is an answer, not an error.
  const { data: me, failed: loadFailed, reload: load } = useSingles('me', async () => {
    try { return await fetchSinglesMe(); } catch (e) {
      if (e?.data?.code === 'feature_off') return { off: true };
      throw e;
    }
  });
  const failed = me?.off ? 'off' : loadFailed && !me ? 'error' : null;

  // Unread in Single & Searching chats: a dot on the Chats tab.
  const countUnread = useCallback(() => {
    fetchUnreadMessageCount().then((r) => setUnread(r?.singles || 0)).catch(() => {});
  }, []);
  useFocusEffect(countUnread);
  // A match made while you're here, or a message: refresh at once.
  useEffect(() => subscribeDM((e) => {
    if (e.type === 'singles_match') load();
    if (e.type === 'message' || e.type === 'read') countUnread();
  }), [load, countUnread]);

  if (failed === 'off') {
    return (
      <SinglesScreen title={t('singles.title')} testID="singles-off">
        <Centered><Body style={{ textAlign: 'center' }}>{t('singles.off')}</Body></Centered>
      </SinglesScreen>
    );
  }
  if (failed) {
    return (
      <SinglesScreen title={t('singles.title')} testID="singles-error">
        <Centered>
          <Body style={{ textAlign: 'center' }}>{t('singles.loadFailed')}</Body>
          <GoldButton label={t('common.retry')} kind="outline" onPress={load} />
        </Centered>
      </SinglesScreen>
    );
  }
  if (!me) {
    return (
      <SinglesScreen title={t('singles.title')} scroll={false}>
        <SkeletonList rows={4} testID="singles-loading" />
      </SinglesScreen>
    );
  }
  if (!me.eligible) return <NotYet me={me} />;
  if (!me.profile) return <Welcome />;
  if (me.profile.status !== 'approved') {
    return (
      <SinglesScreen title={t('singles.mine.title')} testID="singles-mine">
        <MyProfilePane profile={me.profile} onChange={load} />
      </SinglesScreen>
    );
  }
  return (
    <SinglesScreen title={t('singles.title')} scroll={false} testID="singles-home"
      right={(
        <TouchableOpacity onPress={() => navigation.navigate('SinglesSettings', { profile: me.profile })}
          accessibilityRole="button" accessibilityLabel={t('singles.settings.title')} hitSlop={10}>
          <Ionicons name="options-outline" size={22} color={GOLD.text} />
        </TouchableOpacity>
      )}>
      <View style={{ flex: 1 }}>
        {tab === 'home' && <HomeTab onTab={setTab} />}
        {tab === 'discover' && (
          <Discover paused={me.profile.is_paused} onMine={() => setTab('me')} mePhoto={me.profile.photos?.[0]?.url} />
        )}
        {tab === 'connections' && <ConnectionsTab Matches={Matches} />}
        {tab === 'chats' && <ChatsTab />}
        {tab === 'me' && (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} showsVerticalScrollIndicator={false}>
            <MyProfilePane profile={me.profile} onChange={load} />
            <MoreLinks profile={me.profile} />
          </ScrollView>
        )}
      </View>
      <View style={[styles.bottomBar, { paddingBottom: 8 + insets.bottom }]} accessibilityRole="tablist">
        {TABS.map(([k, icon]) => (
          <TouchableOpacity key={k} onPress={() => setTab(k)} style={styles.bottomTab} accessibilityRole="tab"
            accessibilityState={{ selected: tab === k }} accessibilityLabel={t(`singles.tab.${k}`)} testID={`singles-tab-${k}`}>
            <View>
              <MaterialCommunityIcons name={icon} size={24} color={tab === k ? GOLD.gold : GOLD.muted} />
              {k === 'chats' && unread > 0 && <View style={styles.unreadDot} testID="singles-unread" />}
            </View>
            <Text style={[styles.bottomText, tab === k && { color: GOLD.gold }]} numberOfLines={1}
              maxFontSizeMultiplier={1.2}>{t(`singles.tab.${k}`)}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </SinglesScreen>
  );
}

// ── Can't join yet ───────────────────────────────────────────────────────────
function NotYet({ me }) {
  const { t } = useI18n();
  return (
    <SinglesScreen title={t('singles.title')} testID="singles-not-yet">
      <Centered>
        <Ring><View style={styles.mark}><MaterialCommunityIcons name="ring" size={36} color={GOLD.gold} /></View></Ring>
        <Title>{t('singles.notYet.title')}</Title>
        {me.blockers.map((b) => (
          <Body key={b} style={{ textAlign: 'center' }}>
            {t(`singles.blocker.${b}`, { date: me.ready_on || '' })}
          </Body>
        ))}
      </Centered>
    </SinglesScreen>
  );
}

// ── Welcome ──────────────────────────────────────────────────────────────────
const PROMISES = [
  ['shield-check-outline', 'real'],
  ['heart-outline', 'both'],
  ['lock-outline', 'private'],
  ['flag-outline', 'safe'],
];

function Welcome() {
  const { t } = useI18n();
  const navigation = useNavigation();
  const [agreed, setAgreed] = useState(false);
  return (
    <SinglesScreen title="" testID="singles-welcome"
      footer={(
        <GoldButton label={t('singles.welcome.create')} icon="heart" disabled={!agreed} testID="singles-create"
          onPress={() => navigation.navigate('SinglesEdit', { create: true })} />
      )}>
      <Centered>
        <Ring><View style={styles.mark}><MaterialCommunityIcons name="ring" size={36} color={GOLD.gold} /></View></Ring>
        <Label>{t('singles.welcome.eyebrow')}</Label>
        <Title size={40}>{t('singles.title')}</Title>
        <Body style={{ textAlign: 'center', maxWidth: 330 }}>{t('singles.welcome.lead')}</Body>
      </Centered>
      <View style={{ gap: 16, marginTop: 26 }}>
        {PROMISES.map(([icon, key]) => (
          <View key={key} style={styles.promise}>
            <View style={styles.promiseIcon}><MaterialCommunityIcons name={icon} size={20} color={GOLD.gold} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.promiseTitle}>{t(`singles.promise.${key}`)}</Text>
              <Text style={styles.promiseSub}>{t(`singles.promise.${key}Sub`)}</Text>
            </View>
          </View>
        ))}
      </View>
      <Card style={{ marginTop: 24 }}>
        <Label>{t('singles.rules.title')}</Label>
        {['one', 'two', 'three', 'four', 'five'].map((n) => (
          <Body key={n} style={{ fontSize: 14 }}>{`•  ${t(`singles.rules.${n}`)}`}</Body>
        ))}
        <TouchableOpacity style={styles.agree} onPress={() => setAgreed((v) => !v)} accessibilityRole="checkbox"
          accessibilityState={{ checked: agreed }} testID="singles-agree">
          <Ionicons name={agreed ? 'checkbox' : 'square-outline'} size={24} color={GOLD.gold} />
          <Text style={styles.agreeText}>{t('singles.rules.agree')}</Text>
        </TouchableOpacity>
      </Card>
    </SinglesScreen>
  );
}

// ── Discover ─────────────────────────────────────────────────────────────────
function Discover({ paused, onMine, mePhoto }) {
  const { t } = useI18n();
  const navigation = useNavigation();
  const { currentUser } = useAuth();
  const cacheKey = currentUser?.id ? userKey(currentUser.id, 'singles:discover') : null;
  const [queue, setQueue] = useState(() => (cacheKey ? peekCache(cacheKey)?.results ?? null : null));
  const [left, setLeft] = useState(null);
  const [filters, setFilters] = useState({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [safety, setSafety] = useState(false);
  const [match, setMatch] = useState(null);
  const scroll = useRef(null);

  const load = useCallback(async (f) => {
    const plain = !Object.keys(f || {}).length;
    if (plain && cacheKey && !peekCache(cacheKey)) {
      const kept = await readCache(cacheKey);
      if (kept) { setQueue((q) => q ?? kept.results); setLeft((l) => l ?? kept.left_today); }
    }
    try {
      const res = await fetchSinglesDiscover(f);
      setQueue(res.results || []);
      setLeft(res.left_today);
      if (plain && cacheKey) writeCache(cacheKey, res);
      // The next faces load while you read this one.
      const next = (res.results || []).slice(1).map((p) => p.photos?.[0]?.url).filter(Boolean);
      if (next.length) Image.prefetch?.(next);
    } catch (e) {
      setQueue((q) => q ?? []);
      if (e?.data?.code === 'paused') setLeft(-1);
    }
  }, [cacheKey]);
  useEffect(() => { if (!paused) load(filters); }, [load, filters, paused]);

  if (paused) {
    return (
      <View style={styles.pane}>
        <Centered>
          <Title size={30}>{t('singles.discover.pausedTitle')}</Title>
          <Body style={{ textAlign: 'center' }}>{t('singles.discover.pausedBody')}</Body>
          <GoldButton label={t('singles.discover.toMine')} kind="outline" onPress={onMine} />
        </Centered>
      </View>
    );
  }
  if (queue === null) return <SkeletonList rows={2} />;

  const current = queue[0];
  const answer = async (kind) => {
    if (!current || busy) return;
    setBusy(true);
    try {
      if (kind === 'interested') tap();
      const res = await answerSingles(current.id, kind);
      setLeft(res.left_today);
      if (res.matched) { celebrate(); setMatch(res.match); }
      const rest = queue.slice(1);
      setQueue(rest);
      if (cacheKey) writeCache(cacheKey, { results: rest, left_today: res.left_today });
      scroll.current?.scrollTo?.({ y: 0, animated: false });
      if (!rest.length && res.left_today > 0) load(filters);
    } catch (e) {
      if (e?.data?.code === 'daily_limit') { setLeft(0); setQueue([]); } else notify(t('common.error'), t('singles.discover.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.discoverBar}>
        <Text style={styles.leftToday} testID="singles-left">
          {left > 0 ? t('singles.discover.left', { n: left }) : t('singles.discover.none')}
        </Text>
        <TouchableOpacity onPress={() => setFiltersOpen(true)} style={styles.filterBtn} accessibilityRole="button"
          accessibilityLabel={t('singles.filters.title')} testID="singles-filters">
          <Ionicons name="options-outline" size={20} color={GOLD.text} />
          {Object.keys(filters).length > 0 && <View style={styles.dot} />}
        </TouchableOpacity>
      </View>
      {current ? (
        <>
          <ScrollView ref={scroll} contentContainerStyle={{ padding: 16, paddingBottom: 140 }}
            showsVerticalScrollIndicator={false}>
            <FadeIn key={current.id}><ProfileCard profile={current} testID={`singles-card-${current.id}`} /></FadeIn>
            <TouchableOpacity onPress={() => setSafety(true)} style={styles.safetyLink} accessibilityRole="button"
              testID="singles-card-safety">
              <Ionicons name="flag-outline" size={15} color={GOLD.muted} />
              <Text style={styles.safetyText}>{t('singles.safety.link')}</Text>
            </TouchableOpacity>
          </ScrollView>
          <View style={styles.actions}>
            <GoldButton label={t('singles.notNow')} icon="close" kind="outline" onPress={() => answer('pass')}
              disabled={busy} testID="singles-pass" />
            <GoldButton label={t('singles.interested')} icon="heart" onPress={() => answer('interested')} busy={busy}
              testID="singles-interested" />
          </View>
          <SafetySheet profile={current} visible={safety} onClose={() => setSafety(false)}
            onDone={() => setQueue((q) => q.slice(1))} />
        </>
      ) : (
        <ScrollView contentContainerStyle={styles.pane}
          refreshControl={<RefreshControl refreshing={false} onRefresh={() => load(filters)} tintColor={GOLD.gold} />}>
          <Centered>
            <Title size={30}>{left === 0 ? t('singles.discover.doneTitle') : t('singles.discover.emptyTitle')}</Title>
            <Body style={{ textAlign: 'center' }}>
              {left === 0 ? t('singles.discover.doneBody') : t('singles.discover.emptyBody')}
            </Body>
            {Object.keys(filters).length > 0 && (
              <GoldButton label={t('singles.filters.clear')} kind="outline" onPress={() => setFilters({})} />
            )}
          </Centered>
        </ScrollView>
      )}
      <FiltersSheet visible={filtersOpen} value={filters} onClose={() => setFiltersOpen(false)}
        onApply={(f) => { setFilters(f); setFiltersOpen(false); }} />
      <MatchMoment match={match} mePhoto={mePhoto} onClose={() => setMatch(null)}
        onHello={() => {
          const m = match;
          setMatch(null);
          navigation.navigate('Chat', { conversationId: m.conversation_id, otherUser: m.user, singles: true });
        }} />
    </View>
  );
}

// ── Filters ──────────────────────────────────────────────────────────────────
export function FiltersSheet({ visible, value, onClose, onApply }) {
  const { t } = useI18n();
  const [f, setF] = useState(value);
  useEffect(() => { if (visible) setF(value); }, [visible, value]);
  const set = (k, v) => setF((cur) => {
    const next = { ...cur };
    if (v === '' || v === null || v === undefined || cur[k] === v) delete next[k]; else next[k] = v;
    return next;
  });
  const num = (k) => (text) => set(k, text.replace(/[^0-9]/g, '').slice(0, 3));
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.scrim} activeOpacity={1} onPress={onClose} accessibilityLabel={t('common.close')} />
      <View style={styles.sheet} testID="singles-filters-sheet">
        <Title size={28}>{t('singles.filters.title')}</Title>
        <Label>{t('singles.filters.age')}</Label>
        <View style={styles.ageRow}>
          <TextInput style={styles.field} value={f.min_age || ''} onChangeText={num('min_age')} keyboardType="number-pad"
            placeholder="18" placeholderTextColor={GOLD.muted} accessibilityLabel={t('singles.filters.minAge')}
            testID="singles-min-age" />
          <Text style={styles.to}>{t('singles.filters.to')}</Text>
          <TextInput style={styles.field} value={f.max_age || ''} onChangeText={num('max_age')} keyboardType="number-pad"
            placeholder="60" placeholderTextColor={GOLD.muted} accessibilityLabel={t('singles.filters.maxAge')} />
        </View>
        <Label>{t('singles.field.country')}</Label>
        <TextInput style={styles.field} value={f.country || ''} onChangeText={(v) => set('country', v)}
          placeholder={t('singles.filters.anyCountry')} placeholderTextColor={GOLD.muted}
          accessibilityLabel={t('singles.field.country')} />
        <Label>{t('singles.field.baptised')}</Label>
        <View style={styles.chipRow}>
          {['yes', 'not_yet'].map((b) => (
            <Chip key={b} text={t(`singles.baptised.${b}`)} on={f.baptised === b} onPress={() => set('baptised', b)} />
          ))}
        </View>
        <Label>{t('singles.field.lookingFor')}</Label>
        <View style={styles.chipRow}>
          {['open', 'friendship', 'serious', 'marriage'].map((b) => (
            <Chip key={b} text={t(`singles.looking.${b}`)} on={f.looking_for === b} onPress={() => set('looking_for', b)} />
          ))}
        </View>
        <Label>{t('singles.field.language')}</Label>
        <TextInput style={styles.field} value={f.language || ''} onChangeText={(v) => set('language', v)}
          placeholder={t('singles.filters.anyLanguage')} placeholderTextColor={GOLD.muted}
          accessibilityLabel={t('singles.field.language')} />
        <View style={styles.sheetActions}>
          <GoldButton label={t('singles.filters.clear')} kind="outline" onPress={() => onApply({})} />
          <GoldButton label={t('singles.filters.apply')} onPress={() => onApply(f)} testID="singles-filters-apply" />
        </View>
      </View>
    </Modal>
  );
}

// ── It's a match ─────────────────────────────────────────────────────────────
export function openerText(t, opener, name) {
  if (!opener) return '';
  if (opener.kind === 'prompt') {
    return t('singles.opener.prompt', { name, prompt: t(`singles.prompt.${opener.key}`), answer: opener.answer });
  }
  if (opener.kind === 'interest') return t('singles.opener.interest', { name, value: opener.value });
  if (opener.kind === 'church') return t('singles.opener.church', { name, value: opener.value });
  return t('singles.opener.general', { name });
}

export function MatchMoment({ match, onClose, onHello, mePhoto }) {
  const { t } = useI18n();
  if (!match) return null;
  const p = match.profile;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.matchWrap} testID="singles-match">
        <Label>{t('singles.match.eyebrow')}</Label>
        <Title size={46}>{t('singles.match.title')}</Title>
        <View style={styles.pair}>
          <Ring><Portrait uri={mePhoto} size={118} /></Ring>
          <View style={styles.pairHeart}><Ionicons name="heart" size={22} color={GOLD.onGold} /></View>
          <Ring><Portrait uri={p.photos?.[0]?.url} size={118} /></Ring>
        </View>
        <Body style={{ textAlign: 'center', maxWidth: 320 }}>{t('singles.match.body', { name: p.first_name })}</Body>
        <Card style={{ alignSelf: 'stretch' }}>
          <Label>{t('singles.match.begin')}</Label>
          <Text style={styles.opener}>{openerText(t, match.opener, p.first_name)}</Text>
        </Card>
        <View style={{ alignSelf: 'stretch', gap: 10 }}>
          <GoldButton label={t('singles.match.hello')} icon="chatbubble-ellipses" onPress={onHello} testID="singles-hello" />
          <GoldButton label={t('singles.match.later')} kind="quiet" onPress={onClose} />
        </View>
        <View style={styles.safeNote}>
          <Ionicons name="shield-checkmark-outline" size={14} color={GOLD.muted} />
          <Text style={styles.safeText}>{t('singles.match.safety')}</Text>
        </View>
      </View>
    </Modal>
  );
}

// ── Matches ──────────────────────────────────────────────────────────────────
function Matches() {
  const { t } = useI18n();
  const navigation = useNavigation();
  const { data, reload: load, failed } = useSingles('matches', async () => (await fetchSinglesMatches()).results || []);
  const rows = data ?? (failed ? [] : null);
  const [refreshing, setRefreshing] = useState(false);
  if (rows === null) return <SkeletonList rows={3} />;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 48 }}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={GOLD.gold}
        onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      {rows.length === 0 ? (
        <Centered>
          <Title size={30}>{t('singles.matches.emptyTitle')}</Title>
          <Body style={{ textAlign: 'center' }}>{t('singles.matches.emptyBody')}</Body>
        </Centered>
      ) : rows.map((m) => (
        <TouchableOpacity key={m.id} style={styles.matchRow} activeOpacity={0.85} testID={`singles-match-${m.id}`}
          onPress={() => navigation.navigate('SinglesPerson', { match: m })} accessibilityRole="button"
          accessibilityLabel={m.profile.first_name}>
          <Ring style={{ padding: 3 }}><Portrait uri={m.profile.photos?.[0]?.url} size={58} /></Ring>
          <View style={{ flex: 1 }}>
            <Text style={styles.matchName}>{m.profile.first_name}<Text style={styles.matchAge}>, {m.profile.age}</Text></Text>
            <Text style={styles.matchSub} numberOfLines={2}>{openerText(t, m.opener, m.profile.first_name)}</Text>
          </View>
          <TouchableOpacity style={styles.chatBtn} accessibilityRole="button" accessibilityLabel={t('singles.match.hello')}
            onPress={() => navigation.navigate('Chat', { conversationId: m.conversation_id, otherUser: m.user, singles: true })}>
            <Ionicons name="chatbubble-ellipses-outline" size={20} color={GOLD.onGold} />
          </TouchableOpacity>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  bottomBar: {
    flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: GOLD.border,
    backgroundColor: 'rgba(10,22,40,0.94)', paddingTop: 6,
  },
  bottomTab: { flex: 1, alignItems: 'center', gap: 2, minHeight: 48, justifyContent: 'center' },
  bottomText: { color: GOLD.muted, fontSize: 11, fontFamily: FACE.semi },
  unreadDot: {
    position: 'absolute', top: -2, right: -4, width: 10, height: 10, borderRadius: 5, backgroundColor: GOLD.gold,
    borderWidth: 1.5, borderColor: '#0A1628',
  },
  pair: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  pairHeart: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: GOLD.gold, alignItems: 'center', justifyContent: 'center',
    marginHorizontal: -14, zIndex: 1,
  },
  tabs: {
    flexDirection: 'row', marginHorizontal: 16, marginBottom: 6, borderRadius: 999, padding: 4,
    backgroundColor: GOLD.cardDeep, borderWidth: 1, borderColor: GOLD.border,
  },
  tab: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 999 },
  tabOn: { backgroundColor: GOLD.gold },
  tabText: { color: GOLD.sub, fontSize: 14, fontFamily: FACE.bold },
  tabTextOn: { color: GOLD.onGold },
  pane: { flexGrow: 1, padding: 24, justifyContent: 'center' },
  mark: { width: 72, height: 72, borderRadius: 36, backgroundColor: GOLD.soft, alignItems: 'center', justifyContent: 'center' },
  promise: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  promiseIcon: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: GOLD.soft, alignItems: 'center', justifyContent: 'center',
  },
  promiseTitle: { color: GOLD.text, fontSize: 15.5, fontFamily: FACE.bold },
  promiseSub: { color: GOLD.sub, fontSize: 13.5, lineHeight: 20, fontFamily: FACE.body, marginTop: 2 },
  agree: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, marginTop: 4 },
  agreeText: { flex: 1, color: GOLD.text, fontSize: 14.5, fontFamily: FACE.semi },
  discoverBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 },
  leftToday: { color: GOLD.muted, fontSize: 13, fontFamily: FACE.semi },
  filterBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', top: 10, right: 10, width: 8, height: 8, borderRadius: 4, backgroundColor: GOLD.gold },
  safetyLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, marginTop: 18 },
  safetyText: { color: GOLD.muted, fontSize: 13, fontFamily: FACE.semi },
  actions: {
    position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: 12, padding: 16, paddingBottom: 24,
    backgroundColor: GOLD.bg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: GOLD.border,
  },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    backgroundColor: GOLD.cardDeep, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 10,
    borderTopWidth: 1, borderColor: GOLD.border,
  },
  ageRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  to: { color: GOLD.sub, fontFamily: FACE.semi },
  field: {
    flex: 1, minHeight: 46, borderRadius: 10, borderWidth: 1, borderColor: GOLD.border, backgroundColor: GOLD.card,
    color: GOLD.text, paddingHorizontal: 12, fontSize: 15, fontFamily: FACE.body,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sheetActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  matchWrap: {
    flex: 1, backgroundColor: 'rgba(10,22,40,0.97)', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14,
  },
  opener: { color: GOLD.text, fontSize: 15, lineHeight: 22, fontFamily: FACE.body },
  safeNote: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  safeText: { color: GOLD.muted, fontSize: 12.5, fontFamily: FACE.body, flexShrink: 1 },
  matchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14, padding: 12, borderRadius: 18,
    backgroundColor: GOLD.card, borderWidth: 1, borderColor: GOLD.border,
  },
  matchName: { color: GOLD.text, fontFamily: FACE.title, fontSize: 24 },
  matchAge: { color: GOLD.gold, fontFamily: FACE.title, fontSize: 20 },
  matchSub: { color: GOLD.muted, fontSize: 13, fontFamily: FACE.body, marginTop: 2 },
  chatBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: GOLD.gold, alignItems: 'center', justifyContent: 'center' },
});
