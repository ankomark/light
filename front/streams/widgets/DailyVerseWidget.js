// The verse of the day on the Android home screen: the screen's teal and
// gold, the verse, its reference. A tap opens the verse screen itself.
//
// Drawn by react-native-android-widget, which turns this JSX into a native
// RemoteViews layout — so only its own Flex/Text widgets, no RN components.
// Fonts are the app's, bundled for the widget in app.json.
import React from 'react';
import { FlexWidget, TextWidget } from 'react-native-android-widget';

export const WIDGET_NAME = 'DailyVerse';
export const WIDGET_URI = 'streams://daily-verse';

const TEAL = '#004B51';
const PARCHMENT = '#F2EFE6';
const GOLD_SOFT = '#E3C46A';

// Before the app has ever shown a verse (or with nobody signed in), the
// widget still says what it is and where tapping goes.
export const EMPTY_WIDGET = {
  title: 'Verse of the day',
  text: 'Open Adventist Life to see today’s verse.',
  reference: '',
};

// A home screen is small: long verses step down rather than being cut off
// mid-sentence, and a very long one is cut with an ellipsis at the end.
const sizeFor = (text, height) => {
  const roomy = height >= 160;
  if (text.length > 210) return roomy ? 13 : 12;
  if (text.length > 130) return roomy ? 14.5 : 13;
  return roomy ? 17 : 15;
};

export default function DailyVerseWidget({ verse, height = 110 }) {
  const shown = verse?.text ? verse : EMPTY_WIDGET;
  const size = sizeFor(shown.text, height);
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: WIDGET_URI }}
      accessibilityLabel={[shown.title, shown.text, shown.reference].filter(Boolean).join('. ')}
      style={{
        height: 'match_parent', width: 'match_parent',
        flexDirection: 'column', justifyContent: 'space-between',
        backgroundColor: TEAL, borderRadius: 22,
        paddingHorizontal: 16, paddingVertical: 12,
      }}
    >
      <TextWidget
        text={(shown.title || EMPTY_WIDGET.title).toUpperCase()}
        style={{ fontFamily: 'Cinzel_700Bold', fontSize: 10, letterSpacing: 0.15, color: GOLD_SOFT }}
      />
      <TextWidget
        text={verse?.text ? `“${shown.text}”` : shown.text}
        maxLines={height >= 160 ? 7 : 4}
        truncate="END"
        style={{ fontFamily: 'Lora_400Regular', fontSize: size, color: PARCHMENT }}
      />
      <TextWidget
        text={shown.reference || ' '}
        style={{ fontFamily: 'Cinzel_700Bold', fontSize: 11.5, color: GOLD_SOFT, textAlign: 'right' }}
      />
    </FlexWidget>
  );
}
