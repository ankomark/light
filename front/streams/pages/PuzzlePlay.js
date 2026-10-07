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
  PanResponder, useWindowDimensions, Animated, Easing, AccessibilityInfo, Pressable, Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  fetchPuzzleLevel, fetchNextPuzzle, fetchDailyPuzzle, fetchPuzzle, fetchPuzzleVersus,
  claimPuzzleWord, buyPuzzleHint, buyPuzzleLetter, fetchCoinWallet,
} from '../services/api';
import PuzzleBoardSheet from '../components/PuzzleBoardSheet';
import { quizLanguage } from '../utils/quizCache';
import { dailyKey } from './PuzzleThemes';
import { useI18n } from '../context/I18nContext';
import { useAuth } from '../context/useAuth';
import { peekCache, writeCache, userKey } from '../utils/screenCache';
import { applyFind, starsFor } from '../utils/puzzleKeys';
import { BIBLE_BOOKS } from '../utils/bibleVersions';
import ShareCardSheet from '../components/ShareCardSheet';
import PuzzleShareCard, { puzzleMessage, starText } from '../components/PuzzleShareCard';
import PuzzleWordsSheet from '../components/PuzzleWordsSheet';
import { usePreferences } from '../context/PreferencesContext';
import { PREF_KEYS } from '../utils/preferences';
import {
  setSoundEnabled, setMusicEnabled, tapFeedback, correctFeedback, wrongFeedback, finishFeedback,
  bonusFeedback, tickFeedback, playLoop, stopLoop, unload as unloadSound,
} from '../services/quizSound';
import {
  Coin, Coins, quizStyles as q, mmss, DISPLAY, DISPLAY_MID, SERIF_BOLD,
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

/** Which pick a prefetched board answers: the server's next ('next'), or a
 *  theme's level. A daily or a friend's board is never prefetched. */
const nextKey = (choice) => (!choice ? 'next'
  : choice.theme ? `${choice.theme}:${choice.level}` : null);

/** A theme's level — or, when the server says it is not open yet (the one
 *  before it never finished there), the level it says is next. */
const fetchLevelOrNext = async (theme, level, lang) => {
  try {
    return await fetchPuzzleLevel(theme, level, lang);
  } catch (e) {
    const data = e?.response?.data || e?.data || {};
    if (data.code === 'locked' && data.next_level && data.next_level !== level) {
      return fetchPuzzleLevel(theme, data.next_level, lang);
    }
    throw e;
  }
};

const PuzzlePlay = ({ navigation, route }) => {
  const { t, resolvedLanguage } = useI18n();
  const { currentUser } = useAuth();
  // The puzzle in the app's language: Swahili from the Swahili Bible, when
  // the server has it; English otherwise.
  const lang = quizLanguage(resolvedLanguage);
  // The level in hand, kept on the phone: opening the game shows it at once
  // and the server's copy replaces it a moment later.
  const levelKey = userKey(currentUser?.id, lang === 'en' ? 'puzzle:current' : `puzzle:current:${lang}`);
  const { width, height } = useWindowDimensions();
  const { preferences, setPreference } = usePreferences();
  const soundOn = preferences?.[PREF_KEYS.quizSound] !== false;
  const musicOn = preferences?.[PREF_KEYS.quizMusic] !== false;

  // Params are honoured when something deep-links a specific level, but the
  // ordinary way in is with none: the server decides what comes next.
  // `daily` is today's Daily Puzzle; `theme` + `level` a level off the map.
  const asked = route?.params || {};
  // `puzzleId` is one board by its id: a friend's challenge link (`from`
  // is who sent it), or the one you sent, opened from the news that they
  // played it (`versus`).
  const pickFrom = (params) => (params.daily ? { daily: true }
    : params.puzzleId ? {
      id: Number(params.puzzleId), from: params.from, versus: params.versus || params.from,
    }
      : params.theme ? { theme: params.theme, level: Number(params.level) || 1 } : null);
  const [pick, setPick] = useState(() => pickFrom(asked));
  const pickRef = useRef(pick);
  pickRef.current = pick;

  // Where a board is kept on the phone: the level in hand, or today's daily
  // one. A level picked off the map is not kept — the map has it.
  const keyFor = useCallback((choice) => (choice?.daily ? dailyKey(currentUser?.id, lang)
    : choice ? null : levelKey), [currentUser?.id, lang, levelKey]);

  const kept = keyFor(pick) ? peekCache(keyFor(pick)) : null;
  const [puzzle, setPuzzle] = useState(kept);
  const [loading, setLoading] = useState(!kept);
  const [error, setError] = useState('');
  const [traced, setTraced] = useState([]);      // indexes into the wheel
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null);
  const [shake, setShake] = useState(false);
  const [balance, setBalance] = useState(kept?.wallet?.balance ?? null);
  // The purse and the streak used to live on the hub. They belong here.
  const [streak, setStreak] = useState(kept?.wallet || null);
  // Finds go to the server one after another, behind the play; the next
  // level is fetched the moment this one is finished, so "Next" is instant.
  const chain = useRef(Promise.resolve());
  // { key, data }: the board "Next" will open, fetched while this one was
  // being finished. `key` says which pick it answers (see nextKey).
  const upcoming = useRef(null);
  const puzzleRef = useRef(null);
  const walletRef = useRef(streak);
  walletRef.current = streak;
  // The wheel's own order, so Shuffle can rearrange it without touching the
  // puzzle: the letters are the same, only where they sit changes.
  // Starts from the kept board, if the screen opened on one, so Shuffle works at once.
  const [order, setOrder] = useState(() => (kept ? [...Array((kept.letters || '').length).keys()] : []));
  // The loose end of the line, out to the fingertip. Moved with Animated
  // values set straight on the native view: a finger reports sixty times a
  // second, and re-rendering the whole board for each report is what made the
  // line stutter behind it.
  const loose = useRef({
    left: new Animated.Value(0), top: new Animated.Value(0),
    width: new Animated.Value(0), angle: new Animated.Value(0), opacity: new Animated.Value(0),
  }).current;
  const looseRotate = useMemo(() => loose.angle.interpolate({
    inputRange: [-Math.PI, Math.PI], outputRange: [`${-Math.PI}rad`, `${Math.PI}rad`],
  }), [loose]);
  // How tall the board's area turned out to be. Tiles are sized to fit it, so
  // a big board shrinks rather than running off the bottom of the screen.
  const [viewport, setViewport] = useState(0);
  // A blank tile tapped: the hint button offers that one letter instead.
  const [picked, setPicked] = useState(null);           // "row,col"
  // Letters tapped one at a time rather than dragged: they wait for ✓.
  const tapping = useRef(false);
  const [tapMode, setTapMode] = useState(false);
  // A screen reader cannot drag across the wheel: it gets letter buttons.
  const [reader, setReader] = useState(false);
  // The finish: tiles light up in a wave across the board.
  const celebrate = useRef(new Animated.Value(1)).current;
  const [wordsOpen, setWordsOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [toast, setToast] = useState('');
  const [boardOpen, setBoardOpen] = useState(false);
  // A challenge side by side, once the board is done: { me, them, verdict }.
  const [versus, setVersus] = useState(null);

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

  // Where the wheel sits on screen, taken at the start of every touch from
  // the touch itself (page position less position within the wheel), so it
  // is right under Android's status bar and after anything above it moves.
  const wheelBox = useRef({ x: 0, y: 0 });
  const lastPoint = useRef(null);
  const tracedRef = useRef([]);
  // Words the server has already turned down on this board. Retracing one is
  // the commonest repeat there is, and answering it here means the "no" is
  // heard the instant the finger lifts instead of a round trip later.
  const refused = useRef(new Set());

  // Finds the server never heard about (offline twice over), kept on the
  // phone and sent again the next time their board comes from the server.
  const unsentKey = userKey(currentUser?.id, 'puzzle:unsent');
  // Coins shown for finds the server has not answered yet, so a total it
  // sends meanwhile does not take them back off the screen.
  const pendingCoins = useRef(0);
  const recordRef = useRef(null);

  const shownId = useRef(kept?.id ?? null);
  const show = useCallback((data, { keep = true } = {}) => {
    // A new board gets a fresh wheel; the same board keeps its shuffle.
    if (shownId.current !== data.id) {
      shownId.current = data.id;
      setOrder([...Array((data.letters || '').length).keys()]);
    }
    let board = data;
    const resend = [];
    if (keep) {
      // The server's copy of this board, missing finds it never got: put them
      // back on it and send them again.
      const unsent = peekCache(unsentKey) || [];
      const mine = unsent.filter((u) => u.id === data.id);
      if (mine.length) {
        writeCache(unsentKey, unsent.filter((u) => u.id !== data.id));
        mine.forEach(({ word }) => {
          if ((board.found || []).includes(word) || (board.bonus || []).includes(word)) return;
          const out = applyFind(board, word);
          if (out.kind === 'slot' || out.kind === 'bonus') {
            board = out.puzzle;
            resend.push([word, out.done]);
          }
        });
      }
    }
    setPuzzle(board);
    if (board.wallet) {
      setBalance(board.wallet.balance);
      setStreak(board.wallet);
    }
    resend.forEach(([word, done]) => recordRef.current?.(word, done, 0, board.id));
    const key = keyFor(pickRef.current);
    // Only the board this slot is for: the daily one in the daily slot.
    const fits = !!pickRef.current?.daily === !!board.day;
    // The daily board is kept finished too: the themes screen shows its time.
    if (keep && key && fits && (!board.is_complete || pickRef.current?.daily)) writeCache(key, board);
  }, [keyFor, unsentKey]);

  const load = useCallback(async (choice) => {
    setError('');
    setTraced([]);
    tracedRef.current = [];
    tapping.current = false;
    setTapMode(false);
    setPicked(null);
    // A word refused on one board may well be an answer on the next.
    refused.current = new Set();
    // The next level, fetched while this one was being finished: no wait.
    if (upcoming.current && upcoming.current.key === nextKey(choice)) {
      show(upcoming.current.data);
      upcoming.current = null;
      setLoading(false);
      return;
    }
    const key = keyFor(choice);
    const current = key && peekCache(key);
    if (current) show(current, { keep: false }); else setLoading(true);
    try {
      // A level off the map opens only once the one before it is finished on
      // the server: let finds still on their way land first.
      if (choice?.theme) await chain.current.catch(() => {});
      const data = choice?.daily ? await fetchDailyPuzzle(lang)
        : choice?.id ? await fetchPuzzle(choice.id, { from: choice.from })
          : choice ? await fetchLevelOrNext(choice.theme, choice.level, lang)
            : await fetchNextPuzzle(lang);
      show(data);
    } catch {
      if (!current) setError(t('puzzle.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t, show, keyFor, lang]);

  // `round` is what makes "next" work when there is no pick to change:
  // bumping it re-runs the effect, so exactly one request goes out either way.
  const [round, setRound] = useState(0);
  useEffect(() => { load(pick); }, [load, pick, round]);

  // A challenge, finished: how it compares. Asked again when the other side
  // may since have finished too.
  const versusWith = pick?.versus;
  const doneId = puzzle?.is_complete ? puzzle.id : null;
  useEffect(() => {
    setVersus(null);
    if (!versusWith || !doneId) return undefined;
    let live = true;
    // Behind the finds still on their way, so our own finish is counted.
    chain.current
      .then(() => fetchPuzzleVersus(doneId, versusWith))
      .then((res) => { if (live) setVersus(res); })
      .catch(() => {});
    return () => { live = false; };
  }, [versusWith, doneId]);

  /** Send this board to a friend: a link that opens it for them, naming you. */
  const challenge = () => {
    if (!puzzle) return;
    const link = `streams://puzzle/${puzzle.id}?from=${encodeURIComponent(currentUser?.username || '')}`;
    const title = puzzle.day
      ? t('puzzle.daily.title')
      : `${puzzle.theme?.name} · ${t('puzzle.level', { level: puzzle.level })}`;
    const message = puzzle.is_complete
      ? t('puzzle.challenge.beatMe', {
        title, stars: starText(puzzle.stars || 0), time: mmss(puzzle.seconds || 0),
      })
      : t('puzzle.challenge.tryThis', { title });
    Share.share({ message: `${message}\n${link}` }).catch(() => {});
  };

  // New orders from the themes screen or the map, for the board already open.
  const firstNonce = useRef(asked.nonce);
  useEffect(() => {
    if (asked.nonce === undefined || asked.nonce === firstNonce.current) return;
    firstNonce.current = asked.nonce;
    upcoming.current = null;
    setPick(pickFrom(asked));
    setRound((n) => n + 1);
  }, [asked.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Finished — on to the next: the theme's next level for one picked off
   *  the map, otherwise whatever the server chooses. */
  const advance = () => {
    const was = pickRef.current;
    setPick(was?.theme && puzzle ? { theme: was.theme, level: puzzle.level + 1 } : null);
    setRound((n) => n + 1);
  };
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // The level brings the wallet with it; ask separately only for an
        // older server that does not.
        await new Promise((r) => setTimeout(r, 1500));
        if (!alive || walletRef.current) return;
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

  useEffect(() => {
    let live = true;
    Promise.resolve(AccessibilityInfo.isScreenReaderEnabled?.())
      .then((on) => { if (live) setReader(!!on); })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('screenReaderChanged', (on) => setReader(!!on));
    return () => { live = false; sub?.remove?.(); };
  }, []);

  const showToast = useCallback((text) => {
    setToast(text);
    setTimeout(() => setToast(''), 2200);
  }, []);

  puzzleRef.current = puzzle;
  const pickTile = useCallback((at) => {
    tapFeedback();
    setPicked((now) => (now === at ? null : at));
  }, []);
  const source = (puzzle?.letters || '').split('');
  // What the wheel shows, in its current arrangement.
  const letters = order.length === source.length ? order.map((i) => source[i]) : source;
  // Kept stable between renders so the board (memoised below) redraws only
  // when something on it changes.
  const found = useMemo(() => puzzle?.found || [], [puzzle?.found]);
  const bonus = useMemo(() => puzzle?.bonus || [], [puzzle?.bonus]);

  const shuffle = () => {
    tapFeedback();
    setTraced([]);
    tracedRef.current = [];
    tapping.current = false;
    setTapMode(false);
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
    // Single letters bought on a tile: shown, like a hint, never solid.
    (puzzle?.shown || []).forEach((s) => {
      const key = `${s.row},${s.col}`;
      if (!map[key]) map[key] = { letter: s.letter, solid: false };
    });
    return map;
  }, [puzzle?.revealed, puzzle?.shown, found]);

  /** The board in words, for a screen reader: what is found, and how many
   *  of each length are left. */
  const boardLabel = useMemo(() => {
    if (!puzzle) return '';
    const left = {};
    (puzzle.slots || []).forEach((s) => { left[s.length] = (left[s.length] || 0) + 1; });
    found.forEach((w) => { if (left[w.length]) left[w.length] -= 1; });
    const rest = Object.keys(left).map(Number).sort((a, b) => a - b)
      .filter((n) => left[n] > 0)
      .map((n) => t('puzzle.a11y.leftOf', { count: left[n], length: n }))
      .join(', ');
    return t('puzzle.a11y.board', {
      total: (puzzle.slots || []).length,
      found: found.length ? found.join(', ') : t('puzzle.a11y.none'),
      left: rest || t('puzzle.a11y.none'),
    });
  }, [puzzle, found, t]);

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

  // Tell the server about a find, in order, behind the play. Its answer
  // brings what only it can: the coin total and, when the board is done, the
  // verse — and it is what makes the find count. The next level is fetched as
  // soon as this one is recorded as finished.
  const record = useCallback((attempt, finishing, delta = 0, boardId) => {
    const id = boardId ?? puzzle?.id;
    const post = () => claimPuzzleWord(id, attempt);
    pendingCoins.current += delta;
    chain.current = chain.current
      .then(() => post().catch(() => post()))
      .then((res) => {
        pendingCoins.current -= delta;
        if (!res) return;
        if (res.balance != null) setBalance(res.balance + pendingCoins.current);
        if (res.completion_bonus) {
          setBalance((b) => (res.balance != null || b == null ? b : b + res.completion_bonus));
          setFlash({ word: t('puzzle.solved'), coins: res.completion_bonus });
          setTimeout(() => setFlash(null), 1800);
        }
        if (res.verse || res.seconds != null) {
          setPuzzle((prev) => (prev && prev.id === id ? {
            ...prev,
            ...(res.verse ? { verse: res.verse } : {}),
            ...(res.seconds != null ? { seconds: res.seconds, stars: res.stars } : {}),
          } : prev));
        }
        if (finishing || res.is_complete) {
          // What "Next" will open, fetched now so it opens at once: the
          // theme's next level for one off the map, otherwise the server's pick.
          const was = pickRef.current;
          const after = was?.theme ? { theme: was.theme, level: (puzzleRef.current?.level || 0) + 1 } : null;
          (after ? fetchLevelOrNext(after.theme, after.level, lang) : fetchNextPuzzle(lang))
            .then((next) => { upcoming.current = { key: nextKey(after), data: next }; })
            .catch(() => {});
        }
      })
      .catch(() => {
        // Offline, twice: kept, and sent again when this board is next read.
        pendingCoins.current -= delta;
        const unsent = peekCache(unsentKey) || [];
        if (!unsent.some((u) => u.id === id && u.word === attempt)) {
          writeCache(unsentKey, [...unsent, { id, word: attempt }]);
        }
      });
  }, [puzzle?.id, t, lang, unsentKey]);
  recordRef.current = record;

  // Whatever changes on the board is kept, so reopening shows it as it stood.
  useEffect(() => {
    const key = keyFor(pickRef.current);
    const fits = puzzle && !!pickRef.current?.daily === !!puzzle.day;
    if (key && fits && (!puzzle.is_complete || pickRef.current?.daily)) writeCache(key, puzzle);
  }, [puzzle, keyFor]);

  // A tile picked for its letter that a traced word has since filled.
  useEffect(() => {
    if (picked && revealedCells[picked]) setPicked(null);
  }, [picked, revealedCells]);

  // The verse in its chapter, in the reader's own Bible, opened at the verse.
  const readInBible = () => {
    const v = puzzle?.verse;
    const bookId = v?.book_number ? BIBLE_BOOKS[v.book_number - 1]?.id : null;
    if (!bookId) return;
    navigation?.push?.('bible', { bookId, chapter: v.chapter, verse: v.verse });
  };

  // Off to the Bible or the themes: the music stops, and picks up again on
  // the way back.
  const musicRef = useRef(musicOn);
  musicRef.current = musicOn;
  useEffect(() => {
    const onFocus = navigation?.addListener?.('focus', () => { if (musicRef.current) playLoop(); });
    const onBlur = navigation?.addListener?.('blur', () => stopLoop());
    return () => { onFocus?.(); onBlur?.(); };
  }, [navigation]);

  const reject = useCallback(() => {
    wrongFeedback();
    setShake(true);
    setTimeout(() => setShake(false), 380);
  }, []);

  /** The board is done: a wave of light across it, and a word for anyone
   *  who cannot see it. */
  const solvedNow = useCallback(() => {
    celebrate.setValue(0);
    Animated.timing(celebrate, {
      toValue: 1, duration: 1400, easing: Easing.out(Easing.quad), useNativeDriver: true,
    }).start();
    AccessibilityInfo.announceForAccessibility?.(t('puzzle.solved'));
  }, [celebrate, t]);

  const submit = useCallback(async (indexes) => {
    const attempt = indexes.map((i) => letters[i]).join('');
    // The wheel is free again the moment the finger lifts — the answer catches
    // up. Waiting for the server before clearing is what makes these games feel
    // sluggish.
    setTraced([]);
    if (!puzzle || attempt.length < 3) return;
    if (claimed.has(attempt) || refused.current.has(attempt)) { reject(); return; }

    // Decided here, now: each answer's fingerprint came with the board
    // (utils/puzzleKeys.js). The server hears about it behind the play and
    // still decides what it pays.
    const outcome = applyFind(puzzle, attempt);
    if (outcome.kind) {
      const perWord = streak?.coins_per_word ?? null;
      if (outcome.kind === 'slot') {
        const { done } = outcome;
        correctFeedback();
        setPuzzle(outcome.puzzle);
        if (perWord != null) addCoins(null, perWord);
        setFlash({ word: attempt, coins: perWord });
        setTimeout(() => setFlash(null), 1500);
        if (done) { finishFeedback(); solvedNow(); }
        record(attempt, done, perWord || 0);
      } else if (outcome.kind === 'bonus') {
        const perBonus = streak?.coins_per_bonus_word ?? null;
        bonusFeedback();
        setPuzzle(outcome.puzzle);
        if (perBonus != null) addCoins(null, perBonus);
        setFlash({ word: attempt, coins: perBonus, bonus: true });
        setTimeout(() => setFlash(null), 1500);
        record(attempt, false, perBonus || 0);
      } else {
        // Neither on the board nor a bonus word: nothing to ask the server.
        refused.current.add(attempt);
        reject();
      }
      return;
    }

    // An older server (no fingerprints): ask it, and let the verdict follow.
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
          ...(res.is_complete ? { stars: res.stars ?? starsFor(prev), seconds: res.seconds } : {}),
        }));
        // The server sends what was earned, not the whole purse — counting
        // the purse cost four queries a word. Add the delta to what is already
        // on screen, and take the authoritative figure when it comes.
        addCoins(res.balance, res.coins_earned + (res.completion_bonus || 0));
        setFlash({ word: res.word, coins: res.coins_earned + (res.completion_bonus || 0) });
        setTimeout(() => setFlash(null), 1500);
        if (res.is_complete) { finishFeedback(); solvedNow(); }
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
  }, [puzzle, letters, claimed, reject, addCoins, streak, record, solvedNow]);

  const knobsRef = useRef(knobs);
  knobsRef.current = knobs;
  const hitRef = useRef(hit);
  hitRef.current = hit;

  /** The knob under a point in wheel coordinates, or -1. */
  const knobAt = (x, y) => {
    const spots = knobsRef.current;
    const reach = hitRef.current * hitRef.current;
    for (let i = 0; i < spots.length; i += 1) {
      const dx = x - spots[i].x;
      const dy = y - spots[i].y;
      if (dx * dx + dy * dy <= reach) return i;
    }
    return -1;
  };

  /** The line from the last letter out to the finger. */
  const drawLoose = (x, y) => {
    const current = tracedRef.current;
    const from = knobsRef.current[current[current.length - 1]];
    if (!from || x == null) { loose.opacity.setValue(0); return; }
    const dx = x - from.x;
    const dy = y - from.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    loose.width.setValue(length);
    loose.left.setValue((from.x + x) / 2 - length / 2);
    loose.top.setValue((from.y + y) / 2 - LINK / 2);
    loose.angle.setValue(Math.atan2(dy, dx));
    loose.opacity.setValue(length < 2 ? 0 : 0.55);
  };

  /** Follow the finger from where it was to where it is. A quick swipe
   *  reports points far apart and could jump straight over a letter; the
   *  path between them is walked in small steps so none is missed. */
  const follow = (x, y) => {
    const prev = lastPoint.current || { x, y };
    const dist = Math.sqrt((x - prev.x) ** 2 + (y - prev.y) ** 2);
    const n = Math.min(24, Math.ceil(dist / Math.max(4, hitRef.current / 3)));
    for (let k = 1; k <= n; k += 1) {
      extend(knobAt(prev.x + ((x - prev.x) * k) / n, prev.y + ((y - prev.y) * k) / n));
    }
    if (!n) extend(knobAt(x, y));
    lastPoint.current = { x, y };
    drawLoose(x, y);
  };

  const localPoint = (e) => ({
    x: e.nativeEvent.pageX - wheelBox.current.x,
    y: e.nativeEvent.pageY - wheelBox.current.y,
  });

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
    gestureKnobs.current += 1;
    tapFeedback();
  };

  // Letters picked this gesture: two or more is a drag, which submits on
  // release; one is a tap, which waits for the next tap or for ✓.
  const gestureKnobs = useRef(0);

  /** Tap a letter: add it, or take it back if it was the last one tapped. */
  const tapLetter = (index) => {
    if (index < 0) return;
    const current = tracedRef.current;
    let next;
    if (current[current.length - 1] === index) next = current.slice(0, -1);
    else if (current.includes(index)) return;
    else next = [...current, index];
    tracedRef.current = next;
    setTraced(next);
    tapping.current = next.length > 0;
    setTapMode(next.length > 0);
    tapFeedback();
    if (reader) AccessibilityInfo.announceForAccessibility?.(next.map((i) => letters[i]).join(' '));
  };

  const endTapping = () => {
    tapping.current = false;
    setTapMode(false);
  };

  /** ✓ on tapped letters: send them as a word. */
  const submitTapped = () => {
    const picked = tracedRef.current;
    tracedRef.current = [];
    endTapping();
    submit(picked);
  };

  const clearTapped = () => {
    tracedRef.current = [];
    setTraced([]);
    endTapping();
  };

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => {
      gestureKnobs.current = 0;
      const { pageX, pageY, locationX, locationY } = e.nativeEvent;
      if (locationX != null && locationY != null) {
        wheelBox.current = { x: pageX - locationX, y: pageY - locationY };
      }
      const point = localPoint(e);
      lastPoint.current = point;
      const at = knobAt(point.x, point.y);
      if (tapping.current) {
        // Mid-way through tapping a word: this touch carries it on.
        const current = tracedRef.current;
        if (at >= 0 && current[current.length - 1] === at) {
          tapLetter(at);
          gestureKnobs.current = -1;     // a take-back, never a submit
          return;
        }
      } else {
        tracedRef.current = [];
      }
      extend(at);
      drawLoose(point.x, point.y);
    },
    onPanResponderMove: (e) => {
      const point = localPoint(e);
      follow(point.x, point.y);
    },
    onPanResponderRelease: () => {
      lastPoint.current = null;
      drawLoose(null);
      if (gestureKnobs.current >= 2) {
        // A drag across the letters: that is the word.
        const picked = tracedRef.current;
        tracedRef.current = [];
        endTapping();
        submit(picked);
        return;
      }
      // A tap: the letter stays lit and the word waits for more, or for ✓.
      const on = tracedRef.current.length > 0;
      tapping.current = on;
      setTapMode(on);
    },
    // A drag across the wheel is never handed to the screen's back swipe.
    onPanResponderTerminationRequest: () => false,
    onPanResponderTerminate: () => {
      tracedRef.current = [];
      setTraced([]);
      lastPoint.current = null;
      drawLoose(null);
      endTapping();
    },
  }), [submit, reader]); // eslint-disable-line react-hooks/exhaustive-deps

  /** One letter, on the tile picked: the cheap hint. */
  const buyLetter = async () => {
    if (!puzzle || busy || !picked) return;
    const [row, col] = picked.split(',').map(Number);
    try {
      setBusy(true);
      // Finds still on their way first: the server must know what is
      // already showing before it sells a letter of it.
      await chain.current.catch(() => {});
      const res = await buyPuzzleLetter(puzzle.id, row, col);
      setBalance(res.balance);
      setPuzzle((prev) => ({
        ...prev,
        shown: [...(prev.shown || []), { row: res.row, col: res.col, letter: res.letter }],
        letters_used: res.letters_used,
      }));
      tapFeedback();
    } catch (e) {
      const data = e?.response?.data || e?.data || {};
      setError(data.code === 'not_enough_coins'
        ? t('puzzle.letterNoCoins', { cost: data.cost })
        : t('puzzle.letterFailed'));
      setTimeout(() => setError(''), 2600);
      wrongFeedback();
    } finally {
      setBusy(false);
      setPicked(null);
    }
  };

  const hint = async () => {
    if (picked) { buyLetter(); return; }
    if (!puzzle || busy) return;
    try {
      setBusy(true);
      // Finds still on their way first: otherwise the server, not yet told
      // of a word just traced, could sell it back as the hint.
      await chain.current.catch(() => {});
      const res = await buyPuzzleHint(puzzle.id);
      setBalance(res.balance);
      setPuzzle((prev) => ({
        ...prev,
        hints_used: res.hints_used,
        revealed: [...(prev.revealed || []), res.placement],
      }));
      tapFeedback();
    } catch (e) {
      const data = e?.response?.data || e?.data || {};
      setError(data.cost != null ? t('puzzle.hintNoCoins', { cost: data.cost }) : t('puzzle.hintFailed'));
      setTimeout(() => setError(''), 2600);
      wrongFeedback();
    } finally {
      setBusy(false);
    }
  };

  // This screen has no app header, so the way out has to be drawn even while
  // nothing else is — a first open offline would otherwise be a dead end.
  const backOnly = (
    <TouchableOpacity
      onPress={() => navigation.goBack()}
      style={[styles.backBtn, styles.backAlone]}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={t('common.back')}
    >
      <Ionicons name="chevron-back" size={24} color={PARCHMENT} />
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <SafeAreaView style={q.rootClear} edges={['top', 'bottom']}>
        {backOnly}
        <View style={q.centered}><ActivityIndicator size="large" color={GOLD} /></View>
      </SafeAreaView>
    );
  }

  if (!puzzle) {
    return (
      <SafeAreaView style={q.rootClear} edges={['top', 'bottom']}>
        {backOnly}
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
      </SafeAreaView>
    );
  }

  // A board is as big as it can be while still fitting. It used to be sized
  // on width alone, so a tall board simply overflowed and the rows at the
  // bottom sat behind the wheel until you scrolled for them.
  const cols = Math.max(1, puzzle.cols);
  const rows = Math.max(1, puzzle.rows);
  const fitsWide = Math.floor((width - 40) / cols);
  const fitsTall = viewport ? Math.floor((viewport - 16) / rows) : TILE_MAX;
  // Never wider than the screen: the minimum gives way before a board does
  // (an older, sprawling level on a narrow phone), since a tile cut off the
  // edge cannot be read at any size.
  const tile = Math.min(fitsWide, Math.max(TILE_MIN, Math.min(TILE_MAX, fitsTall)));
  const remaining = puzzle.slots.length - found.length;
  const hintCost = streak?.hint_cost ?? 15;
  const letterCost = streak?.letter_cost ?? 5;
  const verse = puzzle.verse;
  const verseBook = verse?.book_number ? BIBLE_BOOKS[verse.book_number - 1]?.id : null;
  const shareLine = [
    starText(puzzle.stars),
    puzzle.day && puzzle.seconds != null
      ? mmss(puzzle.seconds)
      : t('puzzle.share.words', { count: puzzle.slots.length }),
  ].filter(Boolean).join('  ·  ');
  const shareTitle = puzzle.day
    ? `${t('puzzle.daily.title')} · ${puzzle.day}`
    : `${puzzle.theme?.name} · ${t('puzzle.level', { level: puzzle.level })}`;

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
            <Text style={styles.barTitle} numberOfLines={1}>
              {puzzle.day ? t('puzzle.daily.title') : puzzle.theme?.name}
            </Text>
            <Text style={q.eyebrow} accessibilityLabel={boardLabel}>
              {puzzle.day
                ? puzzle.theme?.name
                : t('puzzle.level', { level: puzzle.level })}
              {!puzzle.day && !!puzzle.band && <Text style={styles.band}> · {t(`puzzle.band.${puzzle.band}`)}</Text>}
              {' · '}{found.length}/{puzzle.slots.length}
            </Text>
          </View>
          <View style={styles.headerRight}>
            <TouchableOpacity
              onPress={() => navigation.navigate('PuzzleThemes')}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('puzzle.themes.title')}
              testID="puzzle-themes-open"
            >
              <Ionicons name="grid-outline" size={19} color={PARCHMENT} />
            </TouchableOpacity>
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
          <Board
            layout={puzzle.layout}
            revealedCells={revealedCells}
            picked={picked}
            tile={tile}
            rows={rows}
            cols={cols}
            complete={!!puzzle.is_complete}
            busy={busy}
            celebrate={celebrate}
            onPick={pickTile}
            t={t}
            letterCost={letterCost}
          />
          {/* A finished board: how it was won, the verse it came from, and
              what can be done with it. */}
          {(puzzle.is_complete || !!puzzle.verse) && (
            <View style={styles.verseCard} testID="puzzle-solved">
              {!!puzzle.stars && (
                <Text style={styles.stars} accessibilityLabel={t('puzzle.starsOf', { count: puzzle.stars })}>
                  {starText(puzzle.stars)}
                </Text>
              )}
              {puzzle.seconds != null && !!puzzle.day && (
                <Text style={styles.solvedIn}>{t('puzzle.daily.time', { time: mmss(puzzle.seconds) })}</Text>
              )}
              {!!puzzle.verse && (
                <>
                  <Text style={q.eyebrow}>{t('puzzle.verseTitle')}</Text>
                  <Text style={styles.verseText}>{puzzle.verse.text}</Text>
                  <Text style={styles.verseRef}>{puzzle.verse.reference}</Text>
                </>
              )}
              <View style={styles.verseActions}>
                {!!verseBook && (
                  <TouchableOpacity
                    style={styles.verseAction}
                    onPress={readInBible}
                    accessibilityRole="button"
                    testID="puzzle-read"
                  >
                    <Ionicons name="book-outline" size={15} color={GOLD} />
                    <Text style={styles.verseActionText}>{t('puzzle.readInBible')}</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={styles.verseAction}
                  onPress={() => setSharing(true)}
                  accessibilityRole="button"
                  testID="puzzle-share"
                >
                  <Ionicons name="share-social-outline" size={15} color={GOLD} />
                  <Text style={styles.verseActionText}>{t('puzzle.share.button')}</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.verseActions}>
                <TouchableOpacity
                  style={styles.verseAction}
                  onPress={challenge}
                  accessibilityRole="button"
                  testID="puzzle-challenge"
                >
                  <Ionicons name="flash-outline" size={15} color={GOLD} />
                  <Text style={styles.verseActionText}>{t('puzzle.challenge.button')}</Text>
                </TouchableOpacity>
                {!!puzzle.day && (
                  <TouchableOpacity
                    style={styles.verseAction}
                    onPress={() => setBoardOpen(true)}
                    accessibilityRole="button"
                    testID="puzzle-board-open"
                  >
                    <Ionicons name="podium-outline" size={15} color={GOLD} />
                    <Text style={styles.verseActionText}>{t('puzzle.board.button')}</Text>
                  </TouchableOpacity>
                )}
              </View>
              {!!versus?.them && (
                <View style={styles.versus} testID="puzzle-versus">
                  <Text style={styles.versusVerdict}>
                    {t(`puzzle.versus.${versus.verdict}`, { name: versus.them.username })}
                  </Text>
                  {[{ side: versus.me, you: true }, { side: versus.them }].map(({ side, you }) => (
                    <View key={you ? 'me' : 'them'} style={styles.versusRow}>
                      <Text style={[styles.versusName, you && styles.versusYou]} numberOfLines={1}>
                        {you ? t('puzzle.versus.you') : side.username}
                      </Text>
                      <Text style={styles.versusStars}>{side.is_complete ? starText(side.stars) : ''}</Text>
                      <Text style={styles.versusTime}>
                        {side.is_complete ? mmss(side.seconds || 0) : `${side.found}/${side.total}`}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
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
              style={[styles.tracedPill, tapMode && styles.tracedPillTap, shake && styles.tracedWrong]}
              pointerEvents={tapMode ? 'box-none' : 'none'}
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
              {/* Tapped letters wait: the tick sends them, the cross starts again. */}
              {tapMode && (
                <>
                  <TouchableOpacity onPress={submitTapped} hitSlop={8} style={styles.pillBtn}
                                    accessibilityRole="button" accessibilityLabel={t('puzzle.submitWord')}
                                    testID="tap-submit">
                    <Ionicons name="checkmark" size={18} color={GOLD} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={clearTapped} hitSlop={8} style={styles.pillBtn}
                                    accessibilityRole="button" accessibilityLabel={t('puzzle.clearWord')}
                                    testID="tap-clear">
                    <Ionicons name="close" size={18} color={MUTED} />
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}
          <View
            style={[styles.wheel, { width: wheel, height: wheel, borderRadius: wheel / 2 }]}
            {...responder.panHandlers}
            // A screen reader has the letter buttons below instead.
            accessibilityElementsHidden={reader}
            importantForAccessibility={reader ? 'no-hide-descendants' : 'auto'}
          >
            {/* The line that follows the finger: a segment between each pair
                of chosen letters, and a loose one out to the fingertip. */}
            {traced.map((knobIndex, n) => {
              const from = knobs[knobIndex];
              const to = n + 1 < traced.length ? knobs[traced[n + 1]] : null;
              if (!from || !to) return null;
              const dx = to.x - from.x;
              const dy = to.y - from.y;
              const length = Math.sqrt(dx * dx + dy * dy);
              if (length < 1) return null;
              return (
                <View
                  key={`link-${n}`}
                  pointerEvents="none"
                  style={[
                    styles.link,
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

            <Animated.View
              pointerEvents="none"
              style={[styles.link, {
                left: loose.left, top: loose.top, width: loose.width, opacity: loose.opacity,
                transform: [{ rotate: looseRotate }],
              }]}
            />

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

        {reader && (
          <View style={styles.readerRow} testID="reader-letters">
            {letters.map((l, i) => (
              <TouchableOpacity
                // eslint-disable-next-line react/no-array-index-key
                key={`${l}-${i}`}
                style={[styles.readerKey, traced.includes(i) && styles.knobOn]}
                onPress={() => tapLetter(i)}
                accessibilityRole="button"
                accessibilityState={{ selected: traced.includes(i) }}
                accessibilityLabel={t('puzzle.a11y.letter', { letter: l })}
              >
                <Text style={[styles.readerKeyText, traced.includes(i) && styles.knobTextOn]}>{l}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={styles.footer}>
          {/* The hint: a whole word, or — with a blank tile picked — just
              that tile's letter, for less. */}
          <TouchableOpacity
            style={[styles.hintBtn, picked && styles.hintBtnLetter, (busy || (remaining === 0 && !picked)) && q.disabled]}
            onPress={hint}
            disabled={busy || (remaining === 0 && !picked)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={picked
              ? t('puzzle.letterFor', { cost: letterCost })
              : t('puzzle.hintFor', { cost: hintCost })}
            testID="puzzle-hint"
          >
            <Ionicons name={picked ? 'text' : 'bulb'} size={16} color={GOLD} />
            {/* On a narrow screen the word gives way once the next-level
                button joins the row — the bulb and the price still say what
                the button is, and three controls will not fit otherwise. */}
            {!(compact && puzzle.is_complete) && (
              <Text style={styles.hintText} numberOfLines={1}>
                {t(picked ? 'puzzle.letter' : 'puzzle.hint')}
              </Text>
            )}
            <Coin size={14} />
            <Text style={styles.hintCostText}>{picked ? letterCost : hintCost}</Text>
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

          <View style={styles.footerEnd}>
            <TouchableOpacity
              style={styles.roundBtn}
              onPress={() => setWordsOpen(true)}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={t('puzzle.words.title')}
              testID="puzzle-words-open"
            >
              <Ionicons name="list" size={19} color={PARCHMENT} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.roundBtn}
              onPress={shuffle}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={t('puzzle.shuffle')}
            >
              <Ionicons name="shuffle" size={20} color={PARCHMENT} />
            </TouchableOpacity>
          </View>
        </View>

        {!!flash && (
          <View style={[styles.flash, flash.bonus && styles.flashBonus]} pointerEvents="none">
            {!!flash.bonus && <Text style={styles.flashBonusTag}>{t('puzzle.bonus')}</Text>}
            <Text style={styles.flashWord}>{flash.word}</Text>
            {flash.coins != null && <Coins value={`+${flash.coins}`} size={24} textSize={20} />}
          </View>
        )}
        {!!toast && (
          <View style={styles.toast} pointerEvents="none">
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        )}
      </SafeAreaView>

      <PuzzleBoardSheet visible={boardOpen} onClose={() => setBoardOpen(false)} />
      <PuzzleWordsSheet
        visible={wordsOpen}
        onClose={() => setWordsOpen(false)}
        puzzle={puzzle}
      />
      <ShareCardSheet
        visible={sharing}
        onClose={() => setSharing(false)}
        title={t('puzzle.share.title')}
        message={puzzleMessage({ title: shareTitle, line: shareLine, verse })}
        onToast={showToast}
        renderCard={(ref, w) => (
          <PuzzleShareCard
            ref={ref}
            width={w}
            title={t('puzzle.share.cardTitle')}
            subtitle={shareTitle}
            layout={puzzle.layout}
            verse={verse}
            line={shareLine}
          />
        )}
      />
    </View>
  );
};

/** The board: tiles and the letters earned on them. Its own component, kept
 *  apart from the wheel, so tracing a letter does not redraw every tile —
 *  a word's worth of letters used to repaint the whole grid each time. */
const Board = React.memo(({
  layout, revealedCells, picked, tile, rows, cols, complete, busy, celebrate, onPick, t, letterCost,
}) => (
  <View style={styles.board}>
    {(layout || []).map((row, r) => (
      <View style={styles.boardRow} key={`r${r}`}>
        {row.split('').map((mark, c) => {
          if (mark !== '#') {
            return <View key={`${r},${c}`} style={{ width: tile, height: tile }} />;
          }
          const at = `${r},${c}`;
          const cell = revealedCells[at];
          const isPicked = picked === at;
          // The finish: a wave from the top left, each tile in turn.
          const wave = ((r + c) / (rows + cols)) * 0.6;
          const lit = cell?.solid ? {
            transform: [{
              scale: celebrate.interpolate({
                inputRange: [0, wave, wave + 0.2, wave + 0.4, 1],
                outputRange: [1, 1, 1.22, 1, 1],
                extrapolate: 'clamp',
              }),
            }],
          } : null;
          const face = (
            <Animated.View
              style={[
                styles.tile,
                { width: tile - 3, height: tile - 3, margin: 1.5 },
                cell?.solid && styles.tileFound,
                cell && !cell.solid && styles.tileHinted,
                isPicked && styles.tilePicked,
                lit,
              ]}
            >
              {!!cell && (
                <Text style={[styles.tileText, { fontSize: tile * 0.46 }]}>
                  {cell.letter}
                </Text>
              )}
              {isPicked && busy && <ActivityIndicator size="small" color={INK} />}
            </Animated.View>
          );
          // A blank tile can be tapped for its letter.
          if (cell || complete) return <React.Fragment key={at}>{face}</React.Fragment>;
          return (
            <Pressable
              key={at}
              onPress={() => onPick(at)}
              accessibilityRole="button"
              accessibilityState={{ selected: isPicked }}
              accessibilityLabel={t('puzzle.a11y.tile', { row: r + 1, col: c + 1 })}
              accessibilityHint={t('puzzle.a11y.tileHint', { cost: letterCost })}
              testID={`tile-${at}`}
            >
              {face}
            </Pressable>
          );
        })}
      </View>
    ))}
  </View>
));
Board.displayName = 'PuzzleBoard';

const LINK = 7;   // thickness of the connecting line

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 2, paddingBottom: 4,
  },
  backBtn: { paddingRight: 10, paddingVertical: 4 },
  backAlone: { alignSelf: 'flex-start', paddingHorizontal: 16, paddingVertical: 8 },
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
  stars: { fontSize: 22, letterSpacing: 4, color: GOLD },
  versus: {
    alignSelf: 'stretch', marginTop: 8, padding: 12, borderRadius: 12, gap: 6,
    backgroundColor: 'rgba(244,162,97,0.08)',
  },
  versusVerdict: { fontFamily: DISPLAY, fontSize: 14, color: GOLD, textAlign: 'center', marginBottom: 2 },
  versusRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  versusName: { flex: 1, fontSize: 14, color: PARCHMENT },
  versusYou: { fontWeight: '700' },
  versusStars: { fontSize: 12, color: GOLD },
  versusTime: { width: 52, textAlign: 'right', fontFamily: DISPLAY_MID, fontSize: 13, color: PARCHMENT },
  solvedIn: { fontFamily: DISPLAY_MID, fontSize: 12, letterSpacing: 1, color: PARCHMENT },
  roundBtn: {
    width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)',
  },
  // Far right, with or without the next-level button beside it to push it there.
  footerEnd: { flexDirection: 'row', gap: 8, marginLeft: 'auto' },
  hintBtnLetter: { backgroundColor: 'rgba(244,162,97,0.14)', borderColor: GOLD },
  tilePicked: { borderColor: GOLD, borderWidth: 2.5, backgroundColor: 'rgba(250,226,195,0.98)' },
  verseActions: { flexDirection: 'row', gap: 10, marginTop: 6 },
  verseAction: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,162,97,0.5)',
  },
  verseActionText: { fontFamily: DISPLAY_MID, fontSize: 11, letterSpacing: 0.8, color: GOLD },
  tracedPillTap: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingRight: 8 },
  pillBtn: { paddingHorizontal: 2 },
  readerRow: {
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6,
    paddingHorizontal: 12, paddingBottom: 4,
  },
  readerKey: {
    minWidth: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.2)',
  },
  readerKeyText: { fontFamily: DISPLAY, fontSize: 17, color: PARCHMENT },
  toast: {
    position: 'absolute', bottom: 90, alignSelf: 'center',
    paddingHorizontal: 16, paddingVertical: 9, borderRadius: 18,
    backgroundColor: 'rgba(5,8,14,0.94)',
  },
  toastText: { fontSize: 13, color: PARCHMENT },
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
