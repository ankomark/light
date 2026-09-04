/**
 * Sunset times, computed rather than fetched.
 *
 * The calendar browses any month, past or future, and a Sabbath that only
 * knows its times for the next seven days is not much of a Sabbath calendar.
 * So this is the NOAA sunrise/sunset algorithm — about forty lines, accurate
 * to roughly a minute, and it works offline for any date and any place.
 *
 * Sabbath here means Friday sunset to Saturday sunset, which is what the app's
 * audience keeps. The times come from the place already chosen for the weather;
 * without one, the calendar simply marks the days and says nothing about times,
 * because a Sabbath time for the wrong city is worse than none.
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

// The sun's centre is this far below the horizon when its upper limb appears
// to touch it — refraction plus the sun's own radius.
const ZENITH = 90.833;

const dayOfYear = (date) => {
  const start = Date.UTC(date.getFullYear(), 0, 0);
  const here = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.floor((here - start) / 86400000);
};

/**
 * Sunrise or sunset for a date and place, as minutes after local midnight.
 *
 * Returns null where the sun does not rise or set at all — above the Arctic
 * circle in midsummer the equation has no solution, and pretending otherwise
 * would print a confident wrong time.
 */
const solarEvent = (date, latitude, longitude, rising) => {
  const N = dayOfYear(date);
  const lngHour = longitude / 15;
  const t = N + ((rising ? 6 : 18) - lngHour) / 24;

  const M = (0.9856 * t) - 3.289;                                  // mean anomaly
  let L = M + (1.916 * Math.sin(M * RAD)) + (0.020 * Math.sin(2 * M * RAD)) + 282.634;
  L = ((L % 360) + 360) % 360;                                     // true longitude

  let RA = Math.atan(0.91764 * Math.tan(L * RAD)) * DEG;
  RA = ((RA % 360) + 360) % 360;
  // Right ascension has to sit in the same quadrant as the true longitude.
  RA += (Math.floor(L / 90) * 90) - (Math.floor(RA / 90) * 90);
  RA /= 15;

  const sinDec = 0.39782 * Math.sin(L * RAD);
  const cosDec = Math.cos(Math.asin(sinDec));

  const cosH = (Math.cos(ZENITH * RAD) - (sinDec * Math.sin(latitude * RAD)))
    / (cosDec * Math.cos(latitude * RAD));
  if (cosH > 1 || cosH < -1) return null;                          // polar day or night

  const H = (rising ? 360 - (Math.acos(cosH) * DEG) : Math.acos(cosH) * DEG) / 15;
  const T = H + RA - (0.06571 * t) - 6.622;
  const UT = ((((T - lngHour) % 24) + 24) % 24);

  // UT is the moment in universal time; the device's own offset for that day
  // turns it into wall-clock time, which is what a person reads off a wall.
  const utcMoment = Date.UTC(
    date.getFullYear(), date.getMonth(), date.getDate(),
    Math.floor(UT), Math.round((UT % 1) * 60),
  );
  const local = new Date(utcMoment);
  return local.getHours() * 60 + local.getMinutes();
};

export const sunsetMinutes = (date, latitude, longitude) =>
  solarEvent(date, latitude, longitude, false);

export const sunriseMinutes = (date, latitude, longitude) =>
  solarEvent(date, latitude, longitude, true);

/** "6:34 pm" from minutes after midnight, or '' when there is no such moment. */
export const formatMinutes = (minutes) => {
  if (minutes === null || minutes === undefined) return '';
  const h = Math.floor(minutes / 60) % 24;
  const m = Math.floor(minutes % 60);
  const suffix = h < 12 ? 'am' : 'pm';
  const hour12 = ((h + 11) % 12) + 1;
  return `${hour12}:${String(m).padStart(2, '0')} ${suffix}`;
};

export const isFriday = (date) => date.getDay() === 5;
export const isSabbath = (date) => date.getDay() === 6;

/**
 * When this week's Sabbath begins and ends, for the Friday or Saturday given.
 *
 * Null when there is no place to compute from — the calendar then marks the
 * day without claiming a time it cannot know.
 */
export const sabbathTimes = (date, place) => {
  if (!place || place.latitude == null || place.longitude == null) return null;

  const friday = new Date(date);
  if (isSabbath(date)) friday.setDate(friday.getDate() - 1);
  else if (!isFriday(date)) return null;

  const saturday = new Date(friday);
  saturday.setDate(saturday.getDate() + 1);

  return {
    beginsOn: friday,
    endsOn: saturday,
    begins: sunsetMinutes(friday, place.latitude, place.longitude),
    ends: sunsetMinutes(saturday, place.latitude, place.longitude),
  };
};
