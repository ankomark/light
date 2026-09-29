// Android calls this, headless, when the widget is placed, resized, or its
// update period comes round (app.json). Taps need nothing here: the widget's
// OPEN_URI deep link opens the verse screen directly.
import React from 'react';
import DailyVerseWidget, { WIDGET_NAME } from './DailyVerseWidget';
import { readWidgetVerse, refreshWidgetVerse } from './verseWidgetStore';

// Kept and refreshed are read separately, so compare what they say.
const sameWords = (a, b) => !!a && !!b
  && a.date === b.date && a.text === b.text && a.reference === b.reference && a.title === b.title;

export default async function widgetTaskHandler({ widgetInfo, widgetAction, renderWidget }) {
  if (widgetInfo?.widgetName !== WIDGET_NAME) return;
  const height = widgetInfo.height;

  switch (widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE': {
      // Draw what is kept at once, then the refreshed verse if it differs,
      // so a slow network never leaves a blank widget.
      const kept = await readWidgetVerse();
      renderWidget(<DailyVerseWidget verse={kept} height={height} />);
      const fresh = await refreshWidgetVerse();
      if (fresh && !sameWords(fresh, kept)) renderWidget(<DailyVerseWidget verse={fresh} height={height} />);
      break;
    }
    case 'WIDGET_RESIZED':
      renderWidget(<DailyVerseWidget verse={await readWidgetVerse()} height={height} />);
      break;
    default:
      break;
  }
}
