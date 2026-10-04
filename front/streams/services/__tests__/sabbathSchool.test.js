import {
  lessonLanguage, isAdultQuarterly, parseDate, isWithin, formatApiDate, shortDate,
  currentQuarterly, currentLesson, currentDay, prepareLessonHtml, isHiddenNode,
  defaultVersionIndex, fetchDay, fetchQuarterly, guessQuarterlyId, guessDayId, quarterColors,
  __resetLessonLanguage,
} from '../sabbathSchool';

// Shapes as the API sends them (trimmed).
const QUARTERLIES = [
  { id: '2026-04', title: 'The Gift of Prophecy', start_date: '26/09/2026', end_date: '25/12/2026' },
  { id: '2026-04-cq', title: 'The Gift of Prophecy', start_date: '26/09/2026', end_date: '25/12/2026' },
  { id: '2026-03', title: 'First and Second Corinthians', start_date: '27/06/2026', end_date: '25/09/2026' },
];
const LESSONS = [
  { id: '01', start_date: '26/09/2026', end_date: '02/10/2026' },
  { id: '02', start_date: '03/10/2026', end_date: '09/10/2026' },
];
const DAYS = [
  { id: '01', date: '03/10/2026' },
  { id: '02', date: '04/10/2026' },
  { id: '07', date: '09/10/2026' },
];

const on = (y, m, d) => new Date(y, m - 1, d, 15, 30);

describe('sabbathSchool', () => {
  beforeEach(() => __resetLessonLanguage());

  it('reads Swahili for Swahili and English for anything else', () => {
    expect(lessonLanguage('sw')).toBe('sw');
    expect(lessonLanguage('en')).toBe('en');
    expect(lessonLanguage('fr')).toBe('en');
    expect(lessonLanguage(undefined)).toBe('en');
  });

  it('tells the adult quarterly from youth and teachers editions by id', () => {
    expect(isAdultQuarterly({ id: '2026-04' })).toBe(true);
    expect(isAdultQuarterly({ id: '2026-04-cq' })).toBe(false);
    expect(isAdultQuarterly({ id: '2026-03-zaijprsg' })).toBe(false);
    expect(isAdultQuarterly(null)).toBe(false);
  });

  it('parses the API date as a local day, day first', () => {
    const d = parseDate('03/10/2026');
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 9, 3]);
    expect(parseDate('2026-10-03')).toBeNull();
    expect(parseDate(undefined)).toBeNull();
  });

  it('counts both ends of a range, whatever the time of day', () => {
    expect(isWithin('03/10/2026', '09/10/2026', on(2026, 10, 3))).toBe(true);
    expect(isWithin('03/10/2026', '09/10/2026', on(2026, 10, 9))).toBe(true);
    expect(isWithin('03/10/2026', '09/10/2026', on(2026, 10, 10))).toBe(false);
    expect(isWithin('bad', '09/10/2026', on(2026, 10, 5))).toBe(false);
  });

  it('writes dates the way the API does, zero-padded', () => {
    expect(formatApiDate(on(2026, 1, 4))).toBe('04/01/2026');
  });

  it('formats a short date with the given month names', () => {
    const months = 'Jan,Feb,Mac,Apr,Mei,Jun,Jul,Ago,Sep,Okt,Nov,Des'.split(',');
    expect(shortDate('03/10/2026', months)).toBe('3 Okt');
    expect(shortDate('', months)).toBe('');
  });

  it('picks the adult quarterly in progress, never a youth edition', () => {
    expect(currentQuarterly(QUARTERLIES, on(2026, 10, 4)).id).toBe('2026-04');
    expect(currentQuarterly(QUARTERLIES, on(2026, 8, 1)).id).toBe('2026-03');
  });

  it('falls back to the newest adult quarterly when none is in progress', () => {
    // A new quarter not yet published in this language.
    expect(currentQuarterly(QUARTERLIES, on(2027, 1, 2)).id).toBe('2026-04');
    expect(currentQuarterly([], on(2026, 10, 4))).toBeNull();
  });

  it("finds this week's lesson and today's day", () => {
    expect(currentLesson(LESSONS, on(2026, 10, 4)).id).toBe('02');
    expect(currentLesson(LESSONS, on(2027, 1, 1))).toBeNull();
    expect(currentDay(DAYS, on(2026, 10, 4)).id).toBe('02');
    // Another week: its Sabbath.
    expect(currentDay(DAYS, on(2026, 11, 1)).id).toBe('01');
    expect(currentDay([], on(2026, 10, 4))).toBeNull();
  });

  it('makes verse links pressable and keeps their key', () => {
    const html = prepareLessonHtml('<p><a class="verse" verse="Isa68">Isaiah 6:8</a> p. 90.\\</p>');
    expect(html).toBe('<p><a href="#verse" class="verse" verse="Isa68">Isaiah 6:8</a> p. 90.</p>');
    expect(prepareLessonHtml(undefined)).toBe('');
  });

  it('recognises blocks the publisher hides', () => {
    expect(isHiddenNode({ attribs: { style: 'display: none' } })).toBe(true);
    expect(isHiddenNode({ attribs: { style: 'display:none' } })).toBe(true);
    expect(isHiddenNode({ attribs: { class: 'verse' } })).toBe(false);
    expect(isHiddenNode(null)).toBe(false);
  });

  it('opens a reference in the preferred version for the language', () => {
    const en = [{ name: 'NASB' }, { name: 'NKJV' }, { name: 'KJV' }];
    expect(defaultVersionIndex(en, 'en')).toBe(1);
    expect(defaultVersionIndex([{ name: 'SUV' }], 'sw')).toBe(0);
    expect(defaultVersionIndex([{ name: 'ASV' }], 'en')).toBe(0);
    expect(defaultVersionIndex([], 'en')).toBe(0);
  });

  it('asks the API for a day by its path and fails on an error status', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: '02' }) })
      .mockResolvedValueOnce({ ok: false, status: 404 });
    global.fetch = fetchMock;
    await expect(fetchDay('en', '2026-04', '02', '02')).resolves.toEqual({ id: '02' });
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://sabbath-school.adventech.io/api/v2/en/quarterlies/2026-04/lessons/02/days/02/read/index.json',
    );
    await expect(fetchDay('en', '2026-04', '02', '09')).rejects.toThrow('404');
  });

  it('guesses the quarter from the date, a week ahead', () => {
    expect(guessQuarterlyId(on(2026, 10, 4))).toBe('2026-04');
    // Q4 began on 26 September, before its calendar quarter.
    expect(guessQuarterlyId(on(2026, 9, 26))).toBe('2026-04');
    expect(guessQuarterlyId(on(2026, 9, 10))).toBe('2026-03');
    // Into the new year's first quarter, which begins late December.
    expect(guessQuarterlyId(on(2026, 12, 27))).toBe('2027-01');
  });

  it("guesses today's day id from the week's start", () => {
    expect(guessDayId('03/10/2026', on(2026, 10, 3))).toBe('01');
    expect(guessDayId('03/10/2026', on(2026, 10, 4))).toBe('02');
    expect(guessDayId('03/10/2026', on(2026, 10, 9))).toBe('07');
    // Another week: its Sabbath, where the reader opens then.
    expect(guessDayId('03/10/2026', on(2026, 10, 10))).toBe('01');
    expect(guessDayId('03/10/2026', on(2026, 10, 2))).toBe('01');
    expect(guessDayId(undefined, on(2026, 10, 4))).toBe('01');
  });

  it('makes a verse link pressable whatever order its attributes are in', () => {
    expect(prepareLessonHtml('<a verse="Isa68" class="verse">x</a>'))
      .toBe('<a href="#verse" verse="Isa68" class="verse">x</a>');
    // An ordinary link is left alone, and so is a tag that only starts with "a".
    expect(prepareLessonHtml('<a href="https://x" verse="y">x</a>')).toBe('<a href="https://x" verse="y">x</a>');
    expect(prepareLessonHtml('<abbr verse="y">x</abbr>')).toBe('<abbr verse="y">x</abbr>');
  });

  it("falls back to its own colours when a quarter's are not #rrggbb", () => {
    expect(quarterColors({ color_primary: '#54292F', color_primary_dark: '#3E1E22' }))
      .toEqual({ primary: '#54292F', dark: '#3E1E22' });
    expect(quarterColors({ color_primary: 'rgb(1,2,3)', color_primary_dark: '#abc' }))
      .toEqual({ primary: '#3B4A6B', dark: '#26324A' });
  });

  it('shares one request between callers, and reuses the answer for a minute', async () => {
    let resolve;
    global.fetch = jest.fn(() => new Promise((r) => { resolve = r; }));
    const a = fetchQuarterly('en', '2026-04');
    const b = fetchQuarterly('en', '2026-04');
    resolve({ ok: true, json: async () => ({ quarterly: { id: '2026-04' } }) });
    expect(await a).toEqual(await b);
    await fetchQuarterly('en', '2026-04');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not keep a failure: the next call asks again', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: 1 }) });
    await expect(fetchQuarterly('sw', '2026-04')).rejects.toThrow('503');
    await expect(fetchQuarterly('sw', '2026-04')).resolves.toEqual({ ok: 1 });
  });
});
