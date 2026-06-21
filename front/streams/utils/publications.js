import React, { useState, useEffect } from 'react';
import { Platform, View, Image } from 'react-native';
import { colors, spacing } from '../constants/theme';

// react-native-markdown-display renders <Image> with no intrinsic size, so a
// data-URI image collapses to 0×0 (invisible). This rule measures the available
// width and derives the height from the image's real aspect ratio.
const MarkdownImage = ({ uri }) => {
  const [w, setW] = useState(0);
  const [aspect, setAspect] = useState(1.6);
  useEffect(() => {
    let alive = true;
    if (uri) {
      Image.getSize(uri, (iw, ih) => { if (alive && iw && ih) setAspect(iw / ih); }, () => {});
    }
    return () => { alive = false; };
  }, [uri]);
  if (!uri) return null;
  return (
    <View style={{ width: '100%' }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w > 0 && (
        <Image
          source={{ uri }}
          style={{ width: w, height: w / aspect, borderRadius: 10, marginVertical: spacing.sm, backgroundColor: 'rgba(127,127,127,0.12)' }}
          resizeMode="cover"
        />
      )}
    </View>
  );
};

// Pass to <Markdown rules={markdownImageRule}> so inline images actually show.
export const markdownImageRule = {
  image: (node) => <MarkdownImage key={node.key} uri={node.attributes?.src} />,
};

// ── Inline-image tokenisation ────────────────────────────────────────────────
// A base64 data URI is hundreds of KB on one unbreakable line; dropping that
// into the editable TextInput freezes/crashes RN's text layout. So in the
// editor we keep a short `img://<id>` token in the text and stash the real data
// URI in a side map — expanding back to the full URI only for preview and save.
let _imgSeq = 0;
const newImgId = () => `i${Date.now().toString(36)}${(_imgSeq++).toString(36)}`;

// Pull any full data-URI images out of a body → short tokens + {id: dataUri}.
export const extractInlineImages = (body = '') => {
  const images = {};
  const out = body.replace(/!\[([^\]]*)\]\((data:[^)\s]+)\)/g, (_m, alt, uri) => {
    const id = newImgId();
    images[id] = uri;
    return `![${alt}](img://${id})`;
  });
  return { body: out, images };
};

// Append a freshly-picked image as a token; returns { body, images }.
export const appendInlineImage = (body = '', images = {}, dataUri) => {
  const id = newImgId();
  return {
    body: `${body}${body && !body.endsWith('\n') ? '\n\n' : ''}![image](img://${id})\n\n`,
    images: { ...images, [id]: dataUri },
  };
};

// Expand `img://<id>` tokens back to their data URIs (for preview / saving).
export const expandInlineImages = (body = '', images = {}) =>
  body.replace(/!\[([^\]]*)\]\(img:\/\/([^)\s]+)\)/g, (m, alt, id) =>
    (images[id] ? `![${alt}](${images[id]})` : m));

// ── Writing look presets (author-chosen background / font / text colour) ──────
// Each background ships a sensible default text colour; the author can override.
export const WRITING_BGS = [
  { key: 'night', label: 'Night', bg: '#0A1628', text: '#E8ECF3' },
  { key: 'ivory', label: 'Ivory', bg: '#F7F3EA', text: '#2B2A26' },
  { key: 'sepia', label: 'Sepia', bg: '#E8D9C0', text: '#3A2E20' },
  { key: 'slate', label: 'Slate', bg: '#1B2430', text: '#DCE3EC' },
  { key: 'forest', label: 'Forest', bg: '#0F231C', text: '#E3F0E8' },
  { key: 'royal', label: 'Royal', bg: '#15173A', text: '#E8E9FF' },
  { key: 'rose', label: 'Rose', bg: '#2A1620', text: '#F6E1EA' },
];

export const WRITING_TEXT_COLORS = [
  '#E8ECF3', '#FFFFFF', '#2B2A26', '#3A2E20',
  '#F4A261', '#FFD7A8', '#9CC4FF', '#C8E6C9', '#F6E1EA', '#B0BEC5',
];

export const WRITING_FONTS = [
  { key: 'system', label: 'Sans', family: undefined },
  { key: 'serif', label: 'Serif', family: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }) },
  { key: 'cinzel', label: 'Cinzel', family: 'Cinzel_700Bold' },
  { key: 'mono', label: 'Mono', family: Platform.select({ ios: 'Courier New', android: 'monospace', default: 'monospace' }) },
];

export const DEFAULT_WRITING_THEME = { bg: '#0A1628', text: '#E8ECF3', font: 'system', scale: 0 };

export const fontFamilyFor = (key) =>
  WRITING_FONTS.find((f) => f.key === key)?.family;

// Merge a stored (possibly empty) theme with defaults.
export const resolveWritingTheme = (theme) => ({ ...DEFAULT_WRITING_THEME, ...(theme || {}) });

// True for light backgrounds — used to flip UI chrome (icons/borders) to dark.
export const isLightBg = (hex) => {
  const h = (hex || '').replace('#', '');
  if (h.length < 6) return false;
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150;
};

export const CATEGORIES = [
  { key: 'devotional', label: 'Devotional' },
  { key: 'doctrine', label: 'Doctrine' },
  { key: 'testimony', label: 'Testimony' },
  { key: 'health', label: 'Health' },
  { key: 'prophecy', label: 'Prophecy' },
  { key: 'family', label: 'Family' },
  { key: 'history', label: 'History' },
  { key: 'other', label: 'Other' },
];

export const categoryLabel = (key) =>
  CATEGORIES.find((c) => c.key === key)?.label || 'Other';

// Themed style map for react-native-markdown-display. `fontSize` scales the
// reading body; `opts.color` / `opts.fontFamily` apply the author's writing
// theme (text colour + font style) so the editor preview and reader match.
export const markdownTheme = (fontSize = 17, opts = {}) => {
  const color = opts.color || colors.textPrimary;
  const fam = opts.fontFamily ? { fontFamily: opts.fontFamily } : {};
  const line = Math.round(fontSize * 1.7);
  const subtle = `${color}99`; // translucent variant for quote/code chrome
  return {
    body: { color, fontSize, lineHeight: line, ...fam },
    heading1: { color, fontSize: fontSize + 11, fontWeight: '800', marginTop: spacing.lg, marginBottom: spacing.sm, ...fam },
    heading2: { color, fontSize: fontSize + 7, fontWeight: '700', marginTop: spacing.md, marginBottom: spacing.sm, ...fam },
    heading3: { color, fontSize: fontSize + 3, fontWeight: '700', marginTop: spacing.md, marginBottom: spacing.xs, ...fam },
    paragraph: { color, fontSize, lineHeight: line, marginTop: 0, marginBottom: spacing.md, ...fam },
    strong: { fontWeight: '800', color, ...fam },
    em: { fontStyle: 'italic', color, ...fam },
    link: { color: opts.linkColor || colors.primary, textDecorationLine: 'underline' },
    blockquote: {
      backgroundColor: `${color}14`,
      borderLeftColor: colors.accent,
      borderLeftWidth: 3,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: 6,
      marginBottom: spacing.md,
    },
    bullet_list: { marginBottom: spacing.md },
    ordered_list: { marginBottom: spacing.md },
    list_item: { color, fontSize, lineHeight: line, ...fam },
    code_inline: { backgroundColor: `${color}1A`, color: colors.accent, paddingHorizontal: 4, borderRadius: 4 },
    code_block: { backgroundColor: `${color}14`, color, padding: spacing.md, borderRadius: 8 },
    fence: { backgroundColor: `${color}14`, color, padding: spacing.md, borderRadius: 8 },
    hr: { backgroundColor: subtle, height: 1, marginVertical: spacing.md },
    image: { borderRadius: 10, marginVertical: spacing.sm },
    table: { borderColor: subtle },
    th: { color },
    td: { color, borderColor: subtle },
  };
};
