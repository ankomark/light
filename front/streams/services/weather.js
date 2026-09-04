/**
 * Weather, from Open-Meteo.
 *
 * Chosen over the better-known services for one reason: it needs no API key.
 * A key would have to be shipped inside the app, where anyone can read it out
 * of the bundle, and then rotated when it inevitably leaks. Nothing to leak
 * here, nothing to configure, and no per-user signup.
 *
 * These calls deliberately use plain `fetch` rather than the app's axios
 * client: that client attaches the user's auth token, and this is a third
 * party which has no business receiving it.
 *
 * https://open-meteo.com — free for non-commercial use, no key, generous limits.
 */

const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';

// A slow network should not leave the screen spinning forever.
const TIMEOUT_MS = 12000;

const getJson = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Weather service returned ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
};

// GeoNames feature codes worth telling apart. PPLX is literally "section of a
// populated place" — a neighbourhood, which is the level of detail that makes
// a forecast feel like it is about where you actually are.
const NEIGHBOURHOOD_CODES = ['PPLX', 'PPLL'];

/**
 * Towns, cities and neighbourhoods matching a name, most prominent first.
 *
 * The whole administrative chain is kept, not just the country. Searching
 * "Westlands" returns one in Jamaica, one in Massachusetts and one in Nairobi,
 * and with only a country beside them two of those look like the same answer.
 */
export const searchPlaces = async (query, language = 'en') => {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  const url = `${GEOCODE}?name=${encodeURIComponent(q)}&count=10`
    + `&language=${encodeURIComponent(language)}&format=json`;
  const data = await getJson(url);
  return (data.results || []).map((r) => ({
    id: r.id,
    name: r.name,
    country: r.country || '',
    region: r.admin1 || '',
    district: r.admin2 || '',
    ward: r.admin3 || '',
    population: r.population || 0,
    isNeighbourhood: NEIGHBOURHOOD_CODES.includes(r.feature_code),
    latitude: r.latitude,
    longitude: r.longitude,
  }));
};

/**
 * How a place is written out: the name on one line, everything below it on
 * another — the way a map app names where you are.
 *
 * `detail` walks outward from the place and drops repeats, so a town whose
 * district shares its name does not read "Kisumu, Kisumu, Kisumu County".
 */
export const describePlace = (place) => {
  if (!place) return { title: '', detail: '' };
  const seen = new Set([String(place.name || '').toLowerCase()]);
  const parts = [];
  for (const value of [place.ward, place.district, place.region, place.country]) {
    const text = String(value || '').trim();
    if (!text) continue;
    const key = text.toLowerCase();
    // "Nairobi" and "Nairobi County" are the same answer twice.
    if ([...seen].some((s) => key.includes(s) || s.includes(key))) continue;
    seen.add(key);
    parts.push(text);
  }
  return { title: place.name || '', detail: parts.join(', ') };
};

/**
 * Current conditions and a week ahead for one place.
 *
 * `timezone=auto` matters: without it the daily rows are in UTC, and a
 * forecast whose "today" ends at 3am is worse than no forecast.
 */
export const fetchForecast = async ({ latitude, longitude }) => {
  const url = `${FORECAST}?latitude=${latitude}&longitude=${longitude}`
    + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,'
    + 'precipitation,weather_code,wind_speed_10m,is_day'
    + '&hourly=temperature_2m,weather_code,precipitation_probability'
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min,'
    + 'precipitation_probability_max,sunrise,sunset'
    + '&timezone=auto&forecast_days=7';
  const data = await getJson(url);

  const c = data.current || {};
  const d = data.daily || {};
  const h = data.hourly || {};

  // Only the hours still ahead are of any use; the rest of today's array is
  // history. Twelve of them is a screenful without becoming a spreadsheet.
  const from = Math.max(0, (h.time || []).findIndex((t) => t >= (c.time || '')));
  const hours = (h.time || []).slice(from, from + 12).map((time, i) => ({
    time,
    temperature: h.temperature_2m?.[from + i],
    code: h.weather_code?.[from + i],
    rainChance: h.precipitation_probability?.[from + i],
  }));

  return {
    hours,
    updatedAt: c.time || null,
    current: {
      temperature: c.temperature_2m,
      feelsLike: c.apparent_temperature,
      humidity: c.relative_humidity_2m,
      precipitation: c.precipitation,
      wind: c.wind_speed_10m,
      code: c.weather_code,
      isDay: c.is_day !== 0,
    },
    days: (d.time || []).map((date, i) => ({
      date,
      code: d.weather_code?.[i],
      max: d.temperature_2m_max?.[i],
      min: d.temperature_2m_min?.[i],
      rainChance: d.precipitation_probability_max?.[i],
      sunrise: d.sunrise?.[i],
      sunset: d.sunset?.[i],
    })),
  };
};

/**
 * A first guess at where someone is, from the device's own timezone.
 *
 * "Africa/Nairobi" carries the city in its name, which is a surprisingly good
 * default and costs nothing: no location permission, no extra dependency, no
 * IP sent to a third party. It is offered as a suggestion to confirm, never
 * saved silently — a guess presented as a fact is worse than no guess.
 */
export const guessPlace = async (language = 'en') => {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    const city = zone.split('/').pop().replace(/_/g, ' ').trim();
    if (city.length < 2) return null;
    const [best] = await searchPlaces(city, language);
    return best || null;
  } catch {
    return null;                       // a guess that fails is simply no guess
  }
};

/**
 * WMO weather codes, which is what Open-Meteo reports.
 *
 * Grouped rather than listed one by one: the distinction between "moderate
 * drizzle" and "dense drizzle" is not one a person needs from a menu app, and
 * every unmapped code would otherwise render as a blank.
 */
const CODES = [
  { max: 0,  key: 'clear',    day: 'sunny',                night: 'moon' },
  { max: 2,  key: 'partly',   day: 'partly-sunny',         night: 'cloudy-night' },
  { max: 3,  key: 'cloudy',   day: 'cloud',                night: 'cloud' },
  { max: 49, key: 'fog',      day: 'cloud-outline',        night: 'cloud-outline' },
  { max: 59, key: 'drizzle',  day: 'rainy-outline',        night: 'rainy-outline' },
  { max: 69, key: 'rain',     day: 'rainy',                night: 'rainy' },
  { max: 79, key: 'snow',     day: 'snow',                 night: 'snow' },
  { max: 84, key: 'showers',  day: 'rainy',                night: 'rainy' },
  { max: 94, key: 'snow',     day: 'snow',                 night: 'snow' },
  { max: 99, key: 'thunder',  day: 'thunderstorm',         night: 'thunderstorm' },
];

export const describe = (code, isDay = true) => {
  const n = Number(code);
  const row = CODES.find((c) => n <= c.max) || CODES[CODES.length - 1];
  return { key: row.key, icon: isDay ? row.day : row.night };
};
