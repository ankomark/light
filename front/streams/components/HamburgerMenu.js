import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Image,
  ScrollView, Pressable, AppState,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation, useNavigationState } from '@react-navigation/native';
import { useAuth } from '../context/useAuth';
import { useI18n } from '../context/I18nContext';
import { fetchUnreadMessageCount } from '../services/api';
import { subscribeDM } from '../services/dmSocket';
import { isAdmin } from '../utils/roles';
import { useAppStatus } from '../context/AppStatusContext';
import RotatingBackground from './RotatingBackground';
import ScreenVignette from './ScreenVignette';
// The menu is a deliberately dark, wallpaper-backed drawer, so it keeps the
// static (dark) palette in both themes — only its text is internationalized.
import { colors, spacing, radius, typography } from '../constants/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import useScreenActive from '../hooks/useScreenActive';

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');

// Some rows carry artwork instead of a glyph, and keep their own colours —
// tinting a multicolour mark to a single grey throws away the reason to use
// it. Declared above SECTIONS, which reads them as the module loads.
const PUBLISHING_ART = require('../assets/publishing-icon.png');
const SERVICES_ART = require('../assets/services-icon.png');
const MESSAGES_ART = require('../assets/messages-icon.png');
const COMMUNITIES_ART = require('../assets/communities-icon.png');
const GROUPS_ART = require('../assets/groups-icon.png');
const NOTICE_ART = require('../assets/noticeboard-icon.png');
const QUIZ_ART = require('../assets/quiz-icon.png');
const PUZZLE_ART = require('../assets/puzzle-icon.png');
const SETTINGS_ART = require('../assets/settings-icon.png');
const HELP_ART = require('../assets/help-icon.png');
const ABOUT_ART = require('../assets/about-icon.png');
const GUIDE_ART = require('../assets/userguide-icon.png');
const PRIVACY_ART = require('../assets/privacy-icon.png');
const TERMS_ART = require('../assets/terms-icon.png');
const GUIDELINES_ART = require('../assets/guidelines-icon.png');
const CALC_ART = require('../assets/calculator-icon.png');
const WEATHER_ART = require('../assets/weather-icon.png');

// The calendar's own red. Deliberately not colors.error, which is reserved
// for things that have gone wrong — a red calendar is a convention, a red
// warning is a message.
const CALENDAR_RED = '#EA4335';

// The teal of the verse screen's own artwork, so the row points at it.
const VERSE_TEAL = '#2E9E96';

// The gold the Sabbath School screens use for their accents.
const SABBATH_GOLD = '#E3C46A';

// label = what the user sees; route = the registered screen name; set/icon = glyph.
// Most used first: the conversations people return to every day (and the
// only rows with unread badges), then going live, publishing and services,
// the daily devotions and games, the tools, and last the settings, support and
// policies people open rarely. The feed, Music, Market, Bible and Hymns are
// in the header, so they are not repeated here.
const SECTIONS = [
  {
    title: 'Connect',
    items: [
      { label: 'Messages', route: 'Inbox', art: MESSAGES_ART },
      { label: 'Groups', route: 'Groups', art: GROUPS_ART },
      // Adults only, opt-in, reviewed (pages/singles).
      { label: 'Single & Searching', route: 'Singles', set: 'mci', icon: 'ring', tint: '#FFC46B', feature: 'singles' },
      // Churches and choirs are no longer separate entries — they are
      // categories inside Community, alongside any kind someone starts.
      { label: 'Communities', route: 'Communities', art: COMMUNITIES_ART },
      // Buy tickets with M-Pesa; no account needed (pages/tickets).
      { label: 'Events & Tickets', route: 'TicketsHome', set: 'mci', icon: 'ticket-confirmation-outline',
        tint: '#E8D4AA' },
      { label: 'Notice Board', route: 'NoticeBoard', art: NOTICE_ART },
    ],
  },
  {
    title: 'Create & Share',
    items: [
      { label: 'Go Live', route: 'LiveHub', set: 'mci', icon: 'broadcast', danger: true, feature: 'live' },
      { label: 'Publishing', route: 'Publishing', art: PUBLISHING_ART },
      { label: 'Services', route: 'Studios', art: SERVICES_ART },
    ],
  },
  {
    title: 'Daily Faith',
    items: [
      { label: 'Verse of the Day', route: 'DailyVerse', set: 'mci', icon: 'book-open-variant',
        tint: VERSE_TEAL },
      { label: 'Sabbath School', route: 'SabbathSchool', set: 'mci', icon: 'book-education-outline',
        tint: SABBATH_GOLD },
      { label: 'Bible Quiz', route: 'QuizHome', art: QUIZ_ART, feature: 'quiz' },
      { label: 'Word Puzzle', route: 'PuzzlePlay', art: PUZZLE_ART, feature: 'puzzle' },
    ],
  },
  {
    title: 'Tools',
    items: [
      { label: 'Calendar', route: 'Calendar', set: 'mci', icon: 'calendar-month-outline',
        tint: CALENDAR_RED },
      { label: 'Weather', route: 'Weather', art: WEATHER_ART },
      { label: 'Calculator', route: 'Calculator', art: CALC_ART },
    ],
  },
  {
    title: 'Settings & Support',
    items: [
      { label: 'Settings', route: 'Settings', art: SETTINGS_ART },
      { label: 'Help', route: 'Help', art: HELP_ART },
      { label: 'User Guide', route: 'UserGuide', art: GUIDE_ART },
      { label: 'About', route: 'About', art: ABOUT_ART },
    ],
  },
  {
    title: 'Privacy & Legal',
    items: [
      { label: 'Privacy Centre', route: 'PrivacyCentre', set: 'mci', icon: 'shield-account-outline' },
      { label: 'Privacy Policy', route: 'LegalPage', params: { docKey: 'privacy' }, art: PRIVACY_ART },
      { label: 'Terms of Service', route: 'LegalPage', params: { docKey: 'terms' }, art: TERMS_ART },
      { label: 'Guidelines', route: 'LegalPage', params: { docKey: 'guidelines' }, art: GUIDELINES_ART },
    ],
  },
];

// The admin area has one door in the menu: the dashboard. Its tabs (Pulse,
// Reports, Users, Content, Appeals) and More lead to every other tool, each
// shown only to whom the server says may use it.
const ADMIN_ITEMS = [
  { label: 'Admin Dashboard', route: 'AdminDashboard', set: 'mci', icon: 'shield-crown-outline' },
];

// Shown only to a user whose own account is suspended.
const APPEAL_SECTION = {
  title: 'Account',
  items: [
    { label: 'Appeal suspension', route: 'Appeal', set: 'mci', icon: 'gavel' },
  ],
};

const Glyph = ({ set, name, art, color, size }) => {
  if (art) {
    return (
      <Image
        source={art}
        style={{ width: size + 4, height: size + 4 }}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
      />
    );
  }
  return set === 'mci'
    ? <MaterialCommunityIcons name={name} size={size} color={color} />
    : <Ionicons name={name} size={size} color={color} />;
};

// The menu is a screen of its own ('Menu'), as each step of the Bible is: a
// page opened from it sits on top of it, so back — the swipe, the phone's
// button, a page's own arrow — returns to the menu, and back again to the
// page it was opened over. (It used to be a pop-up, so back skipped it.)
export const MENU_ROUTE = 'Menu';

/** Open the menu. From a page the menu led to, it goes back to that menu
 *  rather than stacking another one on top. */
export const openMenu = (navigation) => {
  const routes = navigation.getState?.()?.routes || [];
  if (routes.some((r) => r.name === MENU_ROUTE)) navigation.popTo(MENU_ROUTE);
  else navigation.push(MENU_ROUTE);
};

// An item is the page under the menu when its route matches and so do the
// params it names (the three legal pages share one route).
const isPage = (route, item) => !!route && route.name === item.route
  && Object.entries(item.params || {}).every(([k, v]) => route.params?.[k] === v);

// Unread, for the badges: messages (and message requests), and groups and
// communities with something new. `poll`: keep it fresh (the header's
// button) — live off the DM socket, with a slow poll behind it; otherwise
// it's read once (the menu, open for a moment).
const NONE = { messages: 0, groups: 0, communities: 0, notices: 0, singles: 0 };
const useUnread = ({ poll }) => {
  const { isAuthenticated } = useAuth();
  // Every header has this button, on every screen in the stack: only the one
  // in view keeps polling.
  const screenActive = useScreenActive();
  const [unread, setUnread] = useState(NONE);
  const refresh = useCallback(() => {
    if (!isAuthenticated) { setUnread(NONE); return; }
    fetchUnreadMessageCount()
      .then((r) => setUnread({
        messages: (r?.unread_count || 0) + (r?.requests || 0),
        groups: r?.groups || 0,
        communities: r?.communities || 0,
        notices: r?.notices || 0,
        singles: r?.singles || 0,
      }))
      .catch(() => {});
  }, [isAuthenticated]);
  // Counted each time the screen comes into view, not only when it first
  // mounts: the menu stays mounted under the pages opened from it, and
  // coming back after reading a chat must show the lower count.
  useFocusEffect(refresh);
  useEffect(() => {
    if (!poll || !isAuthenticated || !screenActive) return undefined;
    const interval = setInterval(refresh, 60000);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') refresh(); });
    // A new message or a read receipt: count again (once for a burst).
    let soon = null;
    const unsub = subscribeDM((e) => {
      if (!['message', 'read', 'seen', 'deleted', 'group_message', 'group_read', 'notices_seen'].includes(e.type)) return;
      clearTimeout(soon);
      soon = setTimeout(refresh, 400);
    });
    return () => { clearInterval(interval); sub.remove(); unsub(); clearTimeout(soon); };
  }, [refresh, poll, isAuthenticated, screenActive]);
  return unread;
};

/** The header's menu button (with a dot for unread messages). */
function HamburgerMenu() {
  const navigation = useNavigation();
  const unread = useUnread({ poll: true });
  const any = unread.messages + unread.groups + unread.communities + unread.notices;
  return (
    <TouchableOpacity onPress={() => openMenu(navigation)} style={styles.menuButton} accessibilityRole="button" accessibilityLabel="Open menu">
      <Ionicons name="menu" size={26} color={colors.white} />
      {any > 0 && <View style={styles.menuDot} />}
    </TouchableOpacity>
  );
}

/** The menu itself: the 'Menu' screen. */
export function MenuScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { isAuthenticated, currentUser, logout } = useAuth();
  const { features } = useAppStatus();
  const { t } = useI18n();
  const unread = useUnread({ poll: false });
  const badgeFor = {
    Inbox: unread.messages, Groups: unread.groups, Communities: unread.communities, NoticeBoard: unread.notices,
    Singles: unread.singles,
  };

  // The page the menu was opened over: marked as where you are.
  const below = useNavigationState((s) => s?.routes?.[s.index - 1]);

  const close = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Home');
  };

  // A page opens on top of the menu, so back comes here. The page the menu
  // was opened over just closes the menu — not a second copy of it.
  const go = (route, params) => {
    if (isPage(below, { route, params })) close();
    else navigation.push(route, params);
  };

  const handleLogout = async () => {
    try {
      await logout();
    } finally {
      navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 6, paddingBottom: insets.bottom }]}>
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
                {currentUser?.username || t('menu.yourProfile')}
              </Text>
              <Text style={styles.profileHint}>{t('menu.viewProfile')}</Text>
            </View>
          </TouchableOpacity>
        ) : (
          <View style={styles.profile}>
            <View style={styles.brandBadge}>
              <Ionicons name="sparkles" size={20} color={colors.accent} />
            </View>
            <View style={styles.profileText}>
              <Text style={styles.username}>{t('menu.welcome')}</Text>
              <Text style={styles.profileHint}>{t('menu.signInPrompt')}</Text>
            </View>
          </View>
        )}

        <TouchableOpacity onPress={close} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close menu">
          <Ionicons name="close" size={24} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {(() => {
          // Any admin: the one way into the admin area.
          const adminItems = isAdmin(currentUser) ? ADMIN_ITEMS : [];
          // Parts switched off by an admin leave the menu (admin phase 4).
          const visible = SECTIONS
            .map((sec) => ({ ...sec, items: sec.items.filter((it) => !it.feature || features?.[it.feature] !== false) }))
            .filter((sec) => sec.items.length);
          // An appeal or the admin area is why those people open the menu,
          // so it comes first for them.
          return [
            ...(currentUser?.is_suspended ? [APPEAL_SECTION] : []),
            ...(adminItems.length ? [{ title: 'Admin', items: adminItems }] : []),
            ...visible,
          ];
        })().map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title.toUpperCase()}</Text>
            <View style={styles.group}>
              {section.items.map((item, i) => {
                const active = isPage(below, item);
                return (
                  <Pressable
                    key={item.label}
                    onPress={() => go(item.route, item.params)}
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
                      <Glyph
                        set={item.set}
                        name={item.icon}
                        art={item.art}
                        size={20}
                        color={active ? colors.accent
                          : item.tint ? item.tint
                          : item.danger ? colors.error
                          : colors.textSecondary}
                      />
                    </View>
                    <Text style={[styles.rowLabel, active && styles.rowLabelActive]} numberOfLines={1}>
                      {item.label}
                    </Text>
                    {badgeFor[item.route] > 0 ? (
                      <View style={styles.countBadge}>
                        <Text style={styles.countBadgeText}>{badgeFor[item.route] > 99 ? '99+' : badgeFor[item.route]}</Text>
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
            <Text style={styles.logoutText}>{t('menu.logout')}</Text>
          </Pressable>
        )}

        <View style={{ height: spacing.xl }} />
      </ScrollView>
      </View>
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
