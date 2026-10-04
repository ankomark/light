/**
 * Sabbath School lessons, from Adventech's public API — the same source the
 * official Sabbath School app reads.
 *
 * https://sabbath-school.adventech.io/api/v2 — no key, every quarter since the
 * 1880s, in ~100 languages including Swahili. The shape is a tree of static
 * JSON files:
 *
 *   {lang}/quarterlies/index.json                         every quarterly
 *   {lang}/quarterlies/{q}/index.json                     one, with its 13 lessons
 *   {lang}/quarterlies/{q}/lessons/{l}/index.json         a week, with its 7 days
 *   {lang}/quarterlies/{q}/lessons/{l}/days/{d}/read/index.json   a day's study
 *
 * A day's study is HTML, and carries the text of every verse it links to in
 * several versions, so a tapped reference needs no further request.
 *
 * Plain `fetch`, not the app's axios client, for the reason weather.js gives:
 * that client attaches the user's token, and this is a third party.
 */

import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BASE = 'https://sabbath-school.adventech.io/api/v2';

// A slow network should not leave the screen spinning forever.
const TIMEOUT_MS = 15000;

// One request per file at a time. The screens prefetch what they expect to
// need next, and a reader quick enough to open it before the prefetch lands
// joins that request instead of starting a second one.
const inFlight = new Map();

// And an answer just received is the answer for a minute. The screens paint
// what is kept and then refresh it, which right after a prefetch (or going
// back and forth between a quarter and a lesson) would fetch the same static
// file again for nothing. Failures are not kept, so Retry always retries.
const RECENT_MS = 60 * 1000;
const recent = new Map();

const getJson = (path) => {
  const hit = recent.get(path);
  if (hit && Date.now() - hit.at < RECENT_MS) return Promise.resolve(hit.data);
  if (inFlight.has(path)) return inFlight.get(path);
  const request = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${BASE}/${path}`, { signal: controller.signal });
      if (!res.ok) throw new Error(`Sabbath School service returned ${res.status}`);
      const data = await res.json();
      recent.set(path, { at: Date.now(), data });
      return data;
    } finally {
      clearTimeout(timer);
    }
  })().finally(() => inFlight.delete(path));
  inFlight.set(path, request);
  return request;
};

// The app speaks English and Swahili, and Adventech publishes both. Anything
// else reads the English edition.
export const LESSON_LANGUAGES = ['en', 'sw'];
export const lessonLanguage = (appLanguage) => (appLanguage === 'sw' ? 'sw' : 'en');

// The lessons' own language, chosen on the lesson screens and kept apart from
// the app's: a reader can study in Swahili with the app in English. Until one
// is chosen it follows the app.
const LANG_KEY = '@sabbathSchool:lang';
let chosenLang;                     // undefined: not read yet; null: none chosen
const langListeners = new Set();
const announceLang = () => langListeners.forEach((fn) => fn(chosenLang));

/**
 * `{ lang, setLang, ready }`. `lang` is null until the phone's choice has been
 * read (a few ms), so a screen does not fetch one language only to switch.
 */
export const useLessonLanguage = (appLanguage) => {
  const [chosen, setChosen] = useState(chosenLang);
  useEffect(() => {
    langListeners.add(setChosen);
    if (chosenLang === undefined) {
      AsyncStorage.getItem(LANG_KEY)
        .then((v) => { chosenLang = LESSON_LANGUAGES.includes(v) ? v : null; })
        .catch(() => { chosenLang = null; })
        .finally(announceLang);
    } else {
      setChosen(chosenLang);
    }
    return () => { langListeners.delete(setChosen); };
  }, []);
  const setLang = useCallback((next) => {
    if (!LESSON_LANGUAGES.includes(next)) return;
    chosenLang = next;
    announceLang();
    AsyncStorage.setItem(LANG_KEY, next).catch(() => {});
  }, []);
  const ready = chosen !== undefined;
  return { lang: ready ? (chosen || lessonLanguage(appLanguage)) : null, setLang, ready };
};

/** Tests only: forget the choice and every answer, as a fresh install would. */
export const __resetLessonLanguage = () => { chosenLang = undefined; inFlight.clear(); recent.clear(); };

// The Standard Adult quarterly is the one a church studies together on
// Sabbath morning. Its id is the bare quarter ("2026-04"); the youth, junior
// and teachers' editions add a suffix ("2026-04-cq"). The id is used rather
// than `quarterly_group`, which the Swahili index does not send.
const ADULT_ID = /^\d{4}-\d{2}$/;
export const isAdultQuarterly = (q) => ADULT_ID.test(q?.id || '');

/** "26/09/2026" → a local Date at midnight; null if it is not that shape. */
export const parseDate = (s) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s || '');
  return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
};

const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Whether `now` falls on or between two "dd/mm/yyyy" dates. */
export const isWithin = (start, end, now = new Date()) => {
  const a = parseDate(start);
  const b = parseDate(end);
  const t = midnight(now).getTime();
  return !!a && !!b && a.getTime() <= t && t <= b.getTime();
};

/** "dd/mm/yyyy" for a Date — how the API writes a day's `date`. */
export const formatApiDate = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};

/** "3 Oct" — month names come from strings.js, since Hermes may not know Swahili. */
export const shortDate = (s, months) => {
  const d = parseDate(s);
  return d ? `${d.getDate()} ${months[d.getMonth()] || ''}`.trim() : '';
};

/**
 * The adult quarterly being studied now; failing that (a new quarter not yet
 * published in this language), the newest one there is.
 */
export const currentQuarterly = (list, now = new Date()) => {
  const adult = (list || []).filter(isAdultQuarterly);
  return adult.find((q) => isWithin(q.start_date, q.end_date, now)) || adult[0] || null;
};

/** This week's lesson, or null when the quarter is not the current one. */
export const currentLesson = (lessons, now = new Date()) => (
  (lessons || []).find((l) => isWithin(l.start_date, l.end_date, now)) || null
);

/**
 * The quarterly id most likely current, from the date alone: a quarter starts
 * on the last Sabbath before its calendar quarter, so a week ahead lands in
 * it. Only a guess to start fetching early; the list decides.
 */
export const guessQuarterlyId = (now = new Date()) => {
  const ahead = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);
  return `${ahead.getFullYear()}-0${Math.floor(ahead.getMonth() / 3) + 1}`;
};

/**
 * Today's day id within a lesson that starts on `startDate` ("01" is its
 * Sabbath), so a day can be fetched before the lesson's own index arrives.
 * "01" when today is not in that week, which is where the reader opens then.
 */
export const guessDayId = (startDate, now = new Date()) => {
  const start = parseDate(startDate);
  if (!start) return '01';
  const diff = Math.round((midnight(now).getTime() - start.getTime()) / 86400000);
  return diff >= 0 && diff < 7 ? `0${diff + 1}` : '01';
};

/** Today's day within a lesson's seven, or the first (its Sabbath). */
export const currentDay = (days, now = new Date()) => {
  const today = formatApiDate(now);
  return (days || []).find((d) => d.date === today) || (days || [])[0] || null;
};

export const fetchQuarterlies = (lang) => getJson(`${lang}/quarterlies/index.json`);

/** `{ quarterly, lessons }` */
export const fetchQuarterly = (lang, quarterlyId) => (
  getJson(`${lang}/quarterlies/${quarterlyId}/index.json`)
);

/** `{ lesson, days, pdfs }` */
export const fetchLesson = (lang, quarterlyId, lessonId) => (
  getJson(`${lang}/quarterlies/${quarterlyId}/lessons/${lessonId}/index.json`)
);

/** `{ id, date, title, content (HTML), bible: [{ name, verses: { key: html } }] }` */
export const fetchDay = (lang, quarterlyId, lessonId, dayId) => (
  getJson(`${lang}/quarterlies/${quarterlyId}/lessons/${lessonId}/days/${dayId}/read/index.json`)
);

// Cache keys, so the screens and the prefetch agree on where a thing is kept.
export const cacheKeys = {
  list: (lang) => `ss:${lang}:list`,
  quarterly: (lang, q) => `ss:${lang}:${q}`,
  lesson: (lang, q, l) => `ss:${lang}:${q}:${l}`,
  day: (lang, q, l, d) => `ss:${lang}:${q}:${l}:${d}`,
};

/**
 * A day's HTML, made ready for react-native-render-html:
 * - verse links carry no href, so the renderer would not make them pressable;
 *   they get a placeholder one and keep their `verse` attribute, which is the
 *   key into the day's `bible[].verses`;
 * - blocks the publisher hides (`display: none`, the EGW notes appeal) go.
 */
export const prepareLessonHtml = (html) => (html || '')
  // Any <a> with a verse= and no href, whatever order its attributes are in.
  .replace(/<a(?=\s)(?![^>]*\shref=)(?=[^>]*\sverse=)/g, '<a href="#verse"')
  // A stray backslash the source sometimes leaves before a closing tag.
  .replace(/\\(?=<\/)/g, '');

/** Whether a DOM node is one the publisher hides from readers. */
export const isHiddenNode = (node) => /display:\s*none/i.test(node?.attribs?.style || '');

// The version shown first when a reference is tapped: the one the lessons
// quote most, then whatever the day carries.
const PREFERRED_VERSIONS = {
  en: ['NKJV', 'KJV', 'NASB'],
  sw: ['SUV', 'SRUV', 'NEN'],
};

/** Index into `bible` of the version to show first. */
export const defaultVersionIndex = (bible, lang) => {
  const names = (bible || []).map((b) => (b.name || '').toUpperCase());
  for (const want of PREFERRED_VERSIONS[lang] || []) {
    const i = names.indexOf(want);
    if (i >= 0) return i;
  }
  return 0;
};

// The screens append an alpha to these ("#3E1E22CC"), so only #rrggbb will do.
const HEX6 = /^#[0-9a-f]{6}$/i;

/** The quarter's own colours, with a fallback for an older or odd entry. */
export const quarterColors = (q) => ({
  primary: HEX6.test(q?.color_primary || '') ? q.color_primary : '#3B4A6B',
  dark: HEX6.test(q?.color_primary_dark || '') ? q.color_primary_dark : '#26324A',
});
