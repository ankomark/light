// Dark palette — the app's original look. `colors` keeps pointing here so the
// many components that import it statically are unaffected; theme-aware screens
// read the active palette via useTheme() instead.
export const darkColors = {
  primary: '#1DA1F2',
  primaryDark: '#0d8ecf',
  accent: '#F4A261',

  bg: '#0A1628',
  surface: '#102E50',
  card: '#121E2E',
  inputBg: '#0D2340',

  textPrimary: '#E0E1DD',
  textSecondary: '#A9BCD0',
  textMuted: '#6C757D',
  placeholder: '#8295B5',

  error: '#E53935',
  success: '#43A047',
  warning: '#FB8C00',

  white: '#FFFFFF',
  black: '#000000',
  border: '#1E3A5F',
  overlay: 'rgba(0,0,0,0.6)',
};

// Light palette — same semantic keys, tuned for contrast on light surfaces.
export const lightColors = {
  primary: '#1273B8',
  primaryDark: '#0d5e95',
  accent: '#D9712C',

  bg: '#F5F7FA',
  surface: '#FFFFFF',
  card: '#FFFFFF',
  inputBg: '#EEF2F7',

  textPrimary: '#0A1628',
  textSecondary: '#3A4A5E',
  textMuted: '#6C757D',
  placeholder: '#90A0B5',

  error: '#D32F2F',
  success: '#2E7D32',
  warning: '#EF6C00',

  white: '#FFFFFF',
  black: '#000000',
  border: '#D8E0EA',
  overlay: 'rgba(0,0,0,0.45)',
};

// The profile screen's "Stage" look: near-black, gold for the one action that
// matters (Follow), everything else quiet grey.
export const profileColors = {
  bg: '#06080C',
  raised: '#1B1E24',
  divider: '#262A31',
  text: '#F4F5F7',
  body: '#D5D8DE',
  muted: '#8A909A',
  dim: '#5E646E',
  gold: '#E8C66B',
  onGold: '#1A1406',
};

// Back-compat default export used across the app (dark).
export const colors = darkColors;

// Resolve a palette from a color scheme string.
export const paletteFor = (scheme) => (scheme === 'light' ? lightColors : darkColors);

export const typography = {
  h1: { fontSize: 28, fontWeight: '700' },
  h2: { fontSize: 22, fontWeight: '700' },
  h3: { fontSize: 18, fontWeight: '600' },
  body: { fontSize: 15, fontWeight: '400', lineHeight: 22 },
  caption: { fontSize: 12, fontWeight: '400' },
  label: { fontSize: 14, fontWeight: '500' },
  button: { fontSize: 16, fontWeight: '600' },
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
  xl: 24,
  full: 999,
};

export const shadows = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
};
