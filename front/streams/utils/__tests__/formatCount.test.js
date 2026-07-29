import formatCount from '../formatCount';

describe('formatCount', () => {
  it('leaves counts under a thousand alone', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(7)).toBe('7');
    expect(formatCount(999)).toBe('999');
  });

  it('abbreviates thousands, millions and billions', () => {
    expect(formatCount(1000)).toBe('1K');
    expect(formatCount(1500)).toBe('1.5K');
    expect(formatCount(12345)).toBe('12.3K');
    expect(formatCount(4200000)).toBe('4.2M');
    expect(formatCount(3000000000)).toBe('3B');
  });

  it('truncates instead of rounding, so a unit never overflows', () => {
    // Rounding would render this as "1000K" instead of rolling into "1M".
    expect(formatCount(999999)).toBe('999.9K');
  });

  it('drops a trailing .0', () => {
    expect(formatCount(2000)).toBe('2K');
    expect(formatCount(2049)).toBe('2K');
  });

  it('falls back to 0 for junk values', () => {
    expect(formatCount(null)).toBe('0');
    expect(formatCount(undefined)).toBe('0');
    expect(formatCount('abc')).toBe('0');
  });

  it('accepts numeric strings from the API', () => {
    expect(formatCount('1500')).toBe('1.5K');
  });
});
