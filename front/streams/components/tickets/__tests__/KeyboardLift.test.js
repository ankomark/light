/**
 * The ticket screens keep what is being typed above the keyboard: lifted by
 * the keyboard's own height (as Home's and Music's comment boxes are), less
 * the gesture bar it covers, and the focused field scrolled into view.
 */
import React from 'react';
import { Text, TextInput } from 'react-native';
import { render, act } from '@testing-library/react-native';

let mockHeight = 0;
jest.mock('../../../hooks/useKeyboardHeight', () => () => mockHeight);
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 24, left: 0, right: 0 }) }));

const KeyboardLift = require('../KeyboardLift').default;

// The lifting View is the root of what renders.
const paddingOf = (screen) => {
  const style = [].concat(screen.toJSON().props.style).flat(Infinity).filter(Boolean);
  return Object.assign({}, ...style).paddingBottom || 0;
};

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

test('nothing moves without a keyboard', () => {
  mockHeight = 0;
  const screen = render(<KeyboardLift scrollRef={{ current: null }}><Text testID="lifted">x</Text></KeyboardLift>);
  expect(paddingOf(screen)).toBe(0);
});

test('lifted by the keyboard less the gesture bar, and the focused field scrolled to', () => {
  mockHeight = 300;
  const scrollTo = jest.fn();
  const field = { focused: true };
  const focused = jest.spyOn(TextInput.State, 'currentlyFocusedInput').mockReturnValue(field);
  const screen = render(
    <KeyboardLift scrollRef={{ current: { scrollResponderScrollNativeHandleToKeyboard: scrollTo } }}>
      <Text testID="lifted">x</Text>
    </KeyboardLift>,
  );
  expect(paddingOf(screen)).toBe(276);
  act(() => { jest.runAllTimers(); });
  expect(scrollTo).toHaveBeenCalledWith(field, expect.any(Number), true);
  focused.mockRestore();
});
