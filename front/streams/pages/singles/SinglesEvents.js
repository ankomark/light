// Meet-ups and live rooms: where an online network becomes a community.
// Members suggest events (an admin lists them); "I'm interested" shows who's
// going and which of your matches are. Live rooms are singles-only audio
// rooms; verified members can host one.
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, Modal, Switch } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useI18n } from '../../context/I18nContext';
import {
  fetchSinglesGatherings, rsvpSinglesGathering, suggestSinglesGathering, fetchSinglesRooms, fetchBroadcastToken,
  startSinglesRoom,
} from '../../services/api';
import { notify } from '../../utils/adminConfirm';
import { GOLD, FACE, SinglesScreen, GoldButton, Label, Chip, Body, Card } from '../../components/singles/SinglesKit';

export const KINDS = ['coffee', 'bible_study', 'outdoors', 'concert', 'retreat', 'seminar', 'prayer', 'online'];
const KIND_ICON = {
  coffee: 'coffee-outline', bible_study: 'book-open-variant', outdoors: 'hiking', concert: 'music', retreat: 'pine-tree',
  seminar: 'microphone-variant', prayer: 'hands-pray', online: 'earth',
};

export default function SinglesEvents() {
  const { t } = useI18n();
  const navigation = useNavigation();
  const { params = {} } = useRoute();
  const [tab, setTab] = useState(params.tab || 'events');
  const [events, setEvents] = useState(null);
  const [rooms, setRooms] = useState(null);
  const [suggesting, setSuggesting] = useState(false);
  const [hosting, setHosting] = useState(false);

  const load = useCallback(async () => {
    fetchSinglesGatherings().then((r) => setEvents(r.results || [])).catch(() => setEvents((e) => e || []));
    fetchSinglesRooms().then((r) => setRooms(r.results || [])).catch(() => setRooms((e) => e || []));
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const rsvp = async (g) => {
    try {
      const updated = await rsvpSinglesGathering(g.id);
      setEvents((list) => list.map((x) => (x.id === g.id ? updated : x)));
    } catch { notify(t('common.error'), t('singles.mine.failed')); }
  };
  const join = async (room) => {
    try {
      const res = await fetchBroadcastToken(room.id);
      navigation.navigate('LiveRoom', { url: res.url, token: res.token, broadcast: res.broadcast, role: 'viewer' });
    } catch { notify(t('common.error'), t('singles.rooms.cantJoin')); load(); }
  };

  return (
    <SinglesScreen title={t('singles.events.title')} testID="singles-events"
      footer={tab === 'events'
        ? <GoldButton label={t('singles.events.suggest')} icon="add" kind="outline" onPress={() => setSuggesting(true)} testID="singles-suggest" />
        : <GoldButton label={t('singles.rooms.host')} icon="mic" kind="outline" onPress={() => setHosting(true)} testID="singles-host" />}>
      <View style={styles.seg}>
        {['events', 'rooms'].map((k) => (
          <TouchableOpacity key={k} onPress={() => setTab(k)} style={[styles.segBtn, tab === k && styles.segOn]}
            accessibilityRole="tab" accessibilityState={{ selected: tab === k }} testID={`singles-events-${k}`}>
            <Text style={[styles.segText, tab === k && styles.segTextOn]}>{t(`singles.events.tab.${k}`)}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {tab === 'events' ? (events === null ? <ActivityIndicator color={GOLD.gold} /> : events.length ? events.map((g) => (
        <Card key={g.id} style={{ marginTop: 12 }} testID={`singles-event-${g.id}`}>
          <View style={styles.head}>
            <MaterialCommunityIcons name={KIND_ICON[g.kind] || 'calendar'} size={22} color={GOLD.gold} />
            <Text style={styles.kind}>{t(`singles.eventKind.${g.kind}`)}</Text>
            {g.status === 'pending' && <Text style={styles.pending}>{t('singles.events.pending')}</Text>}
          </View>
          <Text style={styles.title}>{g.title}</Text>
          <Text style={styles.when}>
            {new Date(g.starts_at).toLocaleString([], { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' })}
          </Text>
          {!!(g.place || g.country) && <Text style={styles.where}>{[g.place, g.country].filter(Boolean).join(', ')}</Text>}
          {!!g.description && <Body style={{ fontSize: 14 }}>{g.description}</Body>}
          <Text style={styles.going}>
            {t('singles.events.going', { n: g.going })}
            {g.friends_going?.length ? `  ·  ${t('singles.events.friends', { names: g.friends_going.join(', ') })}` : ''}
          </Text>
          {g.status === 'approved' && (
            <GoldButton label={g.interested ? t('singles.events.notGoing') : t('singles.events.interested')}
              icon={g.interested ? 'checkmark' : 'star-outline'} kind={g.interested ? 'outline' : 'solid'}
              onPress={() => rsvp(g)} testID={`singles-rsvp-${g.id}`} />
          )}
        </Card>
      )) : <Body style={styles.empty}>{t('singles.events.none')}</Body>) : (
        rooms === null ? <ActivityIndicator color={GOLD.gold} /> : rooms.length ? rooms.map((r) => (
          <TouchableOpacity key={r.id} style={styles.room} onPress={() => join(r)} accessibilityRole="button" testID={`singles-room-${r.id}`}>
            <View style={styles.liveDot} />
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{r.title}</Text>
              <Text style={styles.when}>{t('singles.rooms.listening', { n: r.listening, host: r.host })}</Text>
            </View>
            <MaterialCommunityIcons name="headphones" size={22} color={GOLD.gold} />
          </TouchableOpacity>
        )) : <Body style={styles.empty}>{t('singles.rooms.none')}</Body>
      )}
      <SuggestSheet visible={suggesting} onClose={() => setSuggesting(false)}
        onDone={(g) => { setSuggesting(false); setEvents((list) => [...(list || []), g]); notify(t('singles.events.sentTitle'), t('singles.events.sentBody')); }} />
      <HostSheet visible={hosting} onClose={() => setHosting(false)}
        onLive={(res) => { setHosting(false); navigation.navigate('LiveRoom', { url: res.url, token: res.token, broadcast: res.broadcast, role: 'host', initialMicOn: true, initialCamOn: false }); }} />
    </SinglesScreen>
  );
}

function SuggestSheet({ visible, onClose, onDone }) {
  const { t } = useI18n();
  const [f, setF] = useState({ kind: 'coffee', title: '', date: '', time: '', place: '', country: '', description: '', online: false });
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF((c) => ({ ...c, [k]: v }));
  const send = async () => {
    const starts = new Date(`${f.date}T${f.time || '00:00'}`);
    if (!f.title.trim() || Number.isNaN(starts.getTime())) { notify(t('singles.edit.checkTitle'), t('singles.events.whenBad')); return; }
    setBusy(true);
    try {
      onDone(await suggestSinglesGathering({ kind: f.kind, title: f.title.trim(), description: f.description.trim(),
        starts_at: starts.toISOString(), place: f.place.trim(), country: f.country.trim(), online: f.online }));
    } catch { notify(t('singles.edit.checkTitle'), t('singles.events.whenBad')); } finally { setBusy(false); }
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.scrim}>
        <ScrollView style={styles.sheet} contentContainerStyle={{ gap: 10, paddingBottom: 30 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.sheetTitle}>{t('singles.events.suggest')}</Text>
          <View style={styles.chips}>
            {KINDS.map((k) => <Chip key={k} text={t(`singles.eventKind.${k}`)} on={f.kind === k} onPress={() => set('kind')(k)} />)}
          </View>
          <Label>{t('singles.events.fieldTitle')}</Label>
          <TextInput style={styles.input} value={f.title} onChangeText={set('title')} maxLength={120} accessibilityLabel={t('singles.events.fieldTitle')} />
          <Label>{t('singles.events.fieldWhen')}</Label>
          <View style={styles.row}>
            <TextInput style={styles.input} value={f.date} onChangeText={set('date')} placeholder="YYYY-MM-DD" placeholderTextColor={GOLD.muted}
              accessibilityLabel={t('singles.events.fieldDate')} />
            <TextInput style={styles.input} value={f.time} onChangeText={set('time')} placeholder="HH:MM" placeholderTextColor={GOLD.muted}
              accessibilityLabel={t('singles.events.fieldTime')} />
          </View>
          <Label>{t('singles.events.fieldPlace')}</Label>
          <TextInput style={styles.input} value={f.place} onChangeText={set('place')} maxLength={160} accessibilityLabel={t('singles.events.fieldPlace')} />
          <TextInput style={styles.input} value={f.country} onChangeText={set('country')} maxLength={60} placeholder={t('singles.field.country')}
            placeholderTextColor={GOLD.muted} accessibilityLabel={t('singles.field.country')} />
          <View style={styles.switchRow}>
            <Text style={styles.when}>{t('singles.events.online')}</Text>
            <Switch value={f.online} onValueChange={set('online')} trackColor={{ true: GOLD.gold, false: GOLD.border }} thumbColor="#FFFFFF" />
          </View>
          <Label>{t('singles.events.fieldAbout')}</Label>
          <TextInput style={[styles.input, { minHeight: 80 }]} value={f.description} onChangeText={set('description')} multiline maxLength={1500}
            accessibilityLabel={t('singles.events.fieldAbout')} />
          <View style={styles.row}>
            <GoldButton label={t('common.cancel')} kind="outline" onPress={onClose} />
            <GoldButton label={t('singles.events.send')} onPress={send} busy={busy} />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function HostSheet({ visible, onClose, onLive }) {
  const { t } = useI18n();
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { onLive(await startSinglesRoom(title.trim())); } catch (e) {
      notify(t('singles.rooms.host'), e?.data?.code === 'singles_host' ? t('singles.rooms.needVerified') : t('singles.mine.failed'));
    } finally { setBusy(false); }
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.scrim}>
        <View style={[styles.sheet, { gap: 12 }]}>
          <Text style={styles.sheetTitle}>{t('singles.rooms.host')}</Text>
          <Body style={{ fontSize: 14 }}>{t('singles.rooms.hostLead')}</Body>
          <TextInput style={styles.input} value={title} onChangeText={setTitle} maxLength={200}
            placeholder={t('singles.rooms.titleHint')} placeholderTextColor={GOLD.muted} accessibilityLabel={t('singles.rooms.titleHint')} />
          <View style={styles.row}>
            <GoldButton label={t('common.cancel')} kind="outline" onPress={onClose} />
            <GoldButton label={t('singles.rooms.start')} icon="mic" onPress={go} busy={busy} disabled={!title.trim()} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  seg: { flexDirection: 'row', borderRadius: 999, padding: 4, backgroundColor: GOLD.cardDeep, borderWidth: 1, borderColor: GOLD.border },
  segBtn: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 999 },
  segOn: { backgroundColor: GOLD.gold },
  segText: { color: GOLD.sub, fontSize: 14, fontFamily: FACE.bold },
  segTextOn: { color: GOLD.onGold },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  kind: { color: GOLD.gold, fontSize: 12.5, fontFamily: FACE.heavy, textTransform: 'uppercase', letterSpacing: 1, flex: 1 },
  pending: { color: GOLD.muted, fontSize: 12, fontFamily: FACE.semi },
  title: { color: GOLD.text, fontFamily: FACE.title, fontSize: 24, lineHeight: 29 },
  when: { color: GOLD.sub, fontSize: 14, fontFamily: FACE.semi },
  where: { color: GOLD.muted, fontSize: 13.5, fontFamily: FACE.body },
  going: { color: GOLD.gold, fontSize: 13, fontFamily: FACE.bold },
  empty: { textAlign: 'center', marginTop: 30 },
  room: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 18, marginTop: 12,
    backgroundColor: GOLD.card, borderWidth: 1, borderColor: 'rgba(242,139,130,0.45)',
  },
  liveDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#F28B82' },
  scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { maxHeight: '88%', backgroundColor: GOLD.cardDeep, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 },
  sheetTitle: { color: GOLD.text, fontFamily: FACE.title, fontSize: 28 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  input: {
    flex: 1, minHeight: 46, borderRadius: 10, borderWidth: 1, borderColor: GOLD.border, backgroundColor: GOLD.card,
    color: GOLD.text, paddingHorizontal: 12, fontSize: 15, fontFamily: FACE.body,
  },
  row: { flexDirection: 'row', gap: 10 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 },
});
