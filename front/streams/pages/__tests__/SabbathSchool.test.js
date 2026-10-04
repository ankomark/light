/**
 * Sabbath School: the quarter opens on this week's lesson, a lesson opens on
 * today's day, a Bible reference opens its passage from the day's own file,
 * and EN | SW switches the lessons in place. Adventech is a stand-in
 * answering by URL.
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.setTimeout(20000);

const mockT = (k, p) => {
  if (k === 'ss.months') return 'Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec';
  return p ? `${k}:${Object.values(p).join(',')}` : k;
};
jest.mock('../../context/I18nContext', () => ({ useI18n: () => ({ t: mockT, resolvedLanguage: 'en' }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

const { default: SabbathSchool } = require('../SabbathSchool');
const { default: SabbathSchoolLesson } = require('../SabbathSchoolLesson');
const { __resetLessonLanguage } = require('../../services/sabbathSchool');
const { clearAllCaches } = require('../../utils/screenCache');

const API = 'https://sabbath-school.adventech.io/api/v2';
const quarter = (lang, title) => ({
  id: '2026-04', lang, title, human_date: 'October · November · December 2026',
  start_date: '26/09/2026', end_date: '25/12/2026', color_primary: '#54292F', color_primary_dark: '#3E1E22',
  description: 'Neuroscientists have begun to understand...', splash: 'https://x/splash.png', cover: 'https://x/c.png',
});
const edition = (lang, { title, lesson1, lesson2, sabbath, sunday, verse }) => {
  const base = `${API}/${lang}/quarterlies`;
  const Q = quarter(lang, title);
  return {
    [`${base}/index.json`]: [Q, { ...Q, id: '2026-04-cq' }, { ...Q, id: '2026-03', title: `${lang} Corinthians`,
      start_date: '27/06/2026', end_date: '25/09/2026' }],
    [`${base}/2026-04/index.json`]: {
      quarterly: Q,
      lessons: [
        { id: '01', title: lesson1, start_date: '26/09/2026', end_date: '02/10/2026' },
        { id: '02', title: lesson2, start_date: '03/10/2026', end_date: '09/10/2026' },
      ],
    },
    [`${base}/2026-04/lessons/02/index.json`]: {
      lesson: { id: '02', title: lesson2 },
      days: [
        { id: '01', date: '03/10/2026', title: lesson2 },
        { id: '02', date: '04/10/2026', title: sunday },
      ],
      pdfs: [],
    },
    [`${base}/2026-04/lessons/02/days/01/read/index.json`]: {
      id: '01', date: '03/10/2026', title: lesson2, content: `<p>${sabbath}</p>`, bible: [],
    },
    [`${base}/2026-04/lessons/02/days/02/read/index.json`]: {
      id: '02', date: '04/10/2026', title: sunday,
      content: '<p>Read <a class="verse" verse="Isa68">Isaiah 6:8</a> today.</p>'
        + '<div style="display: none"><p>Hidden appeal</p></div>',
      bible: verse,
    },
  };
};
const ROUTES = {
  ...edition('en', {
    title: 'The Gift of Prophecy', lesson1: 'The Creator Speaks', lesson2: 'The Call of a Prophet',
    sabbath: 'Sabbath text.', sunday: 'Abraham, Defender of the Covenant',
    verse: [
      { name: 'NASB', verses: { Isa68: '<h2>Isaiah 6:8</h2><p>NASB words</p>' } },
      { name: 'NKJV', verses: { Isa68: '<h2>Isaiah 6:8</h2><p>Here am I! Send me.</p>' } },
    ],
  }),
  ...edition('sw', {
    title: 'Karama Ya Unabii', lesson1: 'Muumba Ananena', lesson2: 'Wito wa Nabii',
    sabbath: 'Somo la Sabato.', sunday: 'Ibrahimu, Mtetezi wa Agano',
    verse: [{ name: 'SUV', verses: { Isa68: '<p>Mimi hapa, nitume mimi.</p>' } }],
  }),
};

beforeAll(() => {
  // Sunday of lesson 2's week. Only the date is faked: the waits stay real.
  jest.useFakeTimers({
    now: new Date(2026, 9, 4, 9, 0),
    doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'nextTick', 'queueMicrotask'],
  });
});
afterAll(() => jest.useRealTimers());

beforeEach(async () => {
  await clearAllCaches();
  await AsyncStorage.clear();
  __resetLessonLanguage();
  global.fetch = jest.fn(async (url) => (ROUTES[url]
    ? { ok: true, json: async () => ROUTES[url] }
    : { ok: false, status: 404 }));
});

const fetched = () => global.fetch.mock.calls.map((c) => c[0].replace(`${API}/`, ''));

test("the quarter opens with this week's lesson ready to continue", async () => {
  const navigation = { push: jest.fn() };
  const screen = render(<SabbathSchool navigation={navigation} route={{}} />);
  await waitFor(() => expect(screen.getByText('The Gift of Prophecy')).toBeTruthy());
  expect(screen.getByText('The Creator Speaks')).toBeTruthy();
  // The youth edition is not offered as an earlier quarter; last quarter is.
  expect(screen.getByText('en Corinthians')).toBeTruthy();

  fireEvent.press(screen.getByLabelText('ss.continue: The Call of a Prophet'));
  expect(navigation.push).toHaveBeenCalledWith('SabbathSchoolLesson', {
    quarterlyId: '2026-04', lessonId: '02', startDate: '03/10/2026',
    colors: { primary: '#54292F', dark: '#3E1E22' },
  });
});

test('a first open asks for the quarter alongside the list, once each', async () => {
  const screen = render(<SabbathSchool navigation={{ push: jest.fn() }} route={{}} />);
  await waitFor(() => expect(screen.getByText('The Gift of Prophecy')).toBeTruthy());
  // This week and today are fetched ahead of "Continue".
  await waitFor(() => expect(fetched()).toContain('en/quarterlies/2026-04/lessons/02/days/02/read/index.json'));
  const calls = fetched();
  expect(calls.slice(0, 2).sort()).toEqual(['en/quarterlies/2026-04/index.json', 'en/quarterlies/index.json']);
  // Guess, list and screen all wanted the quarter: one request between them.
  expect(calls.filter((u) => u === 'en/quarterlies/2026-04/index.json')).toHaveLength(1);
});

test('SW switches the quarter in place, and is remembered', async () => {
  const screen = render(<SabbathSchool navigation={{ push: jest.fn() }} route={{}} />);
  await waitFor(() => expect(screen.getByText('The Gift of Prophecy')).toBeTruthy());

  fireEvent.press(screen.getByTestId('lesson-lang-sw'));
  // The English stays up while the Swahili loads; never a blank screen.
  expect(screen.getByText('The Gift of Prophecy')).toBeTruthy();
  await waitFor(() => expect(screen.getByText('Karama Ya Unabii')).toBeTruthy());
  expect(screen.getByText('Muumba Ananena')).toBeTruthy();
  expect(await AsyncStorage.getItem('@sabbathSchool:lang')).toBe('sw');

  // A fresh start reads it back, though the app itself is in English, and
  // asks for nothing in English on the way.
  screen.unmount();
  __resetLessonLanguage();
  global.fetch.mockClear();
  const again = render(<SabbathSchool navigation={{ push: jest.fn() }} route={{}} />);
  await waitFor(() => expect(again.getByText('Karama Ya Unabii')).toBeTruthy());
  expect(fetched().filter((u) => u.startsWith('en/'))).toEqual([]);
});

test('a quarter missing in one language still offers the other', async () => {
  const screen = render(<SabbathSchool navigation={{ push: jest.fn() }} route={{ params: { quarterlyId: '1999-01' } }} />);
  await waitFor(() => expect(screen.getByText('ss.failed')).toBeTruthy());
  expect(screen.getByTestId('lesson-lang-sw')).toBeTruthy();
});

const lessonParams = { quarterlyId: '2026-04', lessonId: '02', startDate: '03/10/2026',
  colors: { primary: '#54292F', dark: '#3E1E22' } };

test("a lesson opens on today's day, and a reference opens its passage", async () => {
  const screen = render(<SabbathSchoolLesson navigation={{}} route={{ params: lessonParams }} />);
  await waitFor(() => expect(screen.getByText('Abraham, Defender of the Covenant')).toBeTruthy());
  expect(screen.queryByText('Hidden appeal')).toBeNull();

  fireEvent.press(screen.getByText('Isaiah 6:8'));
  // NKJV first, though NASB comes first in the file.
  await waitFor(() => expect(screen.getByText('Here am I! Send me.')).toBeTruthy());
  fireEvent.press(screen.getByText('NASB'));
  await waitFor(() => expect(screen.getByText('NASB words')).toBeTruthy());
  fireEvent.press(screen.getByText('ss.close'));

  // The day before, from the footer.
  fireEvent.press(screen.getByLabelText('ss.prev'));
  await waitFor(() => expect(screen.getByText('Sabbath text.')).toBeTruthy());
});

test("today's day is asked for with the week's index, not after it", async () => {
  const screen = render(<SabbathSchoolLesson navigation={{}} route={{ params: lessonParams }} />);
  await waitFor(() => expect(screen.getByText('Abraham, Defender of the Covenant')).toBeTruthy());
  expect(fetched().slice(0, 2).sort()).toEqual([
    'en/quarterlies/2026-04/lessons/02/days/02/read/index.json',
    'en/quarterlies/2026-04/lessons/02/index.json',
  ]);
  // The week's other day comes behind it; the open one is not fetched twice.
  await waitFor(() => expect(fetched()).toContain('en/quarterlies/2026-04/lessons/02/days/01/read/index.json'));
  expect(fetched().filter((u) => u.endsWith('days/02/read/index.json'))).toHaveLength(1);
});

test('SW in the reader keeps the day and the place', async () => {
  const screen = render(<SabbathSchoolLesson navigation={{}} route={{ params: lessonParams }} />);
  await waitFor(() => expect(screen.getByText('Abraham, Defender of the Covenant')).toBeTruthy());
  fireEvent.press(screen.getByTestId('lesson-lang-sw'));
  await waitFor(() => expect(screen.getByText('Ibrahimu, Mtetezi wa Agano')).toBeTruthy());

  // Swahili verses, from the Swahili day's own Bible.
  fireEvent.press(screen.getByText('Isaiah 6:8'));
  await waitFor(() => expect(screen.getByText('Mimi hapa, nitume mimi.')).toBeTruthy());
});
