// A full-screen dark sheet with a close button and a title — the frame the
// create screen's pickers (sound, trims, cover, drafts) open in.
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Feather } from '@expo/vector-icons';
import { colors, spacing } from '../constants/theme';

const FullSheet = ({ visible, title, onClose, children, gestures = false, right = null }) => {
  const body = (
    <View style={styles.root}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={10} style={styles.icon}>
            <Feather name="x" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          <View style={styles.icon}>{right}</View>
        </View>
        {children}
      </SafeAreaView>
    </View>
  );
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      {/* A Modal is its own native window, outside the app-root
          GestureHandlerRootView, so pan gestures inside need their own. */}
      {gestures ? <GestureHandlerRootView style={styles.safe}>{body}</GestureHandlerRootView> : body}
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  safe: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, marginBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.10)',
  },
  icon: { minWidth: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', color: colors.textPrimary, fontSize: 18, fontWeight: '800' },
});

export default FullSheet;
