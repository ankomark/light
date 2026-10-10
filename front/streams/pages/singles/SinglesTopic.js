// One community question and its replies. Report any reply that crosses the
// line; moderators can take it down.
import React, { useCallback, useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../../context/I18nContext';
import { fetchSinglesTopic, replySinglesTopic, heartSinglesTopic, reportContent } from '../../services/api';
import { notify, confirmAction } from '../../utils/adminConfirm';
import { GOLD, FACE, SinglesScreen, Portrait, Body, GoldButton } from '../../components/singles/SinglesKit';
import useSingles from '../../components/singles/useSingles';
import { TopicRow } from './SinglesCommunity';
import { useEmojiInput, EmojiToggle, EmojiPanel } from '../../components/EmojiKeyboard';

export default function SinglesTopic() {
  const { t } = useI18n();
  const { params = {} } = useRoute();
  // The last copy of this thread at once (and offline), refreshed behind it;
  // the network's "not there" (404) is told apart from no network.
  const [gone, setGone] = useState(false);
  const fetchTopic = useCallback(() => fetchSinglesTopic(params.id).catch((e) => {
    if (e?.status === 404) setGone(true);
    throw e;
  }), [params.id]);
  const { data: kept, setData: setTopic, failed: offline, reload } = useSingles(`topic:${params.id}`, fetchTopic);
  const topic = gone ? { failed: true } : kept;
  const [text, setText] = useState('');
  const inputRef = useRef(null);
  const emoji = useEmojiInput({ value: text, onChangeText: setText, maxLength: 600, inputRef });
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    try {
      const reply = await replySinglesTopic(topic.id, text.trim());
      setTopic((tp) => ({ ...tp, replies: [...tp.replies, reply], reply_count: tp.reply_count + 1 }));
      setText('');
    } catch (e) {
      notify(t('common.error'), e?.data?.code === 'slow_down' ? t('singles.community.replySlowDown') : t('singles.mine.failed'));
    } finally { setBusy(false); }
  };
  const report = async (kind, id) => {
    if (!(await confirmAction({ title: t('singles.community.reportTitle'), message: t('singles.community.reportBody'),
      confirmLabel: t('singles.safety.report'), cancelLabel: t('common.cancel') }))) return;
    try { await reportContent(kind, id, 'inappropriate'); notify(t('singles.safety.reportedTitle'), t('singles.safety.reportedBody')); }
    catch { notify(t('common.error'), t('singles.safety.failed')); }
  };

  return (
    <SinglesScreen title={t('singles.community.title')} testID="singles-topic"
      footer={topic && !topic.failed ? (
        <View>
        <View style={styles.reply}>
          <EmojiToggle open={emoji.open} onPress={emoji.toggle} color={GOLD.muted} testID="singles-reply-emoji" />
          <TextInput ref={inputRef} {...emoji.inputProps} style={styles.input} value={text} onChangeText={setText} maxLength={600} multiline
            placeholder={t('singles.community.replyPlaceholder')} placeholderTextColor={GOLD.muted}
            accessibilityLabel={t('singles.community.replyPlaceholder')} testID="singles-reply-input" />
          <TouchableOpacity style={styles.send} onPress={send} disabled={busy || !text.trim()} accessibilityRole="button"
            accessibilityLabel={t('dm.send')} testID="singles-reply-send">
            {busy ? <ActivityIndicator color={GOLD.onGold} /> : <Ionicons name="send" size={18} color={GOLD.onGold} />}
          </TouchableOpacity>
        </View>
        {emoji.open && <EmojiPanel onPick={emoji.insert} style={{ marginTop: 8 }} testID="singles-reply-emoji-panel" />}
        </View>
      ) : null}>
      {!topic && offline ? (
        <View style={{ alignItems: 'center', gap: 12, marginTop: 40 }} testID="singles-topic-offline">
          <Body style={{ textAlign: 'center' }}>{t('singles.loadFailed')}</Body>
          <GoldButton label={t('common.retry')} icon="refresh" kind="outline" onPress={reload} />
        </View>
      ) : !topic ? <ActivityIndicator color={GOLD.gold} style={{ marginTop: 40 }} /> : topic.failed ? (
        <Body style={{ textAlign: 'center' }}>{t('singles.view.gone')}</Body>
      ) : (
        <View style={{ gap: 12 }}>
          <TopicRow topic={topic} onHeart={async () => {
            const res = await heartSinglesTopic(topic.id).catch(() => null);
            if (res) setTopic((tp) => ({ ...tp, hearted: res.hearted, heart_count: res.heart_count }));
          }} />
          {!topic.mine && (
            <TouchableOpacity onPress={() => report('singlestopic', topic.id)} style={styles.reportLink} accessibilityRole="button">
              <Text style={styles.reportText}>{t('singles.safety.report')}</Text>
            </TouchableOpacity>
          )}
          {topic.replies.map((r) => (
            <View key={r.id} style={styles.row} testID={`singles-reply-${r.id}`}>
              <Portrait uri={r.author?.photo} size={34} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.name}>{r.author?.first_name}</Text>
                <Text style={styles.text}>{r.body}</Text>
              </View>
              {!r.mine && (
                <TouchableOpacity onPress={() => report('singlesreply', r.id)} hitSlop={10} accessibilityRole="button"
                  accessibilityLabel={t('singles.safety.report')}>
                  <Ionicons name="flag-outline" size={15} color={GOLD.muted} />
                </TouchableOpacity>
              )}
            </View>
          ))}
        </View>
      )}
    </SinglesScreen>
  );
}

const styles = StyleSheet.create({
  reply: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  input: {
    flex: 1, minHeight: 46, maxHeight: 120, borderRadius: 12, borderWidth: 1, borderColor: GOLD.border,
    backgroundColor: GOLD.card, color: GOLD.text, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, fontFamily: FACE.body,
  },
  send: { width: 46, height: 46, borderRadius: 23, backgroundColor: GOLD.gold, alignItems: 'center', justifyContent: 'center' },
  reportLink: { alignSelf: 'flex-end', minHeight: 36, justifyContent: 'center' },
  reportText: { color: GOLD.muted, fontSize: 12.5, fontFamily: FACE.semi },
  row: { flexDirection: 'row', gap: 10, padding: 12, borderRadius: 14, backgroundColor: GOLD.cardDeep },
  name: { color: GOLD.gold, fontSize: 13, fontFamily: FACE.bold },
  text: { color: GOLD.text, fontSize: 15, lineHeight: 22, fontFamily: FACE.body },
});
