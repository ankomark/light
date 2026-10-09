import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, StatusBar, useWindowDimensions } from 'react-native';
import { useNavigation, useNavigationState } from '@react-navigation/native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import GlassView from './GlassView';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../context/useAuth';
import NotificationsBell from './NotificationsBell';
import HamburgerMenu from '../components/HamburgerMenu';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../constants/theme';
import { FONT_SCALE } from '../utils/layout';
import { useI18n } from '../context/I18nContext';
import { useWallpapersOn } from '../context/WallpaperContext';
import { useFeature } from '../context/AppStatusContext';

const HEADER_BG = colors.surface; // deep blue (#102E50) — fallback behind the image
// Wallpaper behind the header — re-hosted on our Cloudinary CDN, optimized.
const HEADER_IMAGE = 'https://pub-9c5a2f0a7a2244be84e39a116c2dc4d5.r2.dev/wallpapers/bpqz33r3njhwouungnli.jpg';
const INACTIVE = 'rgba(255,255,255,0.62)';
// Tab icons: plain white line icons; the open screen's is filled, in the accent.
const ICON = '#FFFFFF';
const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');
// "Adventist life": embossed white script with a gold "life", on a transparent
// background (trimmed to the lettering).
const TITLE_ART = require('../assets/title-cinematic.png');
const TITLE_RATIO = 900 / 181;
// How round the header's lower corners are.
const CURVE = 12;

// The title artwork's width: whatever the row leaves between the medallion and
// the Videos + menu icons (padding 2x18, medallion 32, title margins 2x6, icons
// ~72), so it fits a 320 px phone. At most 226 (44 tall: the row's 34 and its
// 5 + 5 padding), so the title never makes the header taller.
const ROW_FIXED = 18 * 2 + 32 + 6 * 2 + 72;
const TITLE_SCALE = 0.497;  // 4%, 4%, 10% and then 40% smaller
export const titleWidthFor = (width, rowMaxWidth) => {
  const room = Math.min(width, rowMaxWidth || width) - ROW_FIXED;
  // A touch under the room it has (asked for: smaller, on every screen).
  return Math.round(Math.max(120, Math.min(226, room)) * TITLE_SCALE);
};

/** A single bottom-row destination: filled icon + accent when on that screen.
 *  With `art`, a coloured picture in its own colours instead of a glyph (the
 *  label still lights up when on that screen); with `tint` too, the picture
 *  is one colour, grey or accent like a glyph. */
const NavItem = ({ set: Set = Ionicons, active, inactive, art, artStyle, tint, label, isActive, onPress, testID }) => (
  <TouchableOpacity
    style={styles.navItem}
    onPress={onPress}
    testID={testID || `nav-${inactive}`}
    activeOpacity={0.7}
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityState={{ selected: isActive }}
  >
    {art ? (
      <Image
        source={art}
        style={[styles.navArt, artStyle, isActive && styles.navArtActive, tint && { tintColor: isActive ? colors.accent : INACTIVE }]}
        resizeMode="contain"
      />
    ) : (
      <Set name={isActive ? active : inactive} size={22} color={isActive ? colors.accent : ICON} />
    )}
    <Text style={[styles.navLabel, isActive && styles.navLabelActive]} numberOfLines={1} maxFontSizeMultiplier={FONT_SCALE.tight}>
      {label}
    </Text>
  </TouchableOpacity>
);

const Header = ({ transparentBg = false }) => {
  const navigation = useNavigation();
  const { currentUser, isAuthenticated } = useAuth();
  const { t } = useI18n();
  // Wallpapers off (Settings): the plain navy instead of its picture.
  const headerImage = useWallpapersOn() ? HEADER_IMAGE : null;
  // A part of the app an admin has switched off has no button (admin phase 4).
  const marketOn = useFeature('marketplace');

  // Responsive brand sizing: recomputes on rotation / different devices so the
  // title never wraps or crowds the icons on small phones, and scales up a
  // touch on tablets. Bottom-row nav content is capped + centered on wide
  // screens so it reads as a bar, not stretched thin.
  const { width } = useWindowDimensions();
  const rowMaxWidth = width >= 768 ? 720 : undefined;  // centered bar on tablets
  const titleW = titleWidthFor(width, rowMaxWidth);

  // Name of the screen currently shown in this stack, for active highlighting.
  const activeRoute = useNavigationState((s) => s?.routes?.[s.index]?.name);
  const isOn = (name) => activeRoute === name;

  return (
    <View style={styles.shadowWrap}>
    <View style={[styles.root, transparentBg && styles.rootTransparent]}>
      {/* Background wallpaper (extends under the status bar) + glass blur and a
          legibility scrim so the nav icons/labels stay readable over it. When
          transparentBg is set, a parent supplies a shared wallpaper that spans
          the nav bar and the screen below, so we skip our own image and let it
          show through the glass instead. */}
      {!transparentBg && !!headerImage && (
        <Image source={{ uri: headerImage }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      )}
      <GlassView
        intensity={24}
        tint="dark"
        experimentalBlurMethod="dimezisBlurView"
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {/* The feed's own glass (SocialFeed's top bar), so the header and the
          feed read as one material over the wallpaper. */}
      <LinearGradient
        colors={['rgba(8,22,46,0.5)', 'rgba(8,20,40,0.68)']}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />

        <View style={styles.header}>
        {/* Top row: logo left, title centered in the middle (equal gaps to the
            logo and the icons), video + menu right. */}
        <View style={[styles.topRow, { maxWidth: rowMaxWidth, alignSelf: 'center', width: '100%' }]}>
          {/* Brand mark set in a gold-rimmed ivory medallion — a coin/seal look
              that lifts the emblem off the dark glass for a luxury feel. */}
          <LinearGradient
            colors={['#F4DE9B', '#C99A2E', '#8C6A1A', '#E7C871']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.logoRing}
          >
            <View style={styles.logoDisc}>
              <Image source={require('../assets/logo-mark.png')} style={styles.logo} resizeMode="contain" />
            </View>
          </LinearGradient>

          {/* The cinematic title fills the space between the medallion and the
              icons and centers within it — equal room on both sides. */}
          <View style={styles.titleWrap}>
            <Image
              source={TITLE_ART}
              style={[styles.titleArt, { width: titleW }]}
              resizeMode="contain"
              accessibilityRole="header"
              accessibilityLabel="Adventist Life"
            />
          </View>

          <View style={styles.rightCluster}>
            {/* Dedicated Videos feed (TikTok-style). Sits just left of the menu. */}
            <TouchableOpacity
              style={styles.videosBtn}
              onPress={() => navigation.navigate('Videos')}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Videos"
              accessibilityState={{ selected: isOn('Videos') }}
            >
              <Ionicons
                name={isOn('Videos') ? 'play-circle' : 'play-circle-outline'}
                size={28}
                color={isOn('Videos') ? colors.accent : '#fff'}
              />
            </TouchableOpacity>
            <HamburgerMenu />
          </View>
        </View>

        {/* Bottom row: primary destinations */}
        <View style={[styles.bottomRow, { maxWidth: rowMaxWidth, alignSelf: 'center', width: '100%' }]}>
          <NavItem
            active="home" inactive="home-outline" label="Home" testID="nav-home-outline"
            isActive={isOn('Home')} onPress={() => navigation.navigate('Home')}
          />
          <NavItem
            active="musical-notes" inactive="musical-notes-outline" label="Music" testID="nav-music"
            isActive={isOn('Music')} onPress={() => navigation.navigate('Music')}
          />
          {/* The marketplace, one tap from anywhere. (Explore lives on the
              home feed now, beside For You.) */}
          {marketOn && (
            <NavItem
              active="storefront" inactive="storefront-outline" label={t('header.market')} testID="nav-market"
              isActive={isOn('MarketplaceHome')} onPress={() => navigation.navigate('MarketplaceHome')}
            />
          )}
          <NavItem
            active="book" inactive="book-outline" label="Bible" testID="nav-bible"
            isActive={isOn('bible')} onPress={() => navigation.navigate('bible')}
          />

          <View style={styles.navItem}>
            <NotificationsBell navigation={navigation} size={22} color={ICON} />
            <Text style={styles.navLabel} numberOfLines={1} maxFontSizeMultiplier={FONT_SCALE.tight}>{t('header.alerts')}</Text>
          </View>

          <NavItem
            set={MaterialCommunityIcons} active="book-music" inactive="book-music-outline" label="Hymns"
            isActive={isOn('Hymns')} onPress={() => navigation.navigate('Hymns')}
          />

          {isAuthenticated ? (
            <TouchableOpacity
              style={styles.navItem}
              onPress={() => navigation.navigate('Profile')}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Your profile"
              accessibilityState={{ selected: isOn('Profile') }}
            >
              <Image
                source={currentUser?.profile_picture ? { uri: currentUser.profile_picture } : DEFAULT_AVATAR}
                defaultSource={DEFAULT_AVATAR}
                style={[styles.profilePicture, isOn('Profile') && styles.profileActive]}
                onError={() => {}}
              />
              <Text style={[styles.navLabel, isOn('Profile') && styles.navLabelActive]} numberOfLines={1} maxFontSizeMultiplier={FONT_SCALE.tight}>
                You
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.authRow}>
              <TouchableOpacity onPress={() => navigation.navigate('SignUp')} accessibilityRole="button">
                <Text style={styles.navLink} maxFontSizeMultiplier={FONT_SCALE.chrome}>{t('auth.signUp')}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => navigation.navigate('Login')} accessibilityRole="button">
                <Text style={styles.navLink} maxFontSizeMultiplier={FONT_SCALE.chrome}>{t('auth.login')}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
      </SafeAreaView>
    </View>
    </View>
  );
};

const styles = StyleSheet.create({
  // Deep-blue fallback shows if the wallpaper fails to load; overflow clips the
  // absolute-fill image/blur to the header's measured height.
  // The lower corners curve, with a fine light edge down the sides and the
  // title's warm orange along the curve; the shadow (on the wrapper, since the
  // clipping below would cut it off on iOS) floats it over the feed.
  shadowWrap: {
    zIndex: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.45,
    shadowRadius: 15,
  },
  root: {
    backgroundColor: HEADER_BG,
    overflow: 'hidden',
    borderBottomLeftRadius: CURVE,
    borderBottomRightRadius: CURVE,
    borderWidth: 1,
    borderTopWidth: 0,
    borderLeftColor: 'rgba(255,255,255,0.14)',
    borderRightColor: 'rgba(255,255,255,0.14)',
    borderBottomColor: 'rgba(244,162,97,0.55)',
  },
  // Home screen: let the parent's shared wallpaper show through the glass.
  rootTransparent: { backgroundColor: 'transparent' },
  // zIndex 5 keeps the brand + nav above the navy vignette (zIndex 4), so the
  // vignette frames the wallpaper without dimming the icons/labels.
  safeArea: { backgroundColor: 'transparent', zIndex: 5 },
  header: {
    backgroundColor: 'transparent',
    paddingHorizontal: 18,
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(11, 6, 83, 0.18)',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 5,
  },
  // Gold metallic rim (the gradient is the ring; padding sets its thickness).
  logoRing: {
    width: 32,
    height: 34,
    borderRadius: 26,
    padding: 1.75,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 5,
    elevation: 7,
  },
  // Ivory seal face the emblem sits on.
  logoDisc: {
    width: '100%',
    height: '100%',
    borderRadius: 24.5,
    backgroundColor: '#FBF7EE',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logo: { width: 32, height: 30 },
  // Fills the space between the logo and the icons and centers within it, so the
  // gap to the logo (left) equals the gap to the video icon (right).
  // The row keeps the height it had with the text title (the medallion's 34):
  // the artwork is taller, so it is centred and its glow and ring spread into
  // the row's own padding instead of making the header taller.
  titleWrap: {
    flex: 1,
    height: 34,
    marginHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  // Width set inline (titleW); never wider than the room it has.
  titleArt: { maxWidth: '100%', aspectRatio: TITLE_RATIO },
  menuContainer: { marginLeft: 'auto' },
  rightCluster: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 0 },
  videosBtn: { padding: 2 },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingTop: 4,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingVertical: 1,
  },
  navArt: { width: 22, height: 22 },
  // On the marketplace: a touch larger, as the glyphs fill in when active.
  navArtActive: { transform: [{ scale: 1.12 }] },
  navLabel: {
    fontSize: 9.5,
    color: INACTIVE,
    marginTop: 3,
  },
  navLabelActive: {
    color: colors.accent,
    fontWeight: '700',
  },
  profilePicture: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
  },
  profileActive: {
    borderColor: colors.accent,
    borderWidth: 2,
  },
  authRow: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  navLink: {
    color: colors.white,
    fontWeight: '700',
    fontSize: 13,
    paddingHorizontal: 8,
  },
});

export default Header;
