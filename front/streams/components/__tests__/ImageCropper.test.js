/**
 * The crop editor: every shape from 9:16 to 16:9, opening on the one that
 * keeps the most of the picture, and a tall frame that still fits the screen.
 */
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';

jest.setTimeout(20000);

const mockManipulate = jest.fn(async (uri, actions) => {
  const crop = actions[0].crop;
  return { uri: 'file://cropped.jpg', width: crop.width, height: crop.height };
});
jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: (...a) => mockManipulate(...a),
  SaveFormat: { JPEG: 'jpeg' },
}));
jest.mock('@react-native-community/slider', () => () => null);
jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));
jest.mock('../../context/I18nContext', () => ({ useI18n: () => ({ t: (k) => k }) }));

const { default: ImageCropper, ASPECTS, closestAspect } = require('../ImageCropper');

beforeEach(() => mockManipulate.mockClear());

test('offers every shape, tallest to widest', () => {
  expect(ASPECTS.map((a) => a.key)).toEqual(['9:16', '2:3', '3:4', '4:5', '1:1', '16:9']);
});

test('a picture opens on the shape nearest its own', () => {
  expect(closestAspect(1080, 1920)).toBe('9:16');   // phone screenshot / story
  expect(closestAspect(2000, 3000)).toBe('2:3');    // DSLR portrait
  expect(closestAspect(3024, 4032)).toBe('3:4');    // phone camera portrait
  expect(closestAspect(1080, 1350)).toBe('4:5');
  expect(closestAspect(1000, 1000)).toBe('1:1');
  expect(closestAspect(4032, 3024)).toBe('1:1');    // 4:3 landscape: square is nearer than 16:9
  expect(closestAspect(1920, 1080)).toBe('16:9');
  expect(closestAspect(0, 0)).toBe('4:5');          // unknown size
});

const open = (w, h) => render(
  <ImageCropper visible uri="file://photo.jpg" imageWidth={w} imageHeight={h}
                onCancel={jest.fn()} onCropped={jest.fn()} />,
);

test('a phone-camera portrait opens on 3:4 and crops the whole width, 3:4', async () => {
  const onCropped = jest.fn();
  const screen = render(
    <ImageCropper visible uri="file://photo.jpg" imageWidth={3024} imageHeight={4032}
                  onCancel={jest.fn()} onCropped={onCropped} />,
  );
  expect(screen.getByTestId('aspect-3:4').props.accessibilityState).toEqual({ selected: true });
  await act(async () => { fireEvent.press(screen.getByText('common.done')); });
  const { crop } = mockManipulate.mock.calls[0][1][0];
  expect(crop.width / crop.height).toBeCloseTo(3 / 4, 2);
  expect(crop.width).toBe(3024);                     // nothing lost: the whole photo
  expect(onCropped).toHaveBeenCalled();
});

test('picking 9:16 crops a 9:16 piece', async () => {
  const screen = open(3024, 4032);
  fireEvent.press(screen.getByTestId('aspect-9:16'));
  await act(async () => { fireEvent.press(screen.getByText('common.done')); });
  const { crop } = mockManipulate.mock.calls[0][1][0];
  expect(crop.width / crop.height).toBeCloseTo(9 / 16, 2);
  expect(crop.height).toBe(4032);                    // full height, sides trimmed
});

test('a tall frame is kept inside the screen (narrower, same shape)', () => {
  const screen = open(1080, 1920);
  const frame = screen.UNSAFE_root.findAll(
    (n) => n.props?.style && Array.isArray(n.props.style)
      && n.props.style.some((s) => s && s.width && s.height && s.overflow === undefined && s.borderRadius === undefined)
      && n.props.onStartShouldSetResponder,
  )[0];
  const { width, height } = Object.assign({}, ...frame.props.style.filter(Boolean));
  // The test screen is 750 x 1334: room for the frame is 1334 - 300.
  expect(height).toBeLessThanOrEqual(1334 - 300 + 1);
  expect(width / height).toBeCloseTo(9 / 16, 2);
});
