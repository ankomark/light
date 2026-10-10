// A match's profile, opened from Matches: who they are, ways to begin, the
// get-to-know-you game (both answer before either sees), telling your story
// if it becomes one, and — always within reach — unmatch, report or block.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet, Modal } from 'react-native';
import KeyboardSheetPad from '../../components/KeyboardSheetPad';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../../context/I18nContext';
import {
  unmatchSingles, fetchIcebreakers, askIcebreaker, answerIcebreaker, tellSinglesStory, agreeSinglesStory,
  withdrawSinglesStory,
} from '../../services/api';
import { confirmAction, notify } from '../../utils/adminConfirm';
import { subscribeDM } from '../../services/dmSocket';
import {
  GOLD, FACE, SinglesScreen, GoldButton, Card, Label, Body, Chip, useSheetPad,
} from '../../components/singles/SinglesKit';
import ProfileCard from '../../components/singles/ProfileCard';
import SafetySheet from '../../components/singles/SafetySheet';
import { EmojiTextInput } from '../../components/EmojiKeyboard';

export function starterText(t, s, name) {
  if (s.kind === 'prompt') return t('singles.starter.prompt', { prompt: t(`singles.prompt.${s.key}`), answer: s.answer });
  if (s.kind === 'ministry') return t('singles.starter.ministry', { value: t(`singles.ministry.${s.value}`) });
  if (s.kind === 'interest') return t('singles.starter.interest', { value: s.value });
  if (s.kind === 'church') return t('singles.starter.church', { value: s.value });
  return t('singles.starter.meaningful', { name });
}

export default function SinglesPerson() {
  const { t } = useI18n();
  const navigation = useNavigation();
  const { params = {} } = useRoute();
  const match = params.match;
  const [safety, setSafety] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ice, setIce] = useState({ results: [], keys: [] });
  const [drafts, setDrafts] = useState({});
  const [story, setStory] = useState(false);

  const loadIce = useCallback(async () => {
    if (!match) return;
    try { setIce(await fetchIcebreakers(match.id)); } catch { /* the rest still works */ }
  }, [match]);
  useFocusEffect(useCallback(() => { loadIce(); }, [loadIce]));
  // Their answer arrives live: the other side of a question shows at once.
  useEffect(() => subscribeDM((e) => {
    if (e.type === 'singles_icebreaker' && match && e.match_id === match.id) loadIce();
  }), [loadIce, match]);
  if (!match) return null;
  const p = match.profile;
  const openChat = () => navigation.navigate('Chat', { conversationId: match.conversation_id, otherUser: match.user, singles: true });
  const asked = new Set(ice.results.map((i) => i.key));

  const unmatch = async () => {
    if (!(await confirmAction({ title: t('singles.unmatch.title', { name: p.first_name }), message: t('singles.unmatch.body'),
      confirmLabel: t('singles.unmatch.confirm'), cancelLabel: t('common.cancel'), destructive: true }))) return;
    setBusy(true);
    try { await unmatchSingles(match.id); navigation.goBack(); } catch { notify(t('common.error'), t('singles.mine.failed')); }
    finally { setBusy(false); }
  };
  const ask = async (key) => {
    try { await askIcebreaker(match.id, key); loadIce(); } catch { notify(t('common.error'), t('singles.mine.failed')); }
  };
  const reply = async (item) => {
    const text = (drafts[item.id] || '').trim();
    if (!text) return;
    try { await answerIcebreaker(item.id, text); setDrafts((d) => ({ ...d, [item.id]: '' })); loadIce(); }
    catch { notify(t('common.error'), t('singles.mine.failed')); }
  };

  return (
    <SinglesScreen title={p.first_name} testID="singles-person"
      right={(
        <TouchableOpacity onPress={() => setSafety(true)} accessibilityRole="button"
          accessibilityLabel={t('singles.safety.link')} hitSlop={10} testID="singles-person-safety">
          <Ionicons name="flag-outline" size={21} color={GOLD.text} />
        </TouchableOpacity>
      )}
      footer={<GoldButton label={t('singles.match.hello')} icon="chatbubble-ellipses" onPress={openChat} testID="singles-person-chat" />}>
      <ProfileCard profile={p} />

      <Card style={{ marginTop: 22 }}>
        <Label>{t('singles.starter.title')}</Label>
        <Text style={styles.note}>{t('singles.starter.note')}</Text>
        {(match.starters || []).map((s, i) => (
          <TouchableOpacity key={`${s.kind}-${i}`} style={styles.starter} onPress={openChat} accessibilityRole="button"
            testID={`singles-starter-${i}`}>
            <Ionicons name="chatbubble-outline" size={16} color={GOLD.gold} />
            <Text style={styles.starterText}>{starterText(t, s, p.first_name)}</Text>
          </TouchableOpacity>
        ))}
      </Card>

      <Card style={{ marginTop: 16 }} testID="singles-icebreakers">
        <Label>{t('singles.ice.title')}</Label>
        <Text style={styles.note}>{t('singles.ice.lead')}</Text>
        {ice.results.map((item) => (
          <View key={item.id} style={styles.ice} testID={`singles-ice-${item.id}`}>
            <Text style={styles.iceQ}>{t(`singles.ice.q.${item.key}`)}</Text>
            {item.mine ? <Text style={styles.iceA}>{t('singles.ice.you', { answer: item.mine })}</Text> : (
              <View style={styles.iceReply}>
                <EmojiTextInput containerStyle={{ flex: 1 }} style={styles.input} value={drafts[item.id] || ''} onChangeText={(v) => setDrafts((d) => ({ ...d, [item.id]: v }))}
                  maxLength={300} placeholder={t('singles.ice.yours')} placeholderTextColor={GOLD.muted}
                  accessibilityLabel={t('singles.ice.yours')} testID={`singles-ice-input-${item.id}`} />
                <TouchableOpacity style={styles.send} onPress={() => reply(item)} accessibilityRole="button"
                  accessibilityLabel={t('dm.send')} testID={`singles-ice-send-${item.id}`}>
                  <Ionicons name="send" size={16} color={GOLD.onGold} />
                </TouchableOpacity>
              </View>
            )}
            {item.theirs ? <Text style={styles.iceA}>{t('singles.ice.them', { name: p.first_name, answer: item.theirs })}</Text>
              : <Text style={styles.waiting}>{item.waiting_for === 'them' ? t('singles.ice.waitingThem', { name: p.first_name }) : t('singles.ice.waitingYou')}</Text>}
          </View>
        ))}
        <View style={styles.chips}>
          {ice.keys.filter((k) => !asked.has(k)).slice(0, 4).map((k) => (
            <Chip key={k} icon="help-circle-outline" text={t(`singles.ice.q.${k}`)} onPress={() => ask(k)} testID={`singles-ice-ask-${k}`} />
          ))}
        </View>
      </Card>

      {match.story && !match.story.agreed && (
        <Card style={{ marginTop: 16 }} testID="singles-story-ask">
          <Label>{t('singles.stories.askTitle')}</Label>
          <Body>{t('singles.stories.askBody', { name: p.first_name, title: match.story.title })}</Body>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {/* Failures are said, not swallowed: "you agreed" while offline
                was untrue, and a decline that didn't go through looked done. */}
            <GoldButton label={t('singles.stories.decline')} kind="outline" onPress={async () => {
              try { await withdrawSinglesStory(match.story.id); navigation.goBack(); }
              catch { notify(t('common.error'), t('singles.mine.failed')); }
            }} testID="singles-story-decline" />
            <GoldButton label={t('singles.stories.agree')} onPress={async () => {
              try {
                await agreeSinglesStory(match.story.id);
                notify(t('singles.stories.agreedTitle'), t('singles.stories.agreedBody'));
                navigation.goBack();
              } catch { notify(t('common.error'), t('singles.mine.failed')); }
            }} testID="singles-story-agree" />
          </View>
        </Card>
      )}

      <View style={{ marginTop: 18, gap: 4 }}>
        {!match.story && (
          <GoldButton label={t('singles.stories.tell')} icon="sparkles-outline" kind="outline" onPress={() => setStory(true)} />
        )}
        <GoldButton label={t('singles.unmatch.button')} kind="quiet" onPress={unmatch} busy={busy} testID="singles-unmatch" />
      </View>
      <SafetySheet profile={p} visible={safety} onClose={() => setSafety(false)} onDone={() => navigation.goBack()} />
      <StorySheet visible={story} matchId={match.id} name={p.first_name} onClose={() => setStory(false)} />
    </SinglesScreen>
  );
}

function StorySheet({ visible, matchId, name, onClose }) {
  const { t } = useI18n();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const sheetPad = useSheetPad();
  const send = async () => {
    setBusy(true);
    try {
      await tellSinglesStory(matchId, title.trim(), body.trim());
      notify(t('singles.stories.sentTitle'), t('singles.stories.sentBody', { name }));
      onClose();
    } catch (e) {
      // "Too short" only when the server said so - not for every failure.
      if (e?.status === 400) notify(t('singles.edit.checkTitle'), t('singles.stories.tooShort'));
      else notify(t('common.error'), t('singles.mine.failed'));
    } finally { setBusy(false); }
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardSheetPad style={styles.scrim}>
        <View style={[styles.sheet, { paddingBottom: sheetPad }]}>
          <Text style={styles.sheetTitle}>{t('singles.stories.tell')}</Text>
          <Body style={{ fontSize: 14 }}>{t('singles.stories.tellLead', { name })}</Body>
          <TextInput style={styles.input} value={title} onChangeText={setTitle} maxLength={120} placeholder={t('singles.stories.titleHint')}
            placeholderTextColor={GOLD.muted} accessibilityLabel={t('singles.stories.titleHint')} />
          <EmojiTextInput style={[styles.input, { minHeight: 120 }]} value={body} onChangeText={setBody} multiline maxLength={3000}
            placeholder={t('singles.stories.bodyHint')} placeholderTextColor={GOLD.muted} accessibilityLabel={t('singles.stories.bodyHint')} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <GoldButton label={t('common.cancel')} kind="outline" onPress={onClose} />
            <GoldButton label={t('singles.stories.send')} onPress={send} busy={busy} />
          </View>
        </View>
      </KeyboardSheetPad>
    </Modal>
  );
}

const styles = StyleSheet.create({
  note: { color: GOLD.muted, fontSize: 12.5, lineHeight: 18, fontFamily: FACE.body },
  starter: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 10, minHeight: 44 },
  starterText: { flex: 1, color: GOLD.text, fontSize: 14.5, lineHeight: 21, fontFamily: FACE.body },
  ice: { gap: 6, paddingVertical: 10, borderTopWidth: 1, borderTopColor: GOLD.border },
  iceQ: { color: GOLD.text, fontSize: 15, fontFamily: FACE.bold },
  iceA: { color: GOLD.sub, fontSize: 14, fontFamily: FACE.body, lineHeight: 20 },
  waiting: { color: GOLD.muted, fontSize: 13, fontStyle: 'italic', fontFamily: FACE.body },
  iceReply: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: {
    flex: 1, minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: GOLD.border, backgroundColor: GOLD.cardDeep,
    color: GOLD.text, paddingHorizontal: 12, paddingVertical: 8, fontSize: 15, fontFamily: FACE.body, textAlignVertical: 'top',
  },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: GOLD.gold, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { backgroundColor: GOLD.cardDeep, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 12 },
  sheetTitle: { color: GOLD.text, fontFamily: FACE.title, fontSize: 28 },
});
