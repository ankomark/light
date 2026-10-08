/**
 * More reactions than the heart (TikTok-style): a long press on the heart
 * opens this row; a tap sends that emoji floating up for everyone.
 *
 * REACTIONS is also the list the room accepts from others - an "emoji" in a
 * message is drawn only if it is one of these, never any text sent.
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { live } from '../../constants/liveTheme';

export const REACTIONS = ['❤️', '🙏', '🔥', '👏', '🎉', '😂'];

const ReactionTray = ({ visible, onPick, onClose, bottom = 80 }) => {
  if (!visible) return null;
  return (
    <>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} testID="reaction-tray-close" />
      <View style={[styles.tray, { bottom }]} testID="reaction-tray">
        {REACTIONS.map((e) => (
          <TouchableOpacity key={e} onPress={() => onPick(e)} style={styles.item} hitSlop={6}
            accessibilityRole="button" accessibilityLabel={e} testID={`react-${e}`}>
            <Text style={styles.emoji}>{e}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </>
  );
};

const styles = StyleSheet.create({
  tray: {
    position: 'absolute', left: 16, flexDirection: 'row', gap: 4, padding: 6, zIndex: 10,
    borderRadius: 999, backgroundColor: 'rgba(10,27,51,0.94)', borderWidth: 1, borderColor: live.hair,
  },
  item: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 26 },
});

export default ReactionTray;
