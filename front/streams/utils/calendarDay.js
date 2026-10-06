// Calendar dates (birthdays) without time zones getting in the way.
/** "1990-05-12" → a Date at local midnight that day (new Date("1990-05-12") is
 *  UTC midnight: west of Greenwich, that is the day before). */
export const parseDay = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};
/** A Date → "1990-05-12" in the phone's own time (toISOString() goes through
 *  UTC: east of Greenwich — Kenya — local midnight is still yesterday there). */
export const formatDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
