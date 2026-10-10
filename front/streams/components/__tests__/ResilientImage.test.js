/**
 * Pictures never sit as a dark box while online: a failed or hung load is
 * tried again by itself, and only every try failing shows "unavailable".
 */
import React from 'react';
import { Text } from 'react-native';
import { render, act } from '@testing-library/react-native';

let mockOnline = true;
jest.mock('../../hooks/useOnline', () => () => mockOnline);
jest.mock('@expo/vector-icons', () => ({}));
const mockImages = [];
jest.mock('expo-image', () => {
  const { View } = require('react-native');
  return { Image: (p) => { mockImages.push(p); return <View testID="img" />; } };
});

const { default: ResilientImage, RETRY_DELAYS, HANG_MS } = require('../ResilientImage');

const last = () => mockImages[mockImages.length - 1];

beforeEach(() => {
  jest.useFakeTimers();
  mockImages.length = 0;
  mockOnline = true;
});
afterEach(() => jest.useRealTimers());

const failed = (retry) => <Text testID="failed" onPress={retry}>unavailable</Text>;

test('a failed load is tried again, three times, before "unavailable"', () => {
  const onFailed = jest.fn();
  const screen = render(<ResilientImage uri="https://m/p.jpg" onFailed={onFailed} renderFailed={failed} />);
  for (let i = 0; i < RETRY_DELAYS.length; i += 1) {
    const before = mockImages.length;
    act(() => { last().onError(); });
    act(() => { jest.advanceTimersByTime(RETRY_DELAYS[i]); });
    expect(mockImages.length).toBeGreaterThan(before);       // drawn again: a fresh fetch
    expect(screen.queryByTestId('failed')).toBeNull();
  }
  act(() => { last().onError(); });
  expect(onFailed).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('failed')).toBeTruthy();
});

test('a load that never answers counts as failed and is tried again', () => {
  render(<ResilientImage uri="https://m/p.jpg" recyclingKey="7" />);
  const firstKey = last().recyclingKey;
  act(() => { jest.advanceTimersByTime(HANG_MS + RETRY_DELAYS[0] + 10); });
  expect(last().recyclingKey).not.toBe(firstKey);     // a new attempt, not the hung one
});

test('loaded: no more tries', () => {
  render(<ResilientImage uri="https://m/p.jpg" />);
  act(() => { last().onLoad({}); });
  const count = mockImages.length;
  act(() => { jest.advanceTimersByTime(HANG_MS * 3); });
  expect(mockImages.length).toBe(count);
});

test('offline, it waits instead of giving up', () => {
  mockOnline = false;
  const onFailed = jest.fn();
  render(<ResilientImage uri="https://m/p.jpg" onFailed={onFailed} />);
  act(() => { last().onError(); });
  act(() => { jest.advanceTimersByTime(HANG_MS * 3); });
  expect(onFailed).not.toHaveBeenCalled();
});

test('the small preview is painted first', () => {
  render(<ResilientImage uri="https://m/p.jpg" previewUri="https://m/p_640.jpg" />);
  expect(last().placeholder).toEqual({ uri: 'https://m/p_640.jpg' });
});
