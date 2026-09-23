import formatDuration from '../formatDuration';

test('formats song lengths', () => {
  expect(formatDuration(222000)).toBe('3:42');
  expect(formatDuration(5000)).toBe('0:05');
  expect(formatDuration(59600)).toBe('1:00');
  expect(formatDuration(3723000)).toBe('1:02:03');
});

test('unknown lengths are blank', () => {
  expect(formatDuration(null)).toBe('');
  expect(formatDuration(0)).toBe('');
  expect(formatDuration('x')).toBe('');
});
