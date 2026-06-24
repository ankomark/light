import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Image, Modal,
  ScrollView, Pressable, Platform, StatusBar, AppState,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useNavigationState } from '@react-navigation/native';
import { useAuth } from '../context/useAuth';
import { fetchUnreadMessageCount } from '../services/api';
import { isAdmin, isSuperAdmin, hasCapability } from '../utils/roles';
import RotatingBackground from './RotatingBackground';
import ScreenVignette from './ScreenVignette';
import { colors, spacing, radius, typography } from '../constants/theme';

const TOP_PAD = Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 50;
const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');

// label = what the user sees; route = the registered screen name; set/icon = glyph.
const SECTIONS = [
  {
    title: 'Discover',
    items: [
      { label: 'Explore', route: 'Explore', set: 'ion', icon: 'compass-outline' },
      { label: 'Publishing', route: 'Publishing', set: 'mci', icon: 'newspaper-variant-outline' },
      { label: 'Go Live', route: 'LiveHub', set: 'mci', icon: 'broadcast', color: colors.error },
    ],
  },
  {
    title: 'Music',
    items: [
      { label: 'Favorites', route: 'Favorites', set: 'ion', icon: 'heart-outline' },
      { label: 'Playlists', route: 'Playlists', set: 'mci', icon: 'playlist-music-outline' },
      { label: 'Choirs', route: 'Choirs', set: 'mci', icon: 'account-music-outline' },
      { label: 'Media Production', route: 'Studios', set: 'mci', icon: 'video-outline' },
    ],
  },
  {
    title: 'Community',
    items: [
      { label: 'Messages', route: 'Inbox', set: 'ion', icon: 'chatbubbles-outline' },
      { label: 'Groups', route: 'Groups', set: 'mci', icon: 'account-group-outline' },
      { label: 'Churches', route: 'Churches', set: 'mci', icon: 'church' },
      { label: 'Notice Board', route: 'NoticeBoard', set: 'mci', icon: 'bulletin-board' },
    ],
  },
  {
    title: 'Shop',
    items: [
      { label: 'Marketplace', route: 'MarketplaceHome', set: 'mci', icon: 'storefront-outline' },
      { label: 'Cart', route: 'Cart', set: 'mci', icon: 'cart-outline' },
    ],
  },
  {
    title: 'More',
    items: [
      { label: 'Settings', route: 'Settings', set: 'ion', icon: 'settings-outline' },
      { label: 'Help', route: 'Help', set: 'ion', icon: 'help-circle-outline' },
      { label: 'About', route: 'About', set: 'mci', icon: 'information-outline' },
    ],
  },
];

// Admin destinations, each gated by the capability it needs (dashboard is shown
// to any admin; Roles is super-admin only). Filtered per user in the render.
const ADMIN_ITEMS = [
  { label: 'Admin Dashboard', route: 'AdminDashboard', set: 'mci', icon: 'shield-crown-outline' },
  { label: 'Analytics', route: 'AdminAnalytics', set: 'mci', icon: 'chart-line', cap: 'view_analytics' },
  { label: 'Reports', route: 'AdminReports', set: 'mci', icon: 'flag-outline', cap: 'handle_reports' },
  { label: 'Users', route: 'AdminUsers', set: 'mci', icon: 'account-cog-outline', anyCap: ['manage_users', 'ban_users'] },
  { label: 'Content', route: 'AdminContent', set: 'mci', icon: 'file-document-multiple-outline', cap: 'remove_content' },
  { label: 'Appeals', route: 'AdminAppeals', set: 'mci', icon: 'gavel', cap: 'manage_appeals' },
  { label: 'Audit Log', route: 'AdminLogs', set: 'mci', icon: 'history', cap: 'view_audit_log' },
  { label: 'Roles', route: 'AdminRoles', set: 'mci', icon: 'shield-key-outline', superOnly: true },
];

// Shown only to a user whose own account is suspended.
const APPEAL_SECTION = {
  title: 'Account',
  items: [
    { label: 'Appeal suspension', route: 'Appeal', set: 'mci', icon: 'gavel' },
  ],
};

const Glyph = ({ set, name, color, size }) =>
  set === 'mci'
    ? <MaterialCommunityIcons name={name} size={size} color={color} />
    : <Ionicons name={name} size={size} color={color} />;

function HamburgerMenu() {
  const navigation = useNavigation();
  const { isAuthenticated, currentUser, logout } = useAuth();
  const [menuVisible, setMenuVisible] = useState(false);
  const [unreadMessages, setUnreadMessages] = useState(0);

  const activeRoute = useNavigationState((s) => s?.routes?.[s.index]?.name);

  const refreshUnread = useCallback(() => {
    if (!isAuthenticated) { setUnreadMessages(0); return; }
    fetchUnreadMessageCount()
      .then((r) => setUnreadMessages(r?.unread_count || 0))
      .catch(() => {});
  }, [isAuthenticated]);

  // Poll the unread message count so the menu icon shows a badge, and refresh
  // whenever the app returns to the foreground or the menu is opened.
  useEffect(() => {
    refreshUnread();
    const interval = setInterval(refreshUnread, 30000);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') refreshUnread(); });
    return () => { clearInterval(interval); sub.remove(); };
  }, [refreshUnread]);

  useEffect(() => { if (menuVisible) refreshUnread(); }, [menuVisible, refreshUnread]);

  const close = () => setMenuVisible(false);

  const go = (route) => {
    setMenuVisible(false);
    navigation.navigate(route);
  };

  const handleLogout = async () => {
    setMenuVisible(false);
    try {
      await logout();
    } finally {
      navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
    }
  };

  return (
    <View>
      <TouchableOpacity onPress={() => setMenuVisible(true)} style={styles.menuButton} accessibilityRole="button" accessibilityLabel="Open menu">
        <Ionicons name="menu" size={26} color={colors.white} />
        {unreadMessages > 0 && <View style={styles.menuDot} />}
      </TouchableOpacity>

      <Modal visible={menuVisible} animationType="slide" onRequestClose={close} statusBarTranslucent>
        <View style={[styles.container, { paddingTop: TOP_PAD }]}>
          {/* Shared luxury backdrop — rotating wallpaper + navy edge vignette. */}
          <RotatingBackground intervalMs={60000} scrimColor="rgba(10,22,40,0.62)" />
          <ScreenVignette tintRgb="6,16,34" zIndex={1} />

          <View style={styles.menuContent}>
          {/* Header: profile (or welcome) + close */}
          <View style={styles.header}>
            {isAuthenticated ? (
              <TouchableOpacity
                style={styles.profile}
                activeOpacity={0.8}
                onPress={() => go('Profile')}
              >
                <Image
                  source={currentUser?.profile_picture ? { uri: currentUser.profile_picture } : DEFAULT_AVATAR}
                  defaultSource={DEFAULT_AVATAR}
                  style={styles.avatar}
                />
                <View style={styles.profileText}>
                  <Text style={styles.username} numberOfLines={1}>
                    {currentUser?.username || 'Your profile'}
                  </Text>
                  <Text style={styles.profileHint}>View profile</Text>
                </View>
              </TouchableOpacity>
            ) : (
              <View style={styles.profile}>
                <View style={styles.brandBadge}>
                  <Ionicons name="sparkles" size={20} color={colors.accent} />
                </View>
                <View style={styles.profileText}>
                  <Text style={styles.username}>Welcome</Text>
                  <Text style={styles.profileHint}>Sign in to get started</Text>
                </View>
              </View>
            )}

            <TouchableOpacity onPress={close} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close menu">
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            {(() => {
              // Show only the admin items the user's capabilities allow.
              const adminItems = isAdmin(currentUser)
                ? ADMIN_ITEMS.filter((it) => {
                    if (it.superOnly) return isSuperAdmin(currentUser);
                    if (it.cap) return hasCapability(currentUser, it.cap);
                    if (it.anyCap) return it.anyCap.some((c) => hasCapability(currentUser, c));
                    return true; // dashboard — any admin
                  })
                : [];
              return [
                ...SECTIONS,
                ...(currentUser?.is_suspended ? [APPEAL_SECTION] : []),
                ...(adminItems.length ? [{ title: 'Admin', items: adminItems }] : []),
              ];
            })().map((section) => (
              <View key={section.title} style={styles.section}>
                <Text style={styles.sectionTitle}>{section.title.toUpperCase()}</Text>
                <View style={styles.group}>
                  {section.items.map((item, i) => {
                    const active = activeRoute === item.route;
                    return (
                      <Pressable
                        key={item.route}
                        onPress={() => go(item.route)}
                        android_ripple={{ color: 'rgba(255,255,255,0.06)' }}
                        accessibilityRole="button"
                        accessibilityLabel={item.label}
                        accessibilityState={{ selected: active }}
                        style={({ pressed }) => [
                          styles.row,
                          i < section.items.length - 1 && styles.rowDivider,
                          pressed && styles.rowPressed,
                        ]}
                      >
                        <View style={[styles.iconWrap, active && styles.iconWrapActive]}>
                          <Glyph set={item.set} name={item.icon} size={20} color={active ? colors.accent : (item.color || colors.textSecondary)} />
                        </View>
                        <Text style={[styles.rowLabel, active && styles.rowLabelActive]} numberOfLines={1}>
                          {item.label}
                        </Text>
                        {item.route === 'Inbox' && unreadMessages > 0 ? (
                          <View style={styles.countBadge}>
                            <Text style={styles.countBadgeText}>{unreadMessages > 99 ? '99+' : unreadMessages}</Text>
                          </View>
                        ) : active ? (
                          <View style={styles.activeDot} />
                        ) : (
                          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}

            {isAuthenticated && (
              <Pressable
                onPress={handleLogout}
                android_ripple={{ color: 'rgba(229,57,53,0.15)' }}
                style={({ pressed }) => [styles.logout, pressed && styles.rowPressed]}
                accessibilityRole="button"
                accessibilityLabel="Log out"
              >
                <MaterialCommunityIcons name="logout" size={20} color={colors.error} />
                <Text style={styles.logoutText}>Log Out</Text>
              </Pressable>
            )}

            <View style={{ height: spacing.xl }} />
          </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  menuButton: { padding: 2 },
  menuDot: {
    position: 'absolute', top: 0, right: 0,
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: colors.error, borderWidth: 1.5, borderColor: colors.bg,
  },
  countBadge: {
    minWidth: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 6,
  },
  countBadgeText: { color: colors.white, fontSize: 11, fontWeight: '800' },
  container: { flex: 1, backgroundColor: '#0A1628' },
  menuContent: { flex: 1, zIndex: 2 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  profile: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: spacing.sm },
  avatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
  },
  brandBadge: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  profileText: { flex: 1 },
  username: { ...typography.h3, color: colors.textPrimary },
  profileHint: { ...typography.caption, color: colors.textSecondary, marginTop: 1 },
  closeBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },

  scroll: { paddingTop: spacing.sm },
  section: { marginTop: spacing.md },
  sectionTitle: {
    ...typography.caption,
    color: colors.textMuted,
    letterSpacing: 1.2,
    fontWeight: '700',
    marginLeft: spacing.lg,
    marginBottom: spacing.xs,
  },
  group: {
    backgroundColor: 'rgba(16,28,46,0.82)',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
    marginHorizontal: spacing.md,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowPressed: { backgroundColor: 'rgba(255,255,255,0.04)' },
  iconWrap: {
    width: 36, height: 36, borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center', justifyContent: 'center',
  },
  iconWrapActive: { backgroundColor: 'rgba(244,162,97,0.15)' },
  rowLabel: { ...typography.body, color: colors.textPrimary, flex: 1, fontWeight: '500' },
  rowLabelActive: { color: colors.accent, fontWeight: '700' },
  activeDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: colors.accent,
  },

  logout: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.error,
  },
  logoutText: { ...typography.button, color: colors.error, fontWeight: '700' },
});

export default HamburgerMenu;
