import { titleFromFileName, byFileName } from '../uploadTitles';

test('titles lose the extension, track number and underscores', () => {
  expect(titleFromFileName('03 - Amazing_Grace.mp3')).toBe('Amazing Grace');
  expect(titleFromFileName('1. Mungu Yu Mwema.m4a')).toBe('Mungu Yu Mwema');
  expect(titleFromFileName('Track 12 - Tenzi.wav')).toBe('Tenzi');
  expect(titleFromFileName('07_Bwana ni mchungaji.mp3')).toBe('Bwana ni mchungaji');
  expect(titleFromFileName('Amazing Grace.mp3')).toBe('Amazing Grace');
  expect(titleFromFileName('2020 Revival.mp3')).toBe('2020 Revival');  // a year isn't a track number
  expect(titleFromFileName('01.mp3')).toBe('01');                  // nothing else: keep it
});

test('files sort by their numbers, 2 before 10', () => {
  const files = ['10 - J.mp3', '2 - B.mp3', '1 - A.mp3'].map((name) => ({ name }));
  expect(files.sort(byFileName).map((f) => f.name)).toEqual(['1 - A.mp3', '2 - B.mp3', '10 - J.mp3']);
});
