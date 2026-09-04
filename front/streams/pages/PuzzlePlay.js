/**
 * Word connect: a board of interlocking answers, and a wheel of letters.
 *
 * This is the whole game — there is no hub in front of it. The level, how much
 * of it is done, the coin balance and the streak all sit on the same page as
 * the board they belong to; a screen you have to get past before playing is a
 * screen that should not exist.
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
import {
  fetchPuzzleLevel, fetchNextPuzzle, claimPuzzleWord, buyPuzzleHint, fetchCoinWallet,
} from '../services/api';
import { useI18n } from '../context/I18nContext';
import { usePreferences } from '../context/PreferencesContext';
import { PREF_KEYS } from '../utils/preferences';
import {
  setSoundEnabled, setMusicEnabled, tapFeedback, correctFeedback, wrongFeedback, finishFeedback,
  bonusFeedback, tickFeedback, playLoop, stopLoop, unload as unloadSound,
} from '../services/quizSound';
import {
  Coin, Coins, quizStyles as q, DISPLAY, DISPLAY_MID, SERIF_BOLD,
  GOLD, PARCHMENT, MUTED, INK, RIGHT,
} from './quizTheme';

// The wheel is the thing a finger actually works on, so it takes its size
// from the screen rather than a fixed number: generous on a large phone,
// still leaving room for the board on a small one. The board fits itself to
// whatever height is left, so this is the one dimension worth being greedy
// with.
const WHEEL_SHARE = 0.72;   // of the screen's width
const WHEEL_HEIGHT_SHARE = 0.32;  // ...but never this much of its height
const WHEEL_MIN = 180;
const WHEEL_MAX = 320;
const KNOB_SHARE = 0.20;    // of the wheel — eight of these still fit its rim

const TILE_MAX = 38;        // a tile is never bigger than this
const TILE_MIN = 15;        // nor smaller — below this a letter stops reading

const PuzzlePlay = ({ navigation, route }) => {
  const { t } = useI18n();
  const { width, height } = useWindowDimensions();
  const { preferences, setPreference } = usePreferences();
  const soundOn = preferences?.[PREF_KEYS.quizSound] !== false;
  const musicOn = preferences?.[PREF_KEYS.quizMusic] !== false;

  // Params are honoured when something deep-links a specific level, but the
  // ordinary way in is with none: the server decides what comes next.
  const asked = route?.params || {};
  const [pick, setPick] = useState(
    asked.theme ? { theme: asked.theme, level: asked.level || 1 } : null,
  );

  const [puzzle, setPuzzle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [traced, setTraced] = useState([]);      // indexes into the wheel
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null);
  const [shake, setShake] = useState(false);
  const [balance, setBalance] = useState(null);
  // The purse and the streak used to live on the hub. They belong here.
  const [streak, setStreak] = useState(null);
  // The wheel's own order, so Shuffle can rearrange it without touching the
  // puzzle: the letters are the same, only where they sit changes.
  const [order, setOrder] = useState([]);
  // Where the finger is, in wheel coordinates — the loose end of the line.
  const [pointer, setPointer] = useState(null);
  // How tall the board's area turned out to be. Tiles are sized to fit it, so
  // a big board shrinks rather than running off the bottom of the screen.
  const [viewport, setViewport] = useState(0);

  // Narrow enough that labels have to give way, matching the threshold the
  // group screens use so "small phone" means one thing across the app.
  const compact = width < 380;

  // Wheel geometry, recomputed if the screen turns.
  const { wheel, knob, hit } = useMemo(() => {
    // Width alone was not enough: a short screen (an SE is 568pt tall) got a
    // wheel sized for its width and left the board 112pt to live in. The
    // wheel is bounded by both dimensions, so the two share the screen
    // sensibly whatever its shape.
    const size = Math.round(Math.min(
      WHEEL_MAX,
      Math.max(WHEEL_MIN, Math.min(width * WHEEL_SHARE, height * WHEEL_HEIGHT_SHARE)),
    ));
    const k = Math.round(size * KNOB_SHARE);
    return { wheel: size, knob: k, hit: k * 0.72 };
  }, [width, height]);

  const wheelBox = useRef({ x: 0, y: 0 });
  const tracedRef = useRef([]);
  // Words the server has already turned down on this board. Retracing one is
  // the commonest repeat there is, and answering it here means the "no" is
  // heard the instant the finger lifts instead of a round trip later.
  const refused = useRef(new Set());

  const load = useCallback(async (choice) => {
    try {
      setLoading(true);
      setError('');
      setTraced([]);
      // A word refused on one board may well be an answer on the next.
      refused.current = new Set();
      const data = choice
        ? await fetchPuzzleLevel(choice.theme, choice.level)
        : await fetchNextPuzzle();
      setPuzzle(data);
      setOrder([...Array((data.letters || '').length).keys()]);
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || t('puzzle.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  // `round` is what makes "next" work when there is no pick to change:
  // bumping it re-runs the effect, so exactly one request goes out either way.
  const [round, setRound] = useState(0);
  useEffect(() => { load(pick); }, [load, pick, round]);

  /** Finished — ask for whatever comes next, theme included. */
  const advance = () => {
    setPick(null);
    setRound((n) => n + 1);
  };
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const w = await fetchCoinWallet();
        if (!alive) return;
        setBalance(w.balance);
        setStreak(w);
      } catch {
        // A balance that will not load is not worth blocking the game for.
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    setSoundEnabled(soundOn);
  }, [soundOn]);

  // The music is muted on its own — the button in the header is a music
  // button, and silencing it never silences the answers.
  useEffect(() => {
    setMusicEnabled(musicOn);
    if (musicOn) playLoop(); else stopLoop();
  }, [musicOn]);
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
    const radius = wheel / 2 - knob / 2 - 6;
    return letters.map((letter, i) => {
      // Start at the top and go clockwise.
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      return {
        letter,
        x: wheel / 2 + radius * Math.cos(angle),
        y: wheel / 2 + radius * Math.sin(angle),
      };
    });
  }, [puzzle?.letters, order, wheel, knob]);

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


  /** Move the coin count on: the server's figure when it sends one, the
   *  delta otherwise. */
  const addCoins = useCallback((authoritative, delta) => {
    if (authoritative != null) { setBalance(authoritative); return; }
    setBalance((b) => (b == null ? b : b + (delta || 0)));
  }, []);

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
    if (claimed.has(attempt) || refused.current.has(attempt)) { reject(); return; }

    // Everything above was decided here and answered instantly. This one has to
    // be asked, so acknowledge the trace now and let the verdict follow — a
    // silent gap between letting go and hearing anything is what makes a guess
    // feel like it went nowhere.
    tickFeedback();

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
        // The server sends what was earned, not the whole purse — counting
        // the purse cost four queries a word. Add the delta to what is already
        // on screen, and take the authoritative figure when it comes.
        addCoins(res.balance, res.coins_earned + (res.completion_bonus || 0));
        setFlash({ word: res.word, coins: res.coins_earned + (res.completion_bonus || 0) });
        setTimeout(() => setFlash(null), 1500);
        if (res.is_complete) finishFeedback();
      } else if (res.bonus && !res.already_found) {
        // Not on the board, but a real word all the same — and it sounds
        // different, so the two kinds of find are never confused.
        bonusFeedback();
        setPuzzle((prev) => ({ ...prev, bonus: res.bonus_found }));
        addCoins(res.balance, res.coins_earned);
        setFlash({ word: res.word, coins: res.coins_earned, bonus: true });
        setTimeout(() => setFlash(null), 1500);
      } else if (!res.correct) {
        refused.current.add(attempt);
        reject();
      }
    } catch {
      // A failed request is not the player's mistake; do not remember it as a
      // refusal, or a moment offline would poison the word for the whole level.
      reject();
    }
  }, [puzzle, letters, claimed, reject, addCoins]);

  const knobAt = (pageX, pageY) => {
    const x = pageX - wheelBox.current.x;
    const y = pageY - wheelBox.current.y;
    for (let i = 0; i < knobs.length; i += 1) {
      const dx = x - knobs[i].x;
      const dy = y - knobs[i].y;
      if (Math.sqrt(dx * dx + dy * dy) <= hit) return i;
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
      <View style={q.rootClear}>
        <View style={q.centered}><ActivityIndicator size="large" color={GOLD} /></View>
      </View>
    );
  }

  if (!puzzle) {
    return (
      <View style={q.rootClear}>
        <View style={q.flex}>
          <View style={q.centered}>
            <Ionicons name="grid-outline" size={42} color={MUTED} />
            <Text style={q.emptyTitle}>{t('puzzle.unavailable')}</Text>
            <Text style={q.emptyBody}>{error}</Text>
            <TouchableOpacity style={q.primaryBtn} onPress={() => load(pick)} activeOpacity={0.85}>
              <Text style={q.primaryBtnText}>{t('common.retry')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  // A board is as big as it can be while still fitting. It used to be sized
  // on width alone, so a tall board simply overflowed and the rows at the
  // bottom sat behind the wheel until you scrolled for them.
  const cols = Math.max(1, puzzle.cols);
  const rows = Math.max(1, puzzle.rows);
  const fitsWide = Math.floor((width - 40) / cols);
  const fitsTall = viewport ? Math.floor((viewport - 16) / rows) : TILE_MAX;
  const tile = Math.max(TILE_MIN, Math.min(TILE_MAX, fitsWide, fitsTall));
  const remaining = puzzle.slots.length - found.length;

  return (
    <View style={q.rootClear}>
      <SafeAreaView style={q.flex} edges={['top', 'bottom']}>

        {/* One line, and it says everything the hub used to: which subject,
            how far in, how much of it is done, and what is in the purse. */}
        <View style={styles.bar}>
          {/* With no app header above, this row carries the way out too. */}
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backBtn}
            hitSlop={10}
            accessibilityLabel={t('common.back')}
          >
            <Ionicons name="chevron-back" size={24} color={PARCHMENT} />
          </TouchableOpacity>
          <View style={styles.barMid}>
            <Text style={styles.barTitle} numberOfLines={1}>{puzzle.theme?.name}</Text>
            <Text style={q.eyebrow}>
              {t('puzzle.level', { level: puzzle.level })}
              {!!puzzle.band && <Text style={styles.band}> · {t(`puzzle.band.${puzzle.band}`)}</Text>}
              {' · '}{found.length}/{puzzle.slots.length}
            </Text>
          </View>
          <View style={styles.headerRight}>
            {streak?.day_streak > 0 && (
              <View
                style={styles.streak}
                accessibilityLabel={t('puzzle.dayStreak', { count: streak.day_streak })}
              >
                <Ionicons name="flame" size={17} color={streak.played_today ? GOLD : MUTED} />
                <Text style={styles.streakText}>{streak.day_streak}</Text>
              </View>
            )}
            {balance != null && <Coins value={balance} size={26} textSize={21} />}
            <TouchableOpacity
              onPress={() => setPreference(PREF_KEYS.quizMusic, !musicOn)}
              hitSlop={10}
              accessibilityLabel={t(musicOn ? 'quiz.musicOff' : 'quiz.musicOn')}
            >
              <Ionicons
                name={musicOn ? 'musical-notes' : 'musical-notes-outline'}
                size={20}
                color={musicOn ? GOLD : MUTED}
              />
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView
          style={styles.boardArea}
          contentContainerStyle={styles.boardScroll}
          showsVerticalScrollIndicator={false}
          onLayout={(e) => setViewport(e.nativeEvent.layout.height)}
        >
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

        {!!puzzle.bonus_total && (
          <View style={styles.bonusRow}>
            <View style={styles.bonusChip}>
              <Ionicons name="sparkles-outline" size={12} color={GOLD} />
              <Text style={styles.bonusChipText}>
                {t('puzzle.bonusCount', { found: bonus.length, total: puzzle.bonus_total })}
              </Text>
            </View>
          </View>
        )}

        {/* The wheel, with the traced word floating above it.

            The word used to have a row of its own between the board and the
            wheel, which cost the board 44pt whether anything was being traced
            or not — and hid the bottom row behind it. It floats in the space
            above the wheel now, where a finger on the wheel is never covering
            anything worth seeing. */}
        <View style={styles.wheelWrap}>
          {!!word && (
            <View
              style={[styles.tracedPill, shake && styles.tracedWrong]}
              pointerEvents="none"
            >
              {/* Eight letters at this tracking is wide, and a reader with a
                  large system font makes it wider. Shrink rather than spill. */}
              <Text
                style={styles.tracedText}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
              >
                {word}
              </Text>
            </View>
          )}
          <View
            style={[styles.wheel, { width: wheel, height: wheel, borderRadius: wheel / 2 }]}
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

            {!word && (
              <View style={styles.wheelHint} pointerEvents="none">
                <Text style={q.eyebrow}>
                  {puzzle.is_complete ? t('puzzle.solved') : t('puzzle.trace')}
                </Text>
              </View>
            )}

            {knobs.map((spot, i) => {
              const on = traced.includes(i);
              return (
                <View
                  key={`${spot.letter}-${i}`}
                  style={[
                    styles.knob,
                    {
                      width: knob, height: knob, borderRadius: knob / 2,
                      left: spot.x - knob / 2, top: spot.y - knob / 2,
                    },
                    on && styles.knobOn,
                  ]}
                  pointerEvents="none"
                >
                  <Text
                    style={[
                      styles.knobText,
                      { fontSize: Math.round(knob * 0.46) },
                      on && styles.knobTextOn,
                    ]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.6}
                  >
                    {spot.letter}
                  </Text>
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
            {/* On a narrow screen the word gives way once the next-level
                button joins the row — the bulb and the price still say what
                the button is, and three controls will not fit otherwise. */}
            {!(compact && puzzle.is_complete) && (
              <Text style={styles.hintText} numberOfLines={1}>{t('puzzle.hint')}</Text>
            )}
            <Coin size={14} />
            <Text style={styles.hintCostText}>15</Text>
          </TouchableOpacity>

          {puzzle.is_complete && (
            <TouchableOpacity
              style={[q.primaryBtn, styles.grow]}
              onPress={advance}
              activeOpacity={0.85}
            >
              <Text style={q.primaryBtnText} numberOfLines={1}>{t('puzzle.nextLevel')}</Text>
              <Ionicons name="arrow-forward" size={16} color={INK} />
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.shuffleBtn}
            onPress={shuffle}
            activeOpacity={0.85}
            accessibilityLabel={t('puzzle.shuffle')}
          >
            <Ionicons name="shuffle" size={20} color={PARCHMENT} />
          </TouchableOpacity>
        </View>

        {!!flash && (
          <View style={[styles.flash, flash.bonus && styles.flashBonus]} pointerEvents="none">
            {!!flash.bonus && <Text style={styles.flashBonusTag}>{t('puzzle.bonus')}</Text>}
            <Text style={styles.flashWord}>{flash.word}</Text>
            <Coins value={`+${flash.coins}`} size={24} textSize={20} />
          </View>
        )}
      </SafeAreaView>
    </View>
  );
};

const LINK = 7;   // thickness of the connecting line

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 2, paddingBottom: 4,
  },
  backBtn: { paddingRight: 10, paddingVertical: 4 },
  barMid: { flex: 1 },
  // The levels never stop, so the band is what tells you how far in you are.
  band: { color: GOLD },
  barTitle: {
    fontFamily: DISPLAY, fontSize: 15, letterSpacing: 0.5, color: PARCHMENT,
  },
  streak: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  streakText: {
    fontFamily: DISPLAY_MID, fontSize: 15, fontWeight: '700', color: PARCHMENT,
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingRight: 10 },
  // Drawn behind the letters so a link runs under the knobs, not over them.
  link: {
    position: 'absolute', height: LINK, borderRadius: LINK / 2,
    backgroundColor: GOLD,
  },
  linkLoose: { opacity: 0.55 },
  shuffleBtn: {
    width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)',
    // Far right, with or without the next-level button beside it to push it there.
    marginLeft: 'auto',
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
  grow: { flex: 1, minWidth: 0 },

  boardArea: { flex: 1 },
  boardScroll: {
    flexGrow: 1, paddingHorizontal: 16, paddingVertical: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  board: { alignItems: 'center' },
  boardRow: { flexDirection: 'row' },
  // An empty tile is azure white, not a tint of the background: the board has
  // to read as a board waiting to be filled, and a barely-there translucent
  // white just took the colour of whatever was behind it. A little
  // transparency is kept so the wallpaper still shows through.
  tile: {
    borderRadius: 6, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(233,244,253,0.90)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.85)',
  },
  tileFound: { backgroundColor: GOLD, borderColor: GOLD },
  // A hint shows the word without crediting it — you still have to trace it.
  // Pale amber: lighter than a found tile, warmer than an empty one, so all
  // three states stay distinct now that empty is bright.
  tileHinted: { backgroundColor: 'rgba(250,226,195,0.94)', borderColor: 'rgba(244,162,97,0.75)' },
  tileText: { fontFamily: DISPLAY, color: INK },

  error: { marginTop: 12, fontSize: 12.5, color: '#FF8A86', textAlign: 'center' },

  bonusRow: { alignItems: 'center' },
  tracedPill: {
    position: 'absolute', top: 0, zIndex: 5, maxWidth: '92%',
    paddingHorizontal: 14, height: 32, justifyContent: 'center', borderRadius: 16,
    backgroundColor: 'rgba(10,16,28,0.92)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: GOLD,
  },
  tracedWrong: {
    backgroundColor: 'rgba(229,57,53,0.20)', borderColor: '#E53935',
  },
  tracedText: { fontFamily: DISPLAY, fontSize: 16, letterSpacing: 2, color: PARCHMENT },

  // The top padding is the traced word's room. It is reserved whether or not a
  // word is being traced, so the floating pill can never land on a tile.
  wheelWrap: { alignItems: 'center', paddingTop: 36, paddingBottom: 4 },
  wheelHint: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
  },
  wheel: {
    backgroundColor: '#05080E',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,162,97,0.30)',
  },
  knob: {
    position: 'absolute',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)',
  },
  knobOn: { backgroundColor: GOLD, borderColor: GOLD },
  // Size comes from the knob, which comes from the screen.
  knobText: { fontFamily: DISPLAY, color: PARCHMENT },
  knobTextOn: { color: INK },

  footer: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingTop: 4, paddingBottom: 8,
  },
  hintBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 44, flexShrink: 1,
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
