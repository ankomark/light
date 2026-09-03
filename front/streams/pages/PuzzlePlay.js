/**
 * Word connect: a board of interlocking answers, and a wheel of letters.
 *
 * Every answer is spelled from the same letters, and every one of them is a
 * word that appears in scripture. Drag across the wheel to trace a word; let
 * go to submit it.
 *
 * The board arrives as a shape — which tiles exist and how long each answer is
 * — with no letters in it. Letters appear only for words this player has found
 * or paid a hint for, so the answers are never sitting in the payload.
 *
 * Not every word the wheel can spell is on the board. The rest are bonus
 * words: they pay a little, they never bring the level closer to finished,
 * and they are why a wrong guess is worth making.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator,
  PanResponder, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { fetchPuzzleLevel, claimPuzzleWord, buyPuzzleHint } from '../services/api';
import { useI18n } from '../context/I18nContext';
import { usePreferences } from '../context/PreferencesContext';
import { PREF_KEYS } from '../utils/preferences';
import {
  setSoundEnabled, tapFeedback, correctFeedback, wrongFeedback, finishFeedback,
  playLoop, stopLoop, unload as unloadSound,
} from '../services/quizSound';
import {
  Backdrop, Coin, Coins, quizStyles as q, DISPLAY, DISPLAY_MID, SERIF_BOLD,
  GOLD, PARCHMENT, MUTED, INK, RIGHT,
} from './quizTheme';

const WHEEL = 240;          // diameter of the letter wheel
const KNOB = 46;            // diameter of one letter
const HIT = KNOB * 0.72;    // how close a finger must be to pick a letter up

const PuzzlePlay = ({ navigation, route }) => {
  const { t } = useI18n();
  const { width } = useWindowDimensions();
  const { preferences, setPreference } = usePreferences();
  const soundOn = preferences?.[PREF_KEYS.quizSound] !== false;

  const themeSlug = route?.params?.theme;
  const [level, setLevel] = useState(route?.params?.level || 1);

  const [puzzle, setPuzzle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [traced, setTraced] = useState([]);      // indexes into the wheel
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null);
  const [shake, setShake] = useState(false);
  const [balance, setBalance] = useState(null);
  // The wheel's own order, so Shuffle can rearrange it without touching the
  // puzzle: the letters are the same, only where they sit changes.
  const [order, setOrder] = useState([]);
  // Where the finger is, in wheel coordinates — the loose end of the line.
  const [pointer, setPointer] = useState(null);

  const wheelBox = useRef({ x: 0, y: 0 });
  const tracedRef = useRef([]);

  const load = useCallback(async (lvl) => {
    try {
      setLoading(true);
      setError('');
      setTraced([]);
      const data = await fetchPuzzleLevel(themeSlug, lvl);
      setPuzzle(data);
      setOrder([...Array((data.letters || '').length).keys()]);
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || t('puzzle.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [themeSlug, t]);

  useEffect(() => { load(level); }, [load, level]);
  useEffect(() => {
    setSoundEnabled(soundOn);
    // The music follows the same switch as everything else.
    if (soundOn) playLoop(); else stopLoop();
  }, [soundOn]);
  // Leaving the screen must never leave music playing behind it.
  useEffect(() => () => { stopLoop(); unloadSound(); }, []);

  const source = (puzzle?.letters || '').split('');
  // What the wheel shows, in its current arrangement.
  const letters = order.length === source.length ? order.map((i) => source[i]) : source;
  const found = puzzle?.found || [];
  const bonus = puzzle?.bonus || [];

  const shuffle = () => {
    tapFeedback();
    setTraced([]);
    tracedRef.current = [];
    setOrder((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [next[i], next[j]] = [next[j], next[i]];
      }
      return next;
    });
  };

  /** Where each letter sits on the wheel. */
  const knobs = useMemo(() => {
    const n = letters.length;
    const radius = WHEEL / 2 - KNOB / 2 - 6;
    return letters.map((letter, i) => {
      // Start at the top and go clockwise.
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      return {
        letter,
        x: WHEEL / 2 + radius * Math.cos(angle),
        y: WHEEL / 2 + radius * Math.sin(angle),
      };
    });
  }, [puzzle?.letters, order]);

  /** Letters already revealed on the board, by cell. */
  const revealedCells = useMemo(() => {
    const map = {};
    (puzzle?.revealed || []).forEach((p) => {
      for (let i = 0; i < p.word.length; i += 1) {
        const r = p.row + (p.dir === 'down' ? i : 0);
        const c = p.col + (p.dir === 'across' ? i : 0);
        map[`${r},${c}`] = { letter: p.word[i], solid: found.includes(p.word) };
      }
    });
    return map;
  }, [puzzle?.revealed, found]);

  const word = traced.map((i) => letters[i]).join('');

  /** Everything this player has already claimed, board or bonus.
   *
   *  Re-tracing one of these is the most common repeat guess there is, and the
   *  client can settle it without asking — the only shortcut left now that a
   *  word of any length might still be a bonus word.
   */
  const claimed = useMemo(() => new Set([...found, ...bonus]), [found, bonus]);

  const reject = useCallback(() => {
    wrongFeedback();
    setShake(true);
    setTimeout(() => setShake(false), 380);
  }, []);

  const submit = useCallback(async (indexes) => {
    const attempt = indexes.map((i) => letters[i]).join('');
    // The wheel is free again the moment the finger lifts — the answer catches
    // up. Waiting for the server before clearing is what makes these games feel
    // sluggish.
    setTraced([]);
    setPointer(null);
    if (!puzzle || attempt.length < 3) return;
    if (claimed.has(attempt)) { reject(); return; }
    try {
      const res = await claimPuzzleWord(puzzle.id, attempt);
      if (res.correct && !res.already_found) {
        correctFeedback();
        setPuzzle((prev) => ({
          ...prev,
          found: res.found,
          revealed: [...(prev.revealed || []), res.placement],
          is_complete: res.is_complete,
        }));
        setBalance(res.balance);
        setFlash({ word: res.word, coins: res.coins_earned + (res.completion_bonus || 0) });
        setTimeout(() => setFlash(null), 1500);
        if (res.is_complete) finishFeedback();
      } else if (res.bonus && !res.already_found) {
        // Not on the board, but a real word all the same.
        correctFeedback();
        setPuzzle((prev) => ({ ...prev, bonus: res.bonus_found }));
        setBalance(res.balance);
        setFlash({ word: res.word, coins: res.coins_earned, bonus: true });
        setTimeout(() => setFlash(null), 1500);
      } else if (!res.correct) {
        reject();
      }
    } catch {
      reject();
    }
  }, [puzzle, letters, claimed, reject]);

  const knobAt = (pageX, pageY) => {
    const x = pageX - wheelBox.current.x;
    const y = pageY - wheelBox.current.y;
    for (let i = 0; i < knobs.length; i += 1) {
      const dx = x - knobs[i].x;
      const dy = y - knobs[i].y;
      if (Math.sqrt(dx * dx + dy * dy) <= HIT) return i;
    }
    return -1;
  };

  const extend = (index) => {
    if (index < 0) return;
    const current = tracedRef.current;
    // Dragging back over the previous letter undoes the last one — the standard
    // way out of a mistake without lifting your finger.
    if (current.length >= 2 && current[current.length - 2] === index) {
      const shorter = current.slice(0, -1);
      tracedRef.current = shorter;
      setTraced(shorter);
      return;
    }
    if (current.includes(index)) return;
    const longer = [...current, index];
    tracedRef.current = longer;
    setTraced(longer);
    tapFeedback();
  };

  const trackPointer = (e) => {
    setPointer({
      x: e.nativeEvent.pageX - wheelBox.current.x,
      y: e.nativeEvent.pageY - wheelBox.current.y,
    });
  };

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => {
      trackPointer(e);
      extend(knobAt(e.nativeEvent.pageX, e.nativeEvent.pageY));
    },
    onPanResponderMove: (e) => {
      trackPointer(e);
      extend(knobAt(e.nativeEvent.pageX, e.nativeEvent.pageY));
    },
    onPanResponderRelease: () => {
      const picked = tracedRef.current;
      tracedRef.current = [];
      submit(picked);
    },
    onPanResponderTerminate: () => {
      tracedRef.current = [];
      setTraced([]);
      setPointer(null);
    },
  }), [submit, knobs.length]);

  const hint = async () => {
    if (!puzzle || busy) return;
    try {
      setBusy(true);
      const res = await buyPuzzleHint(puzzle.id);
      setBalance(res.balance);
      setPuzzle((prev) => ({
        ...prev,
        hints_used: res.hints_used,
        revealed: [...(prev.revealed || []), res.placement],
      }));
      tapFeedback();
    } catch (e) {
      setError(e?.response?.data?.error || t('puzzle.hintFailed'));
      setTimeout(() => setError(''), 2600);
      wrongFeedback();
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <View style={q.root}>
        <Backdrop />
        <View style={q.centered}><ActivityIndicator size="large" color={GOLD} /></View>
      </View>
    );
  }

  if (!puzzle) {
    return (
      <View style={q.root}>
        <Backdrop />
        <SafeAreaView style={q.flex} edges={['top', 'bottom']}>
          <View style={q.centered}>
            <Ionicons name="grid-outline" size={42} color={MUTED} />
            <Text style={q.emptyTitle}>{t('puzzle.unavailable')}</Text>
            <Text style={q.emptyBody}>{error}</Text>
            <TouchableOpacity style={q.primaryBtn} onPress={() => load(level)} activeOpacity={0.85}>
              <Text style={q.primaryBtnText}>{t('common.retry')}</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  const tile = Math.min(38, Math.floor((width - 48) / Math.max(1, puzzle.cols)));
  const remaining = puzzle.slots.length - found.length;

  return (
    <View style={q.root}>
      <Backdrop />
      <SafeAreaView style={q.flex} edges={['top', 'bottom']}>

        <View style={q.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={q.iconBtn} hitSlop={10}>
            <Ionicons name="chevron-back" size={22} color="#7E8DA3" />
          </TouchableOpacity>
          <View style={styles.headerMid}>
            <Text style={q.headerTitle} numberOfLines={1}>{puzzle.theme?.name}</Text>
            <Text style={q.eyebrow}>
              {t('puzzle.level', { level: puzzle.level })} · {found.length}/{puzzle.slots.length}
            </Text>
          </View>
          <View style={styles.headerRight}>
            {balance != null && <Coins value={balance} size={16} textSize={13} />}
            <TouchableOpacity
              onPress={() => setPreference(PREF_KEYS.quizSound, !soundOn)}
              hitSlop={10}
              accessibilityLabel={t(soundOn ? 'quiz.soundOff' : 'quiz.soundOn')}
            >
              <Ionicons
                name={soundOn ? 'volume-medium' : 'volume-mute'}
                size={20}
                color={soundOn ? GOLD : MUTED}
              />
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.boardScroll} showsVerticalScrollIndicator={false}>
          <View style={styles.board}>
            {(puzzle.layout || []).map((row, r) => (
              <View style={styles.boardRow} key={`r${r}`}>
                {row.split('').map((mark, c) => {
                  if (mark !== '#') {
                    return <View key={`${r},${c}`} style={{ width: tile, height: tile }} />;
                  }
                  const cell = revealedCells[`${r},${c}`];
                  return (
                    <View
                      key={`${r},${c}`}
                      style={[
                        styles.tile,
                        { width: tile - 3, height: tile - 3, margin: 1.5 },
                        cell?.solid && styles.tileFound,
                        cell && !cell.solid && styles.tileHinted,
                      ]}
                    >
                      {!!cell && (
                        <Text style={[styles.tileText, { fontSize: tile * 0.46 }]}>
                          {cell.letter}
                        </Text>
                      )}
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
          {!!puzzle.verse && (
            <View style={styles.verseCard}>
              <Text style={q.eyebrow}>{t('puzzle.verseTitle')}</Text>
              <Text style={styles.verseText}>{puzzle.verse.text}</Text>
              <Text style={styles.verseRef}>{puzzle.verse.reference}</Text>
            </View>
          )}

          {!!error && <Text style={styles.error}>{error}</Text>}
        </ScrollView>

        {/* What is being traced */}
        <View style={styles.tracedRow}>
          {word ? (
            <View style={[styles.tracedPill, shake && styles.tracedWrong]}>
              <Text style={styles.tracedText}>{word}</Text>
            </View>
          ) : (
            <Text style={q.eyebrow}>
              {puzzle.is_complete ? t('puzzle.solved') : t('puzzle.trace')}
            </Text>
          )}

          {!!puzzle.bonus_total && (
            <View style={styles.bonusChip}>
              <Ionicons name="sparkles-outline" size={12} color={GOLD} />
              <Text style={styles.bonusChipText}>
                {t('puzzle.bonusCount', { found: bonus.length, total: puzzle.bonus_total })}
              </Text>
            </View>
          )}
        </View>

        {/* The wheel */}
        <View style={styles.wheelWrap}>
          <View
            style={styles.wheel}
            ref={(node) => {
              if (node) node.measureInWindow((x, y) => { wheelBox.current = { x, y }; });
            }}
            {...responder.panHandlers}
          >
            {/* The line that follows the finger: a segment between each pair
                of chosen letters, and a loose one out to the fingertip. */}
            {traced.map((knobIndex, n) => {
              const from = knobs[knobIndex];
              const to = n + 1 < traced.length
                ? knobs[traced[n + 1]]
                : (pointer && n === traced.length - 1 ? pointer : null);
              if (!from || !to) return null;
              const dx = to.x - from.x;
              const dy = to.y - from.y;
              const length = Math.sqrt(dx * dx + dy * dy);
              if (length < 1) return null;
              const loose = n === traced.length - 1 && to === pointer;
              return (
                <View
                  key={`link-${n}`}
                  pointerEvents="none"
                  style={[
                    styles.link,
                    loose && styles.linkLoose,
                    {
                      width: length,
                      left: (from.x + to.x) / 2 - length / 2,
                      top: (from.y + to.y) / 2 - LINK / 2,
                      transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
                    },
                  ]}
                />
              );
            })}

            {knobs.map((knob, i) => {
              const on = traced.includes(i);
              return (
                <View
                  key={`${knob.letter}-${i}`}
                  style={[
                    styles.knob,
                    { left: knob.x - KNOB / 2, top: knob.y - KNOB / 2 },
                    on && styles.knobOn,
                  ]}
                  pointerEvents="none"
                >
                  <Text style={[styles.knobText, on && styles.knobTextOn]}>{knob.letter}</Text>
                </View>
              );
            })}
          </View>
        </View>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.hintBtn, (busy || remaining === 0) && q.disabled]}
            onPress={hint}
            disabled={busy || remaining === 0}
            activeOpacity={0.85}
          >
            <Ionicons name="bulb" size={16} color={GOLD} />
            <Text style={styles.hintText}>{t('puzzle.hint')}</Text>
            <Coin size={14} />
            <Text style={styles.hintCostText}>15</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.shuffleBtn}
            onPress={shuffle}
            activeOpacity={0.85}
            accessibilityLabel={t('puzzle.shuffle')}
          >
            <Ionicons name="shuffle" size={20} color={PARCHMENT} />
          </TouchableOpacity>

          {puzzle.is_complete && (
            <TouchableOpacity
              style={[q.primaryBtn, styles.grow]}
              onPress={() => setLevel((l) => l + 1)}
              activeOpacity={0.85}
            >
              <Text style={q.primaryBtnText}>{t('puzzle.nextLevel')}</Text>
              <Ionicons name="arrow-forward" size={16} color={INK} />
            </TouchableOpacity>
          )}
        </View>

        {!!flash && (
          <View style={[styles.flash, flash.bonus && styles.flashBonus]} pointerEvents="none">
            {!!flash.bonus && <Text style={styles.flashBonusTag}>{t('puzzle.bonus')}</Text>}
            <Text style={styles.flashWord}>{flash.word}</Text>
            <Coins value={`+${flash.coins}`} size={18} textSize={16} />
          </View>
        )}
      </SafeAreaView>
    </View>
  );
};

const LINK = 7;   // thickness of the connecting line

const styles = StyleSheet.create({
  headerMid: { flex: 1, alignItems: 'center' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingRight: 10 },
  // Drawn behind the letters so a link runs under the knobs, not over them.
  link: {
    position: 'absolute', height: LINK, borderRadius: LINK / 2,
    backgroundColor: GOLD,
  },
  linkLoose: { opacity: 0.55 },
  shuffleBtn: {
    width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)',
  },
  bonusChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6,
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: 11,
    backgroundColor: 'rgba(244,162,97,0.12)',
  },
  bonusChipText: {
    fontFamily: DISPLAY_MID, fontSize: 10, letterSpacing: 0.8, color: GOLD,
  },
  flashBonus: { borderColor: 'rgba(244,162,97,0.5)' },
  flashBonusTag: {
    fontFamily: DISPLAY_MID, fontSize: 9, letterSpacing: 1.6,
    textTransform: 'uppercase', color: GOLD, marginBottom: 2,
  },
  // The level's own verse, revealed once the board is finished.
  verseCard: {
    marginTop: 18, marginHorizontal: 4, padding: 18, borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.32)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,162,97,0.28)',
    alignItems: 'center', gap: 8,
  },
  verseText: {
    fontFamily: SERIF_BOLD, fontSize: 16, lineHeight: 26, color: PARCHMENT,
    textAlign: 'center',
  },
  verseRef: {
    fontFamily: DISPLAY_MID, fontSize: 11, letterSpacing: 1, color: GOLD,
  },
  grow: { flex: 1 },

  boardScroll: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8, alignItems: 'center' },
  board: { alignItems: 'center' },
  boardRow: { flexDirection: 'row' },
  tile: {
    borderRadius: 6, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)',
  },
  tileFound: { backgroundColor: GOLD, borderColor: GOLD },
  // A hint shows the word without crediting it — you still have to trace it.
  tileHinted: { backgroundColor: 'rgba(244,162,97,0.22)', borderColor: 'rgba(244,162,97,0.5)' },
  tileText: { fontFamily: DISPLAY, color: INK },

  error: { marginTop: 12, fontSize: 12.5, color: '#FF8A86', textAlign: 'center' },

  tracedRow: { height: 44, alignItems: 'center', justifyContent: 'center' },
  tracedPill: {
    paddingHorizontal: 18, height: 40, justifyContent: 'center', borderRadius: 20,
    backgroundColor: 'rgba(244,162,97,0.18)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: GOLD,
  },
  tracedWrong: {
    backgroundColor: 'rgba(229,57,53,0.20)', borderColor: '#E53935',
  },
  tracedText: { fontFamily: DISPLAY, fontSize: 20, letterSpacing: 3, color: PARCHMENT },

  wheelWrap: { alignItems: 'center', paddingVertical: 6 },
  wheel: {
    width: WHEEL, height: WHEEL, borderRadius: WHEEL / 2,
    backgroundColor: '#05080E',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,162,97,0.30)',
  },
  knob: {
    position: 'absolute', width: KNOB, height: KNOB, borderRadius: KNOB / 2,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)',
  },
  knobOn: { backgroundColor: GOLD, borderColor: GOLD },
  knobText: { fontFamily: DISPLAY, fontSize: 20, color: PARCHMENT },
  knobTextOn: { color: INK },

  footer: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
  },
  hintBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 50,
    paddingHorizontal: 16, borderRadius: 25,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,162,97,0.42)',
  },
  hintText: {
    fontFamily: DISPLAY_MID, fontSize: 12, letterSpacing: 1,
    color: GOLD, textTransform: 'uppercase',
  },
  hintCostText: { fontFamily: DISPLAY, fontSize: 13, color: GOLD },

  flash: {
    position: 'absolute', top: '38%', alignSelf: 'center', alignItems: 'center',
    paddingHorizontal: 22, paddingVertical: 14, borderRadius: 16,
    backgroundColor: 'rgba(5,8,14,0.94)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,162,97,0.45)',
  },
  flashWord: {
    fontFamily: SERIF_BOLD, fontSize: 18, color: PARCHMENT, marginBottom: 6, letterSpacing: 0.5,
  },
});

export default PuzzlePlay;
