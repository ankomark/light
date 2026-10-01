// The admin area's tabs: Pulse, Reports, Users, Content, Appeals and More,
// along the top on a phone (and a narrow window) and as a slim rail down the
// left on a wide screen. Each tab shows only to an admin whose powers cover
// it (the server's word, from AdminGate); every other admin tool sits under
// More. A tab swaps the screen rather than stacking it, so Back leaves admin.
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../../context/I18nContext';
import { useAdminMe } from './AdminKit';
import { PULSE } from './PulseCharts';

export const WIDE = 900;

const TABS = [
  { route: 'AdminDashboard', label: 'adminTabs.pulse', icon: 'pulse' },
  { route: 'AdminReports', label: 'adminTabs.reports', icon: 'flag-outline', caps: ['handle_reports'] },
  { route: 'AdminUsers', label: 'adminTabs.users', icon: 'people-outline', caps: ['manage_users', 'ban_users'] },
  { route: 'AdminContent', label: 'adminTabs.content', icon: 'albums-outline', caps: ['remove_content'] },
  { route: 'AdminAppeals', label: 'adminTabs.appeals', icon: 'hand-left-outline', caps: ['manage_appeals'] },
  { route: 'AdminMore', label: 'adminTabs.more', icon: 'grid-outline' },
];

export const useAdminTabs = () => {
  const { can } = useAdminMe();
  return TABS.filter((tb) => !tb.caps || tb.caps.some((c) => can(c)));
};

export default function AdminTabs({ navigation, current, children }) {
  const { t } = useI18n();
  const { width } = useWindowDimensions();
  const tabs = useAdminTabs();
  // A tool reached from More keeps More lit.
  const active = TABS.some((tb) => tb.route === current) ? current : 'AdminMore';
  const go = (route) => { if (route !== current) navigation.replace(route); };

  if (width >= WIDE) {
    return (
      <View style={styles.wide}>
        <View style={styles.rail} accessibilityRole="tablist">
          {tabs.map((tb) => {
            const on = tb.route === active;
            return (
              <TouchableOpacity key={tb.route} onPress={() => go(tb.route)} testID={`admin-tab-${tb.route}`}
                accessibilityRole="tab" accessibilityState={{ selected: on }}
                style={[styles.railItem, on && styles.railItemOn]}>
                <Ionicons name={tb.icon} size={22} color={on ? PULSE.teal : PULSE.muted} />
                <Text style={[styles.railText, on && styles.on]} numberOfLines={1}>{t(tb.label)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.bar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.barRow}
          accessibilityRole="tablist">
          {tabs.map((tb) => {
            const on = tb.route === active;
            return (
              <TouchableOpacity key={tb.route} onPress={() => go(tb.route)} testID={`admin-tab-${tb.route}`}
                accessibilityRole="tab" accessibilityState={{ selected: on }}
                style={[styles.tab, on && styles.tabOn]}>
                <Text style={[styles.tabText, on && styles.on]}>{t(tb.label)}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { borderBottomWidth: 1, borderBottomColor: PULSE.line, backgroundColor: PULSE.bg },
  barRow: { paddingHorizontal: 10, gap: 2 },
  tab: {
    minHeight: 44, paddingHorizontal: 12, justifyContent: 'center',
    borderBottomWidth: 3, borderBottomColor: 'transparent',
  },
  tabOn: { borderBottomColor: PULSE.teal },
  tabText: { color: PULSE.muted, fontSize: 14, fontWeight: '600' },
  on: { color: PULSE.text },
  wide: { flex: 1, flexDirection: 'row' },
  rail: {
    width: 92, paddingVertical: 18, alignItems: 'center', gap: 8,
    borderRightWidth: 1, borderRightColor: PULSE.line, backgroundColor: PULSE.bg,
  },
  railItem: { width: 74, minHeight: 60, borderRadius: 14, alignItems: 'center', justifyContent: 'center', gap: 5 },
  railItemOn: { backgroundColor: PULSE.tealSoft },
  railText: { color: PULSE.muted, fontSize: 11, fontWeight: '600' },
});
