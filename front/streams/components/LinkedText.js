// Text whose web addresses can be tapped (a notice's "register at
// https://…" opens it). Everything else is plain, selectable text.
import React from 'react';
import { Text, Linking } from 'react-native';
import { colors } from '../constants/theme';

const URL = /(https?:\/\/[^\s<>"')]+|www\.[^\s<>"')]+)/gi;

/** Text in pieces, the addresses marked (trailing punctuation left out). */
export function splitLinks(text) {
  const s = String(text || '');
  const parts = [];
  let last = 0;
  s.replace(URL, (match, _g, at) => {
    const clean = match.replace(/[.,;:!?]+$/, '');
    if (at > last) parts.push({ text: s.slice(last, at) });
    parts.push({ text: clean, url: /^https?:/i.test(clean) ? clean : `https://${clean}` });
    last = at + clean.length;
    return match;
  });
  if (last < s.length) parts.push({ text: s.slice(last) });
  return parts.length ? parts : [{ text: s }];
}

const LinkedText = ({ children, style, linkStyle, ...rest }) => (
  <Text style={style} selectable {...rest}>
    {splitLinks(children).map((p, i) => (p.url ? (
      <Text key={i} style={[{ color: colors.accent, textDecorationLine: 'underline' }, linkStyle]}
        onPress={() => Linking.openURL(p.url).catch(() => {})} accessibilityRole="link">
        {p.text}
      </Text>
    ) : p.text))}
  </Text>
);

export default LinkedText;
