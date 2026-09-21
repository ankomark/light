// Shared responsive layout rules.
//
// The feed already capped itself to a centered 600px column on wide screens,
// but that rule lived inside SocialFeed, so the music library, the mini player
// and everything else stretched edge-to-edge on a tablet: a 60px cover art and
// a title floating in 500px of empty space. Same app, two different ideas about
// what a wide screen means.
//
// These are hooks, not constants, so every consumer reflows on rotation, split
// screen, foldables and web resize instead of reading one value at import time.
import { useWindowDimensions } from 'react-native';

/** Widest a single reading column is allowed to get. Past this, lines get long
 *  and media gets gratuitously large, so we centre instead of stretching. */
export const MAX_CONTENT_W = 600;

/** Below this the device is a phone: use every pixel. */
export const TABLET_MIN_W = 700;

/**
 * Width for a centered content column, and the side margin that centres it.
 *
 * `gutter` is the total horizontal margin to subtract on a phone (both sides).
 * Returns { width, sideMargin, isWide } — spread `sideMargin` into a container's
 * marginHorizontal and the column sits centred on a tablet, unchanged on a phone.
 */
export const useContentWidth = ({ gutter = 24, max = MAX_CONTENT_W } = {}) => {
  const { width } = useWindowDimensions();
  const target = Math.min(width - gutter, max);
  return {
    width: target,
    sideMargin: Math.max(0, Math.floor((width - target) / 2)),
    isWide: width >= TABLET_MIN_W,
  };
};

/** True on tablet-class widths. For layout choices that aren't just a width —
 *  a second column, a denser row, a bigger tap target. */
export const useIsWideScreen = () => useWindowDimensions().width >= TABLET_MIN_W;

/**
 * Tallest a feed post's media may be, as a fraction of the window height.
 *
 * A post's media is sized from its own aspect ratio, which is right — an image
 * should show uncropped, the way it was uploaded. But an extreme portrait on a
 * short viewport (a tablet in landscape, a phone in split screen, a foldable's
 * cover display) could run to several screens tall for ONE post, so scrolling
 * the feed stopped feeling like a feed. Capping at 85% guarantees at least a
 * sliver of the next post is always visible, which is what tells the eye the
 * feed continues.
 */
export const useMaxMediaHeight = (fraction = 0.85) => {
  const { height } = useWindowDimensions();
  return Math.round(height * fraction);
};

// ── Font scaling ─────────────────────────────────────────────────────────────
// The system font size is an accessibility setting and content must honour it:
// captions, lyrics, comments and post text all scale freely.
//
// UI furniture is different. A like count, a tab label or a duration inside a
// fixed-height pill has nowhere to grow, so at a 2x system font it doesn't
// become readable — it becomes clipped, or it pushes the row apart and breaks
// the layout. These caps let chrome grow enough to help without breaking, and
// are deliberately NOT applied to anything the user wrote.
export const FONT_SCALE = {
  /** Counters, badges, durations — tight, fixed-size containers. */
  tight: 1.2,
  /** Labels, tabs, buttons, usernames — some room, still bounded. */
  chrome: 1.4,
};
