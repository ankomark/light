// Bundled multi-language SDA hymnals. Each dataset is { language, name, hymns:[
//   { number, title, verses:[...], refrain } ] }.
import en from '../assets/hymns_en.json';
import sw from '../assets/hymns_sw.json';
import dho from '../assets/hymns_dho.json';
import guz from '../assets/hymns_guz.json';

export const HYMNALS = {
  en:  { code: 'en',  label: 'English',   name: 'SDA Hymnal',         data: en },
  sw:  { code: 'sw',  label: 'Kiswahili', name: 'Nyimbo za Kristo',   data: sw },
  dho: { code: 'dho', label: 'Dholuo',    name: 'Wende Nyasaye',      data: dho },
  guz: { code: 'guz', label: 'Ekegusii',  name: 'Ogotera Kwa Nyasae', data: guz },
};

// Display order of the language switcher.
export const HYMNAL_ORDER = ['en', 'sw', 'dho', 'guz'];

export const getHymnal = (code) => HYMNALS[code] || HYMNALS.en;
