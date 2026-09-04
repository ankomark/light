/**
 * Calendar entries and their reminders.
 *
 * Entries live on the device. Reminders are scheduled with expo-notifications
 * on the device too, rather than pushed from the server: a personal reminder
 * should fire at the minute you asked for it whether or not there is signal,
 * and it needs no round trip to do that. The server's push is for things other
 * people cause; this is a note to yourself.
 *
 * Shape:
 *   { 'yyyy-MM-dd': [ { id, text, time, remind, notificationId } ] }
 *
 * `time` is 'HH:mm' or null (an all-day note). `remind` only means anything
 * when there is a time to remind at.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { getPreference, PREF_KEYS } from './preferences';

const STORE_KEY = 'calendar:notes';        // kept: the old data lives under it
const MIGRATED_KEY = 'calendar:migrated:v2';

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Read everything, upgrading the old shape on the way out.
 *
 * The first version stored plain strings. Rather than dropping those notes or
 * asking anyone to retype them, they become timeless entries the first time
 * they are read, and the upgraded form is written straight back.
 */
export const loadEntries = async () => {
  try {
    const raw = await AsyncStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw) || {};

    let changed = false;
    const out = {};
    for (const [date, list] of Object.entries(data)) {
      out[date] = (Array.isArray(list) ? list : []).map((item) => {
        if (typeof item === 'string') {
          changed = true;
          return { id: newId(), text: item, time: null, remind: false, notificationId: null };
        }
        return item;
      });
    }
    if (changed) {
      await AsyncStorage.setItem(STORE_KEY, JSON.stringify(out));
      await AsyncStorage.setItem(MIGRATED_KEY, '1');
    }
    return out;
  } catch {
    return {};                     // unreadable notes must not break the dates
  }
};

export const saveEntries = async (entries) => {
  try {
    await AsyncStorage.setItem(STORE_KEY, JSON.stringify(entries));
    return true;
  } catch {
    return false;
  }
};

/** The moment a dated entry is due, or null when it has no time. */
export const entryMoment = (dateKey, time) => {
  if (!time) return null;
  const [y, m, d] = dateKey.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  if ([y, m, d, hh, mm].some(Number.isNaN)) return null;
  return new Date(y, m - 1, d, hh, mm, 0, 0);
};

/**
 * Book a reminder, returning its id so it can be cancelled later.
 *
 * Returns null when there is nothing to book — no time, a time already past,
 * or permission refused. A reminder that cannot fire should leave no trace
 * claiming that it will.
 */
export const scheduleReminder = async (dateKey, entry) => {
  const when = entryMoment(dateKey, entry.time);
  if (!when || when.getTime() <= Date.now() + 5000) return null;

  try {
    // Switched off in Settings means switched off — checked here rather than
    // at the call site so no future caller can route around it.
    if ((await getPreference(PREF_KEYS.calendarReminders)) === false) return null;

    const { status } = await Notifications.getPermissionsAsync();
    let granted = status === 'granted';
    if (!granted) {
      const asked = await Notifications.requestPermissionsAsync();
      granted = asked.status === 'granted';
    }
    if (!granted) return null;

    return await Notifications.scheduleNotificationAsync({
      content: {
        title: entry.text.slice(0, 60),
        body: whenLabel(when),
        data: { type: 'calendar_reminder', date: dateKey, id: entry.id },
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: when,
      },
    });
  } catch {
    return null;                   // a reminder that will not book is simply off
  }
};

export const cancelReminder = async (notificationId) => {
  if (!notificationId) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(notificationId);
  } catch {
    // Already fired, or already gone. Either way there is nothing to cancel.
  }
};

const whenLabel = (date) => {
  const h = date.getHours();
  const hour12 = ((h + 11) % 12) + 1;
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hour12}:${mm} ${h < 12 ? 'am' : 'pm'}`;
};

/** A blank entry, ready to be filled in. */
export const makeEntry = (text, time = null, remind = false) => ({
  id: newId(),
  text: String(text || '').trim(),
  time,
  remind: !!(remind && time),
  notificationId: null,
});

/**
 * Every entry across every date, in time order, from a starting date.
 *
 * What the schedule and reminder views are built from — the month grid asks
 * about one date at a time, but a list has to look across all of them.
 */
export const flatten = (entries, { from = null, onlyReminders = false } = {}) => {
  const rows = [];
  for (const [date, list] of Object.entries(entries || {})) {
    for (const entry of list || []) {
      if (onlyReminders && !(entry.remind && entry.time)) continue;
      if (from && date < from) continue;
      rows.push({ ...entry, date });
    }
  }
  return rows.sort((a, b) => (
    a.date === b.date
      ? String(a.time || '99:99').localeCompare(String(b.time || '99:99'))
      : a.date.localeCompare(b.date)
  ));
};
