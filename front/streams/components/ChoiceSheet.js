// A compact glass action sheet: a small frosted card near the bottom with a
// title and a few icon rows. Used where the system Alert is too big and can't
// be themed (e.g. the download choice on a song).
import React from 'react';
import { Modal, Pressable, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { initialWindowMetrics } from 'react-native-safe-area-context';
import GlassView from './GlassView';
import { colors, radius, spacing } from '../constants/theme';

/**
 * options: [{ key, label, icon (MaterialIcons name), destructive?, onPress }]
 */
const ChoiceSheet = ({ visible, title, subtitle, options = [], onClose, cancelLabel }) => {
  // A Modal sits outside the navigator's safe-area context, so read the
  // device's inset directly to keep the card off the home indicator.
  const bottom = (initialWindowMetrics?.insets?.bottom ?? 0) + spacing.sm;

  const choose = (opt) => {
    onClose();
    // Let the sheet start closing before the action (which may open a
    // system dialog or share sheet) takes over.
    setTimeout(() => opt.onPress?.(), 180);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.wrap, { paddingBottom: bottom }]} onPress={() => {}}>
          <GlassView intensity={45} tint="dark" style={styles.card}>
            <View style={styles.handle} />
            {!!title && <Text style={styles.title} numberOfLines={1}>{title}</Text>}
            {!!subtitle && <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>}
            <View style={styles.options}>
              {options.map((opt) => (
                <TouchableOpacity key={opt.key} style={styles.row} activeOpacity={0.75} onPress={() => choose(opt)}>
                  <View style={[styles.icon, opt.destructive && styles.iconDanger]}>
                    <MaterialIcons name={opt.icon} size={18} color={opt.destructive ? colors.error : colors.primary} />
                  </View>
                  <Text style={[styles.label, opt.destructive && styles.labelDanger]} numberOfLines={1}>{opt.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {!!cancelLabel && (
              <TouchableOpacity style={styles.cancel} onPress={onClose} activeOpacity={0.75}>
                <Text style={styles.cancelText}>{cancelLabel}</Text>
              </TouchableOpacity>
            )}
          </GlassView>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  wrap: { paddingHorizontal: spacing.md },
  card: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    borderRadius: radius.xl,
    overflow: 'hidden',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
    // The glass: translucent navy (all Android sees; iOS blurs behind it too)
    // with a hairline light edge.
    backgroundColor: 'rgba(16,34,60,0.82)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  handle: {
    alignSelf: 'center', width: 36, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.22)', marginBottom: spacing.sm,
  },
  title: { color: colors.textPrimary, fontSize: 15, fontWeight: '800', textAlign: 'center' },
  subtitle: { color: colors.textSecondary, fontSize: 12.5, textAlign: 'center', marginTop: 2 },
  options: { marginTop: spacing.sm, gap: 2 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: 10, paddingHorizontal: spacing.xs, borderRadius: radius.md,
  },
  icon: {
    width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(29,161,242,0.16)',
  },
  iconDanger: { backgroundColor: 'rgba(229,57,53,0.16)' },
  label: { flex: 1, color: colors.textPrimary, fontSize: 14.5, fontWeight: '600' },
  labelDanger: { color: colors.error },
  cancel: {
    marginTop: spacing.xs, paddingVertical: 10, alignItems: 'center', borderRadius: radius.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.10)',
  },
  cancelText: { color: colors.textSecondary, fontSize: 14, fontWeight: '700' },
});

export default ChoiceSheet;
