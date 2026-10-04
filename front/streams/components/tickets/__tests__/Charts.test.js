/**
 * The organiser's charts: two weeks of days with the gaps filled, a bar you
 * can tap to read, the takings split by level, and the dials.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(async () => {}), impactAsync: jest.fn(async () => {}), ImpactFeedbackStyle: {} }));
jest.mock('expo-constants', () => ({ expoConfig: { version: '1.0.0' } }));

const { fillDays, DailyBars, LevelShare, Ring, Spark } = require('../Charts');

const t = (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k);
const MONTHS = 'Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec'.split(',');
const NOW = new Date(2026, 9, 4, 15, 0);           // 4 Oct 2026, the phone's own time

test('fillDays: n days ending today, oldest first, gaps as zero', () => {
  const rows = fillDays([{ date: '2026-10-02', collected: 1500, tickets: 3 }, { date: '2026-09-01', collected: 9 }], 3, NOW);
  expect(rows).toEqual([
    { date: '2026-10-02', collected: 1500, tickets: 3 },
    { date: '2026-10-03', collected: 0, tickets: 0 },
    { date: '2026-10-04', collected: 0, tickets: 0 },
  ]);
  expect(fillDays(null, 14, NOW)).toHaveLength(14);
});

test('fillDays crosses a month end', () => {
  expect(fillDays([], 5, NOW).map((r) => r.date)).toEqual(['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
});

test('DailyBars: the two weeks total, and a tapped day read out', () => {
  const screen = render(<DailyBars byDay={[{ date: '2026-10-03', collected: 2500, tickets: 5 }, { date: '2026-10-04', collected: 500, tickets: 1 }]}
                                   t={t} months={MONTHS} now={NOW} />);
  expect(screen.getByText('KES 3,000')).toBeTruthy();
  expect(screen.getByTestId('chart-days-readout').props.children).toBe('tix.chart.tapDay');
  fireEvent.press(screen.getByTestId('chart-day-2026-10-03'));
  expect(screen.getByTestId('chart-days-readout').props.children).toBe('3 Oct · KES 2,500 · tix.chart.tickets:5');
  fireEvent.press(screen.getByTestId('chart-day-2026-10-03'));        // again: back to the hint
  expect(screen.getByTestId('chart-days-readout').props.children).toBe('tix.chart.tapDay');
});

test('LevelShare: money and share per level, and how full each is', () => {
  const screen = render(<LevelShare t={t} levels={[
    { id: 1, name: 'Regular', quantity: 200, sold: 120, collected: 60000 },
    { id: 2, name: 'VIP', quantity: 50, sold: 20, collected: 40000 },
    { id: 3, name: 'Hidden', quantity: 0, sold: 0, collected: 0 },
  ]} />);
  expect(screen.getByText('KES 60,000')).toBeTruthy();
  expect(screen.getByText('tix.chart.soldOf:120,200  ·  60%')).toBeTruthy();
  expect(screen.getByText('tix.chart.soldOf:20,50  ·  40%')).toBeTruthy();
  expect(screen.queryByText('Hidden')).toBeNull();
  expect(render(<LevelShare t={t} levels={[]} />).toJSON()).toBeNull();
});

test('Ring: the share as a percentage, nothing to divide by is 0%', () => {
  expect(render(<Ring value={30} total={120} label="Sold" />).getByText('25%')).toBeTruthy();
  expect(render(<Ring value={5} total={0} label="Admitted" />).getByText('0%')).toBeTruthy();
  expect(render(<Ring value={500} total={100} label="Over" />).getByText('100%')).toBeTruthy();
});

test('Spark draws a bar a day', () => {
  const screen = render(<Spark byDay={[{ date: '2026-10-04', collected: 10 }]} now={NOW} />);
  expect(screen.getByTestId('chart-spark', { includeHiddenElements: true }).props.children).toHaveLength(14);
});
