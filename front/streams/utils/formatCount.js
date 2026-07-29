/**
 * Compact display for profile stat numbers: 999 -> "999", 1500 -> "1.5K",
 * 12300 -> "12.3K", 4200000 -> "4.2M".
 *
 * The stats row packs four figures onto one line, and a lifetime like total
 * grows without bound — spelling out "1284736" would blow the row apart. One
 * decimal is kept only while it adds information, so "2K" never renders "2.0K".
 */
export default function formatCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';

  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs < 1000) return `${sign}${Math.round(abs)}`;

  const units = [
    { limit: 1e9, suffix: 'B' },
    { limit: 1e6, suffix: 'M' },
    { limit: 1e3, suffix: 'K' },
  ];
  const { limit, suffix } = units.find((u) => abs >= u.limit) ?? units[2];

  // Truncate rather than round, so 999_999 shows "999.9K" and never "1000K".
  const scaled = Math.floor((abs / limit) * 10) / 10;
  const text = Number.isInteger(scaled) ? String(scaled) : scaled.toFixed(1);
  return `${sign}${text}${suffix}`;
}
