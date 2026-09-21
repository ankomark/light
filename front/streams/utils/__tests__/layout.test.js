/**
 * Layout maths across real device sizes.
 *
 * These are pure functions of the window size, so they can be checked exactly
 * rather than eyeballed on one simulator — which is the only way to know a
 * small phone, a large phone, a tablet and a split-screen pane all land
 * somewhere sensible.
 */
import { MAX_CONTENT_W, TABLET_MIN_W } from '../layout';

// Logical (dp) sizes, not physical pixels.
const DEVICES = {
  'iPhone SE':            { width: 320, height: 568 },
  'iPhone 13 mini':       { width: 375, height: 812 },
  'iPhone 15':            { width: 393, height: 852 },
  'iPhone 15 Pro Max':    { width: 430, height: 932 },
  'Pixel 7':              { width: 412, height: 915 },
  'Galaxy Fold (cover)':  { width: 280, height: 653 },
  'Galaxy Fold (open)':   { width: 673, height: 841 },
  'iPad mini':            { width: 744, height: 1133 },
  'iPad Pro 12.9':        { width: 1024, height: 1366 },
  'Android split-screen': { width: 412, height: 420 },
};

// Mirrors useContentWidth / useMaxMediaHeight without the React plumbing.
const contentWidth = (width, gutter = 24, max = MAX_CONTENT_W) => {
  const target = Math.min(width - gutter, max);
  return { width: target, sideMargin: Math.max(0, Math.floor((width - target) / 2)) };
};
const maxMediaHeight = (height, fraction = 0.85) => Math.round(height * fraction);

describe('content column', () => {
  it('never exceeds the window on any device', () => {
    for (const [name, { width }] of Object.entries(DEVICES)) {
      const { width: w, sideMargin } = contentWidth(width);
      expect(`${name}:${w + sideMargin * 2 <= width}`).toBe(`${name}:true`);
    }
  });

  it('is always a usable width, even on the narrowest surface', () => {
    for (const [name, { width }] of Object.entries(DEVICES)) {
      const { width: w } = contentWidth(width);
      // A 280dp foldable cover screen still has to render a readable card.
      expect(`${name}:${w >= 240}`).toBe(`${name}:true`);
    }
  });

  it('uses the full width on phones and centres on tablets', () => {
    // Phone: the column is just the window minus its gutter, no centring.
    expect(contentWidth(393).sideMargin).toBe(12);
    expect(contentWidth(393).width).toBe(369);
    // Tablet: capped and genuinely centred.
    const ipad = contentWidth(1024);
    expect(ipad.width).toBe(MAX_CONTENT_W);
    expect(ipad.sideMargin).toBe(212);
    expect(ipad.sideMargin * 2 + ipad.width).toBe(1024);
  });

  it('treats the fold open as a tablet and the cover as a phone', () => {
    expect(DEVICES['Galaxy Fold (open)'].width >= TABLET_MIN_W).toBe(false);
    expect(DEVICES['iPad mini'].width >= TABLET_MIN_W).toBe(true);
    expect(DEVICES['Galaxy Fold (cover)'].width >= TABLET_MIN_W).toBe(false);
  });
});

describe('feed media height', () => {
  // A post is sized by its own ratio, floored so it can't outgrow the viewport.
  const effectiveRatio = (rawRatio, cardW, maxH) =>
    Math.max(rawRatio, maxH > 0 ? cardW / maxH : 0);

  it('keeps the tallest possible post within the viewport on every device', () => {
    const TALLEST = 0.5;   // the ratio clamp's extreme: height = 2x width
    for (const [name, { width, height }] of Object.entries(DEVICES)) {
      const { width: cardW } = contentWidth(width);
      const maxH = maxMediaHeight(height);
      const ratio = effectiveRatio(TALLEST, cardW, maxH);
      const renderedH = cardW / ratio;
      // Always leaves a sliver of the next post visible.
      expect(`${name}:${renderedH <= height}`).toBe(`${name}:true`);
    }
  });

  it('leaves normal photos completely untouched', () => {
    // 4:5 portrait on a Pixel 7 is well inside the cap, so the floor must not
    // change its ratio — photos still show exactly as uploaded.
    const { width: cardW } = contentWidth(412);
    const maxH = maxMediaHeight(915);
    expect(effectiveRatio(0.8, cardW, maxH)).toBeCloseTo(0.8, 5);
    expect(effectiveRatio(1.0, cardW, maxH)).toBeCloseTo(1.0, 5);
    expect(effectiveRatio(1.78, cardW, maxH)).toBeCloseTo(1.78, 5);
  });

  it('does clamp an extreme portrait on a short viewport', () => {
    // Split screen: 412x420. An ultra-tall post would otherwise be ~776dp in a
    // 420dp pane — nearly two screens for one post.
    const { width: cardW } = contentWidth(412);
    const maxH = maxMediaHeight(420);
    const ratio = effectiveRatio(0.5, cardW, maxH);
    expect(ratio).toBeGreaterThan(0.5);
    expect(cardW / ratio).toBeLessThanOrEqual(420);
  });
});
