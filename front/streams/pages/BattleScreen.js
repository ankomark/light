/**
 * Live Bible Battle: a room where everyone answers the same question at the
 * same moment, and the ranking moves as they go — for a youth night, a
 * Sabbath programme, a class.
 *
 * One screen, host or player. The server decides every step (songs/battle.py)
 * and tells the room over the socket; this screen draws what it is told, keeps
 * the question's clock, and when the clock runs out asks for the answer to be
 * shown (the server takes each step once, however many phones ask). If the
 * socket drops it re-reads the battle every few seconds until it is back.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  createBattle, joinBattle, fetchBattle, startBattle, answerBattle, revealBattle, nextBattle,
} from '../services/api';
import { subscribeBattle } from '../services/battleSocket';
import { useI18n } from '../context/I18nContext';
import { quizLanguage } from '../utils/quizCache';
import { tapFeedback, correctFeedback, wrongFeedback } from '../services/quizSound';
import {
  Backdrop, Coins, quizStyles as q, DISPLAY, DISPLAY_MID, SERIF, GOLD, GOLD_DEEP, PARCHMENT, MUTED, INK,
} from './quizTheme';

const SECONDS = [10, 15, 20, 30];
// A shown answer may be moved on after this long (the server's REVEAL_HOLD).
const HOLD_MS = 8500;
const POLL_MS = 3000;
const MARKS = ['A', 'B', 'C', 'D'];

export const battleLink = (code) => `streams://battle/${code}`;

const BattleScreen = ({ navigation, route }) => {
  const { t, resolvedLanguage } = useI18n();
  const lang = quizLanguage(resolvedLanguage);
  const hosting = route?.params?.mode === 'host';

  const [battle, setBattle] = useState(null);
  const [title, setTitle] = useState('');
  const [seconds, setSeconds] = useState(20);
  const [codeInput, setCodeInput] = useState((route?.params?.code || '').toUpperCase());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState(null);
  const [remaining, setRemaining] = useState(0);
  const [live, setLive] = useState(false);
  const deadline = useRef(0);
  const asked = useRef({ reveal: -1, next: -1 });
  const code = battle?.code;

  // Every state the server hands back goes through here, so an open
  // question always brings its clock with it — however it arrived.
  const apply = useCallback((s) => {
    if (s?.status === 'question' && s.question) deadline.current = Date.now() + s.question.remaining_ms;
    setBattle(s);
  }, []);

  const refresh = useCallback(async () => {
    if (!code) return;
    try {
      apply(await fetchBattle(code));
    } catch { /* the next event or poll will try again */ }
  }, [code, apply]);

  // ── joining and hosting ────────────────────────────────────────────────────
  const refusal = (e) => t(`battle.error.${e?.response?.data?.code || e?.data?.code || 'failed'}`);
  const join = useCallback(async (value) => {
    const c = String(value || '').trim().toUpperCase();
    if (c.length !== 6) { setError(t('battle.error.code')); return; }
    setBusy(true); setError('');
    try {
      apply(await joinBattle(c));
    } catch (e) {
      setError(e?.response?.status === 404 ? t('battle.error.not_found') : refusal(e));
    } finally { setBusy(false); }
  }, [t, apply]); // eslint-disable-line react-hooks/exhaustive-deps

  const host = async () => {
    setBusy(true); setError('');
    try {
      apply(await createBattle({ title, seconds, language: lang }));
    } catch (e) { setError(refusal(e)); } finally { setBusy(false); }
  };

  // A link or a shared code: straight in.
  useEffect(() => {
    if (!hosting && route?.params?.code) join(route.params.code);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── the room ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!code) return undefined;
    const off = subscribeBattle(code, (evt) => {
      if (evt.type === 'status') { setLive(evt.open); if (evt.open) refresh(); return; }
      if (evt.type === 'question') {
        deadline.current = Date.now() + evt.question.remaining_ms;
        setPicked(null);
        setBattle((b) => b && ({
          ...b, status: 'question', current: evt.question.index, question: evt.question,
          answered: 0, reveal: null, me: b.me ? { ...b.me, answered: false, last: null } : b.me,
        }));
      } else if (evt.type === 'progress') {
        setBattle((b) => b && ({ ...b, answered: evt.answered, players: evt.players }));
      } else if (evt.type === 'reveal') {
        setBattle((b) => b && ({ ...b, status: 'reveal', reveal: evt.reveal }));
        refresh();                                    // my points, my place, my answer
      } else if (evt.type === 'finished' || evt.type === 'joined') {
        refresh();
      }
    });
    return off;
  }, [code, refresh]);

  // Without the socket, read the battle every few seconds.
  useEffect(() => {
    if (!code || live || battle?.status === 'finished') return undefined;
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [code, live, battle?.status, refresh]);

  // The question's clock; at zero, ask for the answer to be shown.
  const status = battle?.status;
  const index = battle?.current;
  useEffect(() => {
    if (status !== 'question') return undefined;
    const tick = () => {
      const left = Math.max(0, deadline.current - Date.now());
      setRemaining(left);
      if (left === 0 && asked.current.reveal !== index) {
        asked.current.reveal = index;
        revealBattle(code, index).then(apply).catch(() => {});
      }
    };
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [status, index, code]);

  // A shown answer moves on by itself after a while (the host may go sooner).
  useEffect(() => {
    if (status !== 'reveal' || battle?.is_host) return undefined;
    const id = setTimeout(() => {
      if (asked.current.next === index) return;
      asked.current.next = index;
      nextBattle(code, index).then(apply).catch(() => {});
    }, HOLD_MS);
    return () => clearTimeout(id);
  }, [status, index, code, battle?.is_host]);

  // Right or wrong, felt when the answer is shown.
  const lastKnown = battle?.me?.last;
  useEffect(() => {
    if (status !== 'reveal' || !lastKnown) return;
    if (lastKnown.correct) correctFeedback(); else wrongFeedback();
  }, [status, lastKnown?.correct]); // eslint-disable-line react-hooks/exhaustive-deps

  const answer = async (i) => {
    if (picked !== null || battle?.me?.answered) return;
    tapFeedback();
    setPicked(i);
    try {
      await answerBattle(code, index, i);
      setBattle((b) => b && ({ ...b, me: b.me ? { ...b.me, answered: true } : b.me }));
    } catch (e) {
      setPicked(null);
      setError(refusal(e));
    }
  };

  const step = async (fn) => {
    setBusy(true); setError('');
    try { apply(await fn()); } catch (e) { setError(refusal(e)); } finally { setBusy(false); }
  };

  const share = () => Share.share({
    message: `${t('battle.shareMessage', { code })}\n${battleLink(code)}`,
  }).catch(() => {});

  // ── drawing ────────────────────────────────────────────────────────────────
  const Header = (
    <View style={q.header}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={q.iconBtn} hitSlop={10}
                        accessibilityRole="button" accessibilityLabel={t('common.close')}>
        <Ionicons name="close" size={22} color="#7E8DA3" />
      </TouchableOpacity>
      <Text style={q.headerTitle} numberOfLines={1}>{battle?.title || t('battle.title')}</Text>
      <View style={q.iconBtn}>
        {!!code && <Ionicons name={live ? 'radio' : 'radio-outline'} size={16} color={live ? GOLD : MUTED} />}
      </View>
    </View>
  );

  let body;
  if (!battle) {
    body = hosting ? (
      <View style={styles.form}>
        <Text style={styles.lead}>{t('battle.hostLead')}</Text>
        <TextInput
          style={styles.input} value={title} onChangeText={setTitle} maxLength={80}
          placeholder={t('battle.titlePlaceholder')} placeholderTextColor={MUTED}
          accessibilityLabel={t('battle.titlePlaceholder')}
        />
        <Text style={q.eyebrow}>{t('battle.secondsLabel')}</Text>
        <View style={styles.chips}>
          {SECONDS.map((s) => (
            <TouchableOpacity key={s} style={[styles.chip, seconds === s && styles.chipOn]}
                              onPress={() => setSeconds(s)} accessibilityRole="button"
                              accessibilityState={{ selected: seconds === s }}>
              <Text style={[styles.chipText, seconds === s && styles.chipTextOn]}>{t('battle.seconds', { count: s })}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity style={[q.primaryBtn, styles.wide]} onPress={host} disabled={busy} accessibilityRole="button">
          {busy ? <ActivityIndicator color={INK} /> : <Text style={q.primaryBtnText}>{t('battle.create')}</Text>}
        </TouchableOpacity>
      </View>
    ) : (
      <View style={styles.form}>
        <Text style={styles.lead}>{t('battle.joinLead')}</Text>
        <TextInput
          style={[styles.input, styles.codeInput]} value={codeInput}
          onChangeText={(v) => setCodeInput(v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
          autoCapitalize="characters" autoCorrect={false} maxLength={6}
          placeholder="ABC123" placeholderTextColor={MUTED} accessibilityLabel={t('battle.codeLabel')}
          testID="battle-code-input"
        />
        <TouchableOpacity style={[q.primaryBtn, styles.wide]} onPress={() => join(codeInput)} disabled={busy}
                          accessibilityRole="button">
          {busy ? <ActivityIndicator color={INK} /> : <Text style={q.primaryBtnText}>{t('battle.join')}</Text>}
        </TouchableOpacity>
      </View>
    );
  } else if (status === 'lobby') {
    body = (
      <View style={styles.center}>
        <Text style={q.eyebrow}>{t('battle.codeLabel')}</Text>
        <Text style={styles.code} accessibilityLabel={code.split('').join(' ')}>{code}</Text>
        <TouchableOpacity style={styles.shareBtn} onPress={share} accessibilityRole="button">
          <Ionicons name="share-social" size={15} color={GOLD} />
          <Text style={styles.shareText}>{t('battle.invite')}</Text>
        </TouchableOpacity>
        <Text style={styles.count}>{t('battle.playersIn', { count: battle.players })}</Text>
        <View style={styles.names}>
          {(battle.lobby || []).map((n) => <Text key={n} style={styles.name}>{n}</Text>)}
        </View>
        {battle.is_host ? (
          <TouchableOpacity style={[q.primaryBtn, styles.wide, !battle.players && styles.off]}
                            onPress={() => step(() => startBattle(code))}
                            disabled={busy || !battle.players} accessibilityRole="button">
            <Text style={q.primaryBtnText}>{t('battle.start')}</Text>
          </TouchableOpacity>
        ) : <Text style={styles.wait}>{t('battle.waitingForHost', { host: battle.host })}</Text>}
      </View>
    );
  } else if (status === 'question' && battle.question) {
    const qq = battle.question;
    const fraction = qq.seconds ? remaining / (qq.seconds * 1000) : 0;
    const locked = picked !== null || battle.me?.answered;
    body = (
      <View style={styles.play}>
        <View style={styles.row}>
          <Text style={q.eyebrow}>{t('battle.questionOf', { n: qq.index + 1, total: qq.total })}</Text>
          <Text style={styles.clock} accessibilityLiveRegion="polite">{Math.ceil(remaining / 1000)}</Text>
        </View>
        <View style={styles.track}><View style={[styles.fill, { width: `${fraction * 100}%` }]} /></View>
        {!!qq.passage && <Text style={styles.passage}>{qq.passage}</Text>}
        <Text style={styles.prompt}>{qq.prompt}</Text>
        {qq.choices.map((c, i) => (
          <TouchableOpacity
            key={`${qq.index}-${i}`}
            style={[styles.choice, picked === i && styles.choicePicked, (battle.is_host || locked) && picked !== i && styles.choiceIdle]}
            onPress={() => answer(i)}
            disabled={battle.is_host || locked}
            accessibilityRole="button"
            accessibilityState={{ selected: picked === i, disabled: battle.is_host || locked }}
            accessibilityLabel={`${MARKS[i] || i + 1}. ${c}`}
          >
            <Text style={styles.mark}>{MARKS[i] || i + 1}</Text>
            <Text style={styles.choiceText}>{c}</Text>
          </TouchableOpacity>
        ))}
        <Text style={styles.wait}>
          {battle.is_host
            ? t('battle.answered', { answered: battle.answered || 0, players: battle.players })
            : locked ? t('battle.answerIn') : ''}
        </Text>
      </View>
    );
  } else if (status === 'reveal' && battle.reveal) {
    const r = battle.reveal;
    const qq = battle.question;
    const most = Math.max(1, ...r.counts);
    const me = battle.me;
    body = (
      <View style={styles.play}>
        {!battle.is_host && me?.last && (
          <View style={[styles.result, me.last.correct ? styles.resultRight : styles.resultWrong]} testID="battle-result">
            <Text style={styles.resultText}>
              {me.last.correct ? t('battle.right', { points: me.last.points }) : t('battle.wrong')}
            </Text>
            <Text style={styles.place}>{t('battle.place', { place: me.place })}</Text>
          </View>
        )}
        {!battle.is_host && me && !me.last && <Text style={styles.wait}>{t('battle.noAnswer')}</Text>}
        {qq?.choices.map((c, i) => (
          <View key={i} style={[styles.choice, i === r.answer_index ? styles.choiceRight : styles.choiceIdle]}>
            <Text style={styles.mark}>{MARKS[i] || i + 1}</Text>
            <Text style={styles.choiceText}>{c}</Text>
            <View style={styles.bar}><View style={[styles.barFill, { width: `${(r.counts[i] / most) * 100}%` }]} /></View>
            <Text style={styles.barCount}>{r.counts[i]}</Text>
          </View>
        ))}
        {!!r.reference && <Text style={styles.reference}>{r.reference}</Text>}
        <Board rows={r.ranking.slice(0, 5)} t={t} />
        {battle.is_host ? (
          <TouchableOpacity style={[q.primaryBtn, styles.wide]} onPress={() => step(() => nextBattle(code, index))}
                            disabled={busy} accessibilityRole="button">
            <Text style={q.primaryBtnText}>
              {index + 1 >= (qq?.total || 0) ? t('battle.finish') : t('battle.next')}
            </Text>
          </TouchableOpacity>
        ) : <Text style={styles.wait}>{t('battle.nextSoon')}</Text>}
      </View>
    );
  } else if (status === 'finished') {
    body = (
      <View style={styles.play}>
        <Text style={styles.podiumTitle}>{t('battle.finalTitle')}</Text>
        {!battle.is_host && battle.me && (
          <Text style={styles.place}>{t('battle.finalPlace', { place: battle.me.place, points: battle.me.points })}</Text>
        )}
        <Board rows={battle.ranking || []} t={t} podium />
        <TouchableOpacity style={[q.ghostBtn, styles.wide]} onPress={() => navigation.goBack()} accessibilityRole="button">
          <Text style={q.ghostBtnText}>{t('common.done')}</Text>
        </TouchableOpacity>
      </View>
    );
  } else {
    body = <ActivityIndicator color={GOLD} style={styles.loading} />;
  }

  return (
    <View style={q.root}>
      <Backdrop />
      <SafeAreaView style={q.flex} edges={['top', 'bottom']}>
        {Header}
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {body}
          {!!error && <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text>}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
};

const Board = ({ rows, t, podium }) => (
  <View style={styles.board} testID="battle-board">
    <Text style={q.eyebrow}>{t('battle.ranking')}</Text>
    {rows.map((r, i) => (
      <View key={r.id} style={[styles.boardRow, podium && i < 3 && styles.boardTop]}>
        <Text style={[styles.boardRank, podium && i < 3 && { color: GOLD }]}>{i + 1}</Text>
        <Text style={styles.boardName} numberOfLines={1}>{r.username}</Text>
        <Coins value={r.points} size={16} textSize={13} />
      </View>
    ))}
  </View>
);

const styles = StyleSheet.create({
  scroll: { padding: 20, paddingBottom: 40 },
  form: { gap: 14 },
  lead: { fontFamily: SERIF, fontSize: 15, lineHeight: 23, color: '#C6CBD2' },
  input: {
    minHeight: 50, borderRadius: 14, paddingHorizontal: 16, fontSize: 16, color: PARCHMENT,
    backgroundColor: 'rgba(5,8,14,0.85)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)',
  },
  codeInput: { fontFamily: DISPLAY, fontSize: 28, letterSpacing: 8, textAlign: 'center' },
  chips: { flexDirection: 'row', gap: 8 },
  chip: {
    flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)',
  },
  chipOn: { borderColor: GOLD, backgroundColor: 'rgba(244,162,97,0.14)' },
  chipText: { fontSize: 13, color: '#A9BCD0' },
  chipTextOn: { color: GOLD, fontWeight: '700' },
  wide: { alignSelf: 'stretch' },
  off: { opacity: 0.5 },
  center: { alignItems: 'center', gap: 12, paddingTop: 12 },
  code: { fontFamily: DISPLAY, fontSize: 48, letterSpacing: 10, color: GOLD },
  shareBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 38, paddingHorizontal: 16,
    borderRadius: 19, borderWidth: 1, borderColor: 'rgba(244,162,97,0.45)',
  },
  shareText: { fontFamily: DISPLAY_MID, fontSize: 12, letterSpacing: 0.6, color: GOLD },
  count: { fontFamily: DISPLAY_MID, fontSize: 13, color: PARCHMENT, marginTop: 8 },
  names: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  name: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, overflow: 'hidden',
    backgroundColor: 'rgba(5,8,14,0.85)', color: PARCHMENT, fontSize: 13,
  },
  wait: { fontSize: 13.5, color: '#A9BCD0', textAlign: 'center', marginTop: 10 },
  play: { gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  clock: { fontFamily: DISPLAY, fontSize: 26, color: GOLD },
  track: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: GOLD },
  passage: { fontFamily: SERIF, fontSize: 16, lineHeight: 25, color: PARCHMENT },
  prompt: { fontSize: 15.5, fontWeight: '700', color: '#E0E1DD' },
  choice: {
    flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58, paddingHorizontal: 14, borderRadius: 14,
    backgroundColor: 'rgba(5,8,14,0.85)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  choicePicked: { borderColor: GOLD, backgroundColor: 'rgba(244,162,97,0.18)' },
  choiceIdle: { opacity: 0.7 },
  choiceRight: { borderColor: '#43A047', backgroundColor: 'rgba(67,160,71,0.18)' },
  mark: { fontFamily: DISPLAY, fontSize: 15, color: GOLD, width: 18 },
  choiceText: { flex: 1, fontSize: 15, color: PARCHMENT },
  bar: { width: 60, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'hidden' },
  barFill: { height: 6, backgroundColor: GOLD_DEEP },
  barCount: { width: 24, textAlign: 'right', fontSize: 12, color: MUTED },
  reference: { fontFamily: SERIF, fontSize: 13, color: '#A9BCD0' },
  result: { padding: 14, borderRadius: 14, gap: 4, alignItems: 'center' },
  resultRight: { backgroundColor: 'rgba(67,160,71,0.22)' },
  resultWrong: { backgroundColor: 'rgba(229,57,53,0.20)' },
  resultText: { fontFamily: DISPLAY, fontSize: 17, color: PARCHMENT },
  place: { fontSize: 13.5, color: '#C6CBD2', textAlign: 'center' },
  board: {
    gap: 6, padding: 14, borderRadius: 14, marginTop: 4,
    backgroundColor: 'rgba(5,8,14,0.9)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)',
  },
  boardRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 32 },
  boardTop: { minHeight: 38 },
  boardRank: { fontFamily: DISPLAY_MID, fontSize: 14, color: MUTED, width: 22 },
  boardName: { flex: 1, fontSize: 14, color: PARCHMENT },
  podiumTitle: { fontFamily: DISPLAY, fontSize: 22, color: GOLD, textAlign: 'center' },
  error: { marginTop: 14, fontSize: 13.5, color: '#FFB4A9', textAlign: 'center' },
  loading: { marginTop: 40 },
});

export default BattleScreen;
