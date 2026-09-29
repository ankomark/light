/**
 * "Why?": asked once the answer is recorded, in three ways, with the
 * server's reasons for saying no put in the reader's words.
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

const mockAsk = jest.fn();
jest.mock('../../services/api', () => ({ askQuizWhy: (...a) => mockAsk(...a) }));
jest.mock('../../context/I18nContext', () => ({ useI18n: () => ({ t: (k) => k }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const WhySheet = require('../WhySheet').default;

beforeEach(() => mockAsk.mockReset());

test('it waits for the answer to be recorded, then explains', async () => {
  const order = [];
  let release;
  const ready = () => new Promise((r) => { release = () => { order.push('recorded'); r(); }; });
  mockAsk.mockImplementation(async () => { order.push('asked'); return { text: 'Because of Genesis 6.' }; });
  const screen = render(<WhySheet visible questionId={11} lang="en" ready={ready} onClose={jest.fn()} />);
  await waitFor(() => expect(typeof release).toBe('function'));
  expect(mockAsk).not.toHaveBeenCalled();
  release();
  await waitFor(() => expect(screen.getByText('Because of Genesis 6.')).toBeTruthy());
  expect(order).toEqual(['recorded', 'asked']);
  expect(mockAsk).toHaveBeenCalledWith(11, 'why', 'en');
});

test('each way of explaining is asked for, and kept', async () => {
  mockAsk.mockImplementation(async (id, level) => ({ text: `answer:${level}` }));
  const screen = render(<WhySheet visible questionId={12} lang="sw" onClose={jest.fn()} />);
  await waitFor(() => expect(screen.getByText('answer:why')).toBeTruthy());
  fireEvent.press(screen.getByText('quiz.why.children'));
  await waitFor(() => expect(screen.getByText('answer:children')).toBeTruthy());
  fireEvent.press(screen.getByText('quiz.why.why'));
  await waitFor(() => expect(screen.getByText('answer:why')).toBeTruthy());
  expect(mockAsk).toHaveBeenCalledTimes(2);                 // "why" came from what was kept
  expect(mockAsk).toHaveBeenCalledWith(12, 'children', 'sw');
});

test.each([
  ['ai_limit', 'quiz.why.limit'],
  ['ai_off', 'quiz.why.off'],
  ['not_answered', 'quiz.why.notYet'],
  ['something_else', 'quiz.why.failed'],
])('%s is explained in the app’s words', async (code, message) => {
  mockAsk.mockRejectedValue({ response: { data: { code } } });
  const screen = render(<WhySheet visible questionId={20 + message.length} onClose={jest.fn()} />);
  await waitFor(() => expect(screen.getByText(message)).toBeTruthy());
});
