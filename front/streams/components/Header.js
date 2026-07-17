import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, StatusBar } from 'react-native';
import { useNavigation, useNavigationState } from '@react-navigation/native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import GlassView from './GlassView';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../context/useAuth';
import NotificationsBell from './NotificationsBell';
import HamburgerMenu from '../components/HamburgerMenu';
import ScreenVignette from './ScreenVignette';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../constants/theme';

const HEADER_BG = colors.surface; // deep blue (#102E50) — fallback behind the image
// Wallpaper behind the header — re-hosted on our Cloudinary CDN, optimized.
const HEADER_IMAGE = 'https://pub-9c5a2f0a7a2244be84e39a116c2dc4d5.r2.dev/wallpapers/bpqz33r3njhwouungnli.jpg';
const INACTIVE = 'rgba(255,255,255,0.62)';
const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');

/** A single bottom-row destination: filled icon + accent when on that screen. */
const NavItem = ({ set: Set = Ionicons, active, inactive, label, isActive, onPress }) => (
  <TouchableOpacity
    style={styles.navItem}
    onPress={onPress}
    activeOpacity={0.7}
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityState={{ selected: isActive }}
  >
    <Set name={isActive ? active : inactive} size={22} color={isActive ? colors.accent : INACTIVE} />
    <Text style={[styles.navLabel, isActive && styles.navLabelActive]} numberOfLines={1}>
      {label}
    </Text>
  </TouchableOpacity>
);

const Header = ({ transparentBg = false }) => {
  const navigation = useNavigation();
  const { currentUser, isAuthenticated } = useAuth();

  // Name of the screen currently shown in this stack, for active highlighting.
  const activeRoute = useNavigationState((s) => s?.routes?.[s.index]?.name);
  const isOn = (name) => activeRoute === name;

  return (
    <View style={[styles.root, transparentBg && styles.rootTransparent]}>
      {/* Background wallpaper (extends under the status bar) + glass blur and a
          legibility scrim so the nav icons/labels stay readable over it. When
          transparentBg is set, a parent supplies a shared wallpaper that spans
          the nav bar and the screen below, so we skip our own image and let it
          show through the glass instead. */}
      {!transparentBg && (
        <Image source={{ uri: HEADER_IMAGE }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      )}
      <GlassView
        intensity={24}
        tint="dark"
        experimentalBlurMethod="dimezisBlurView"
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {/* Dark-blue glass: deeper toward the nav row so the labels read cleanly. */}
      <LinearGradient
        colors={['rgba(11, 38, 87, 0.5)', 'rgba(6, 28, 68, 0.8)']}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {/* Curved-glass edge vignette in navy for a premium, recessed-edge feel. */}
      <ScreenVignette strength={0.8} side={32} vertical={35} tintRgb="6,16,34" zIndex={4} />

      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />

        <View style={styles.header}>
        {/* Top row: brand cluster (medallion + title) on the left, menu right. */}
        <View style={styles.topRow}>
          <View style={styles.brand}>
            {/* Brand mark set in a gold-rimmed ivory medallion — a coin/seal look
                that lifts the emblem off the dark glass for a luxury feel. */}
            <LinearGradient
              colors={['#F4DE9B', '#C99A2E', '#8C6A1A', '#E7C871']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.logoRing}
            >
              <View style={styles.logoDisc}>
                <Image source={require('../assets/logo.png')} style={styles.logo} resizeMode="contain" />
              </View>
            </LinearGradient>
            <Text style={styles.title}>ADVENTIST LIFE</Text>
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
        <View style={styles.bottomRow}>
          <NavItem
            active="home" inactive="home-outline" label="Home"
            isActive={isOn('Home')} onPress={() => navigation.navigate('Home')}
          />
          <NavItem
            active="musical-notes" inactive="musical-notes-outline" label="Music"
            isActive={isOn('Music')} onPress={() => navigation.navigate('Music')}
          />
          <NavItem
            active="search" inactive="search-outline" label="Explore"
            isActive={isOn('Explore')} onPress={() => navigation.navigate('Explore')}
          />
          <NavItem
            active="book" inactive="book-outline" label="Bible"
            isActive={isOn('bible')} onPress={() => navigation.navigate('bible')}
          />

          <View style={styles.navItem}>
            <NotificationsBell navigation={navigation} />
            <Text style={styles.navLabel} numberOfLines={1}>Alerts</Text>
          </View>

          <NavItem
            set={MaterialCommunityIcons} active="piano" inactive="piano-off" label="Hymns"
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
              <Text style={[styles.navLabel, isOn('Profile') && styles.navLabelActive]} numberOfLines={1}>
                You
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.authRow}>
              <TouchableOpacity onPress={() => navigation.navigate('SignUp')} accessibilityRole="button">
                <Text style={styles.navLink}>Sign Up</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => navigation.navigate('Login')} accessibilityRole="button">
                <Text style={styles.navLink}>Log In</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  // Deep-blue fallback shows if the wallpaper fails to load; overflow clips the
  // absolute-fill image/blur to the header's measured height.
  root: { backgroundColor: HEADER_BG, overflow: 'hidden' },
  // Home screen: let the parent's shared wallpaper show through the glass.
  rootTransparent: { backgroundColor: 'transparent' },
  // zIndex 5 keeps the brand + nav above the navy vignette (zIndex 4), so the
  // vignette frames the wallpaper without dimming the icons/labels.
  safeArea: { backgroundColor: 'transparent', zIndex: 5 },
  header: {
    backgroundColor: 'transparent',
    paddingHorizontal: 18,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(11, 6, 83, 0.18)',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  // Gold metallic rim (the gradient is the ring; padding sets its thickness).
  logoRing: {
    width: 32,
    height: 34,
    borderRadius: 26,
    padding: 3.5,
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
    borderRadius: 23.5,
    backgroundColor: '#FBF7EE',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logo: { width: 36, height: 24 },
  // Medallion + title sit together as one left-aligned brand lockup.
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    color: colors.accent,
    fontFamily: 'Cinzel_700Bold',
    fontSize: 24,
    // Wider tracking gives Cinzel its engraved, monument-like premium feel.
    letterSpacing: 2.5,
    // Blue-theme glow/drop shadow for depth.
    textShadowColor: 'rgba(13,71,161,0.9)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  menuContainer: { marginLeft: 'auto' },
  rightCluster: { flexDirection: 'row', alignItems: 'center', gap: 10, marginLeft: 'auto' },
  videosBtn: { padding: 2 },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingTop: 8,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingVertical: 2,
  },
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
    width: 26,
    height: 26,
    borderRadius: 13,
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
