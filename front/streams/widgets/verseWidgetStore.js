// What the home-screen widget shows, and how it stays current.
//
// The app is the best source: it has already chosen the reader's Bible and
// language, so each time today's verse is shown it hands the widget exactly
// those words. Between visits the widget refreshes itself (every few hours,
// see app.json) by asking the server for today's verse and translating it the
// way the screen does — flagged `via: 'widget'`, so it is not a streak visit.
// When that fails (offline, signed out), the last words shown stay up.
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchDailyVerse } from '../services/api';
import { translateVerse } from '../utils/dailyVerseText';

const KEY = '@widget:dailyVerse:v1';
const KJV = 'eng_kjv';

export const readWidgetVerse = async () => {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed.text === 'string' ? parsed : null;
  } catch {
    return null;
  }
};

const store = (payload) => AsyncStorage.setItem(KEY, JSON.stringify(payload)).catch(() => {});

/**
 * Today's verse for the widget: the server's, in the version the app last
 * used, or what was last shown when the server can't be reached.
 */
export const refreshWidgetVerse = async () => {
  const kept = await readWidgetVerse();
  let verse;
  try {
    verse = await fetchDailyVerse(null, { via: 'widget' });
  } catch {
    return kept;
  }
  const versionId = kept?.versionId || KJV;
  // Already showing today's verse in that version: nothing to redo.
  if (kept && kept.date === verse.date && kept.book === verse.book
      && kept.chapter === verse.chapter && kept.verse === verse.verse) return kept;

  let translated = null;
  if (versionId !== KJV) translated = await translateVerse(verse, versionId).catch(() => null);
  const payload = {
    date: verse.date, book: verse.book, chapter: verse.chapter, verse: verse.verse,
    text: translated?.text || verse.text,
    reference: translated ? `${translated.reference} · ${translated.abbr}` : verse.reference,
    versionId,
    title: kept?.title,
  };
  store(payload);
  return payload;
};

/**
 * Called by the verse screen with today's verse as shown. Saves it and redraws
 * any widget on the home screen. Android only; anywhere else a no-op.
 */
export const publishWidgetVerse = async (payload) => {
  if (Platform.OS !== 'android' || !payload?.text) return;
  const kept = await readWidgetVerse();
  if (kept && kept.date === payload.date && kept.text === payload.text
      && kept.reference === payload.reference && kept.title === payload.title) return;
  await store(payload);
  try {
    const { requestWidgetUpdate } = require('react-native-android-widget');
    const { default: DailyVerseWidget, WIDGET_NAME } = require('./DailyVerseWidget');
    const React = require('react');
    await requestWidgetUpdate({
      widgetName: WIDGET_NAME,
      renderWidget: (info) => React.createElement(DailyVerseWidget, { verse: payload, height: info.height }),
    });
  } catch {
    // No widget module in this build, or no widget placed: nothing to redraw.
  }
};
