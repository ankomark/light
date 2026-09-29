/**
 * The Android home-screen verse widget: what it draws, where a tap goes, how
 * it refreshes on its own, and that the app hands it the words it showed.
 */
import React from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const mockUpdate = jest.fn(async () => {});
jest.mock('react-native-android-widget', () => ({
  FlexWidget: 'FlexWidget',
  TextWidget: 'TextWidget',
  requestWidgetUpdate: (...a) => mockUpdate(...a),
}));
const mockFetch = jest.fn();
jest.mock('../../services/api', () => ({ fetchDailyVerse: (...a) => mockFetch(...a) }));
const mockTranslate = jest.fn();
jest.mock('../../utils/dailyVerseText', () => ({ translateVerse: (...a) => mockTranslate(...a) }));

const { default: DailyVerseWidget, WIDGET_URI, EMPTY_WIDGET } = require('../DailyVerseWidget');
const { readWidgetVerse, refreshWidgetVerse, publishWidgetVerse } = require('../verseWidgetStore');
const widgetTaskHandler = require('../widgetTaskHandler').default;

const server = {
  date: '2026-09-29', book: 'Psalms', chapter: 23, verse: 1, reference: 'Psalms 23:1',
  text: 'The LORD is my shepherd; I shall not want.',
};
const shown = { ...server, versionId: 'eng_kjv', title: 'Verse of the day' };

// The widget JSX, flattened: every TextWidget's text, and the root's props.
const texts = (el) => React.Children.toArray(el.props.children).map((c) => c.props.text);

let originalOS;
beforeEach(async () => {
  originalOS = Platform.OS;
  Platform.OS = 'android';
  mockUpdate.mockClear();
  mockFetch.mockReset();
  mockTranslate.mockReset();
  await AsyncStorage.clear();
});
afterEach(() => { Platform.OS = originalOS; });

describe('the widget', () => {
  test('shows the title, the verse in quotes and the reference, and opens the verse screen', () => {
    const el = DailyVerseWidget({ verse: shown });
    expect(texts(el)).toEqual(['VERSE OF THE DAY', '“The LORD is my shepherd; I shall not want.”', 'Psalms 23:1']);
    expect(el.props.clickAction).toBe('OPEN_URI');
    expect(el.props.clickActionData).toEqual({ uri: WIDGET_URI });
    expect(WIDGET_URI).toBe('streams://daily-verse');
  });

  test('before any verse is known, it says where to tap', () => {
    const el = DailyVerseWidget({ verse: null });
    expect(texts(el)[1]).toBe(EMPTY_WIDGET.text);
  });

  test('a taller widget has room for more lines', () => {
    const verseLine = (h) => React.Children.toArray(DailyVerseWidget({ verse: shown, height: h }).props.children)[1];
    expect(verseLine(110).props.maxLines).toBe(4);
    expect(verseLine(200).props.maxLines).toBe(7);
    expect(verseLine(110).props.truncate).toBe('END');
  });
});

describe('refreshing on its own', () => {
  test('asks the server as the widget, so it is not a streak visit', async () => {
    mockFetch.mockResolvedValue(server);
    const out = await refreshWidgetVerse();
    expect(mockFetch).toHaveBeenCalledWith(null, { via: 'widget' });
    expect(out).toEqual(expect.objectContaining({ text: server.text, reference: 'Psalms 23:1', versionId: 'eng_kjv' }));
    expect(await readWidgetVerse()).toEqual(out);
  });

  test('a new day comes in the version the app last used', async () => {
    await publishWidgetVerse({ ...shown, date: '2026-09-28', versionId: 'swh_bib', text: 'Jana', reference: 'Jana · NENO', title: 'Mstari wa siku' });
    mockFetch.mockResolvedValue(server);
    mockTranslate.mockResolvedValue({ text: 'Bwana ndiye mchungaji wangu', reference: 'Zaburi 23:1', abbr: 'NENO' });
    const out = await refreshWidgetVerse();
    expect(mockTranslate).toHaveBeenCalledWith(server, 'swh_bib');
    expect(out).toEqual(expect.objectContaining({
      text: 'Bwana ndiye mchungaji wangu', reference: 'Zaburi 23:1 · NENO', title: 'Mstari wa siku',
    }));
  });

  test('offline or signed out, the last verse stays up', async () => {
    await publishWidgetVerse(shown);
    mockFetch.mockRejectedValue(new Error('401'));
    expect(await refreshWidgetVerse()).toEqual(shown);
  });

  test('already showing today: nothing is redone', async () => {
    await publishWidgetVerse(shown);
    mockFetch.mockResolvedValue(server);
    expect(await refreshWidgetVerse()).toEqual(shown);
    expect(mockTranslate).not.toHaveBeenCalled();
  });
});

describe('the app hands it what it showed', () => {
  test('saves the verse and redraws the widget', async () => {
    await publishWidgetVerse(shown);
    expect(await readWidgetVerse()).toEqual(shown);
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ widgetName: 'DailyVerse' }));
    const drawn = await mockUpdate.mock.calls[0][0].renderWidget({ height: 120 });
    expect(drawn.props.verse).toEqual(shown);
  });

  test('the same verse twice does not redraw', async () => {
    await publishWidgetVerse(shown);
    await publishWidgetVerse({ ...shown });
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  test('not on iOS or the web: there is no widget there', async () => {
    Platform.OS = 'ios';
    await publishWidgetVerse(shown);
    expect(await readWidgetVerse()).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe('the task Android runs', () => {
  const info = { widgetName: 'DailyVerse', height: 120 };

  test('draws what is kept at once, then the fresh verse', async () => {
    await publishWidgetVerse({ ...shown, date: '2026-09-28', text: 'Yesterday' });
    mockFetch.mockResolvedValue(server);
    const renderWidget = jest.fn();
    await widgetTaskHandler({ widgetInfo: info, widgetAction: 'WIDGET_UPDATE', renderWidget });
    expect(renderWidget).toHaveBeenCalledTimes(2);
    expect(renderWidget.mock.calls[0][0].props.verse.text).toBe('Yesterday');
    expect(renderWidget.mock.calls[1][0].props.verse.text).toBe(server.text);
  });

  test('offline, the kept verse is drawn once and left', async () => {
    await publishWidgetVerse(shown);
    mockFetch.mockRejectedValue(new Error('offline'));
    const renderWidget = jest.fn();
    await widgetTaskHandler({ widgetInfo: info, widgetAction: 'WIDGET_ADDED', renderWidget });
    expect(renderWidget).toHaveBeenCalledTimes(1);
  });

  test('another widget name is not ours', async () => {
    const renderWidget = jest.fn();
    await widgetTaskHandler({ widgetInfo: { widgetName: 'Other' }, widgetAction: 'WIDGET_UPDATE', renderWidget });
    expect(renderWidget).not.toHaveBeenCalled();
  });
});
