// A caption with tappable #hashtags (→ tag page) and @mentions (→ profile).
//
// Nested <Text> rather than separate views, so it still wraps, truncates with
// numberOfLines and scales with the user's font size exactly like the plain
// caption it replaces. `prefix` renders before the caption in the same line
// (the author's name on the post detail screen).
import React, { memo, useMemo } from 'react';
import { Text, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { parseRichText } from '../utils/richText';
import { colors } from '../constants/theme';

const RichCaption = ({ text, style, numberOfLines, prefix = null, linkStyle }) => {
  const navigation = useNavigation();
  const parts = useMemo(() => parseRichText(text || ''), [text]);

  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {prefix}
      {parts.map((p, i) => {
        if (p.type === 'text') return p.text;
        const onPress = p.type === 'hashtag'
          ? () => navigation.navigate('Hashtag', { tag: p.value })
          : () => navigation.navigate('UserProfile', { username: p.value });
        return (
          <Text
            key={i}
            style={[styles.link, linkStyle]}
            onPress={onPress}
            suppressHighlighting
            accessibilityRole="link"
          >
            {p.text}
          </Text>
        );
      })}
    </Text>
  );
};

const styles = StyleSheet.create({
  link: { color: colors.primary, fontWeight: '700' },
});

export default memo(RichCaption);
