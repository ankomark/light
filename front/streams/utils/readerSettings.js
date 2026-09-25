// The reader's own reading environment — theme, font, size, spacing,
// margins, listening speed — kept on the phone and the same in every book.
//
// "Author" (the default theme and font) keeps the look the writer chose for
// the book; anything else is the reader's choice over it. One shared store:
// the settings sheet and the page update together.
import { useEffect, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Font from 'expo-font';

const KEY = 'reader:settings:v1';

export const READER_THEMES = {
  author: null,                                            // the book's own look
  day: { bg: '#FAF8F3', text: '#1F1E1B', subtle: 'rgba(0,0,0,0.10)' },
  sepia: { bg: '#F1E4CB', text: '#3A2E20', subtle: 'rgba(58,46,32,0.14)' },
  night: { bg: '#0F1A2B', text: '#DCE3EC', subtle: 'rgba(255,255,255,0.12)' },
  // True black for OLED screens (saves battery), and the highest contrast.
  oled: { bg: '#000000', text: '#F5F5F5', subtle: 'rgba(255,255,255,0.16)' },
};

export const READER_FONTS = {
  author: null,
  lora: 'Lora_400Regular',
  sans: undefined,                                         // the system font
  serif: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  // Designed for low vision and dyslexia: letters that can't be mistaken.
  atkinson: 'AtkinsonHyperlegible_400Regular',
};

export const TEXT_SIZES = [15, 17, 19, 22, 25];
export const LINE_HEIGHTS = [1.45, 1.7, 2.0];              // compact, comfortable, airy
export const MARGINS = [12, 24, 40];                       // narrow, normal, wide
export const SPEECH_RATES = [0.8, 0.96, 1.2, 1.5];

export const DEFAULT_READER_SETTINGS = {
  theme: 'author', font: 'author', size: 1, lineHeight: 1, margin: 1, speechRate: 1,
};

let state = DEFAULT_READER_SETTINGS;
let loading = null;
const subs = new Set();
const publish = () => subs.forEach((fn) => fn());

const clean = (raw) => {
  const s = { ...DEFAULT_READER_SETTINGS };
  if (!raw || typeof raw !== 'object') return s;
  if (raw.theme in READER_THEMES) s.theme = raw.theme;
  if (raw.font in READER_FONTS) s.font = raw.font;
  const idx = (v, list, d) => (Number.isInteger(v) && v >= 0 && v < list.length ? v : d);
  s.size = idx(raw.size, TEXT_SIZES, s.size);
  s.lineHeight = idx(raw.lineHeight, LINE_HEIGHTS, s.lineHeight);
  s.margin = idx(raw.margin, MARGINS, s.margin);
  s.speechRate = idx(raw.speechRate, SPEECH_RATES, s.speechRate);
  return s;
};

export const loadReaderSettings = () => {
  if (!loading) {
    loading = AsyncStorage.getItem(KEY)
      .then((raw) => { state = clean(raw ? JSON.parse(raw) : null); })
      .catch(() => { state = DEFAULT_READER_SETTINGS; })
      .finally(() => { ensureFont(state.font); publish(); });
  }
  return loading;
};

// Atkinson is only loaded when a reader picks it — not at every app start.
const fontLoads = {};
export const ensureFont = (font) => {
  if (font !== 'atkinson' || fontLoads.atkinson) return fontLoads.atkinson || Promise.resolve();
  fontLoads.atkinson = Font.loadAsync({
    AtkinsonHyperlegible_400Regular: require('@expo-google-fonts/atkinson-hyperlegible/400Regular/AtkinsonHyperlegible_400Regular.ttf'),
  }).then(() => publish()).catch(() => { delete fontLoads.atkinson; });
  return fontLoads.atkinson;
};

export const setReaderSetting = (key, value) => {
  state = clean({ ...state, [key]: value });
  if (key === 'font') ensureFont(state.font);
  publish();
  AsyncStorage.setItem(KEY, JSON.stringify(state)).catch(() => {});
};

export const resetReaderSettings = () => {
  state = DEFAULT_READER_SETTINGS;
  publish();
  AsyncStorage.setItem(KEY, JSON.stringify(state)).catch(() => {});
};

const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const snapshot = () => state;

export const useReaderSettings = () => {
  useEffect(() => { loadReaderSettings(); }, []);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
};

/** The look to read in: the reader's theme and font over the author's.
 *  author = { bg, text, fontFamily, scale } (the book's writing theme). */
export const resolveReadingLook = (settings, author) => {
  const theme = READER_THEMES[settings.theme];
  const fontFamily = settings.font === 'author' ? author.fontFamily
    : settings.font === 'atkinson' && !Font.isLoaded?.('AtkinsonHyperlegible_400Regular') ? author.fontFamily
      : READER_FONTS[settings.font];
  // The author's size nudge applies to their own look only.
  const size = TEXT_SIZES[settings.size] + (settings.theme === 'author' && settings.font === 'author' ? author.scale || 0 : 0);
  return {
    bg: theme ? theme.bg : author.bg,
    text: theme ? theme.text : author.text,
    subtle: theme ? theme.subtle : null,
    fontFamily,
    size,
    lineHeight: Math.round(size * LINE_HEIGHTS[settings.lineHeight]),
    margin: MARGINS[settings.margin],
  };
};

// Test-only reset.
export const __resetReaderSettings = () => { state = DEFAULT_READER_SETTINGS; loading = null; };
