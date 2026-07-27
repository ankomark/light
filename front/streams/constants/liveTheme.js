/**
 * Live feature design tokens — "champagne gold on deep navy".
 *
 * A small, self-contained palette + material system shared by LiveHub,
 * LiveRoom and GoLive so the whole Live surface reads as one premium look.
 * Gold is the single accent and is reserved for live / active / premium
 * states; red stays for LIVE dots and reactions. Keep this separate from the
 * app-wide `constants/theme` (which is light/dark aware) — Live is a deliberate
 * single dark world.
 */
export const live = {
  // Grounds
  bg: '#060D1A',          // near-black navy — the base
  bg2: '#091426',
  navy: '#0E2A4A',        // solid navy surface
  navyGlass: 'rgba(16,46,80,0.42)',   // over a BlurView / wallpaper

  // Champagne gold accent scale
  gold: '#E8C583',
  goldBright: '#F4D9A0',
  goldDeep: '#C9A25E',
  onGold: '#2A1C05',      // ink that sits on a gold fill

  // Hairline / borders
  hair: 'rgba(232,197,131,0.28)',
  hairSoft: 'rgba(255,255,255,0.10)',

  // Text
  ink: '#F5F1E8',
  inkDim: '#9FB2C6',
  inkMute: '#61738C',

  // Semantic (kept apart from the gold accent)
  live: '#E5484A',

  // Gradients (arrays for expo-linear-gradient `colors`)
  gradCta: ['#F4D9A0', '#C9A25E'],
  gradHero: ['rgba(6,13,26,0.35)', 'transparent', 'rgba(6,13,26,0.92)'],
  gradTile: ['transparent', 'rgba(6,13,26,0.90)'],
  gradScrimTop: ['rgba(6,13,26,0.90)', 'rgba(6,13,26,0.30)', 'transparent'],
};

// Soft gold glow for live / active elements (iOS shadow + Android elevation).
export const goldGlow = {
  shadowColor: '#E8C583',
  shadowOpacity: 0.55,
  shadowRadius: 18,
  shadowOffset: { width: 0, height: 8 },
  elevation: 10,
};

// Compact viewer-count formatter: 1284 -> "1.3k".
export const fmtCount = (n) => {
  const v = Number(n) || 0;
  if (v >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(v);
};
