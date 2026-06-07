import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, StatusBar } from 'react-native';
import { useNavigation, useNavigationState } from '@react-navigation/native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuth } from '../context/useAuth';
import NotificationsBell from './NotificationsBell';
import HamburgerMenu from '../components/HamburgerMenu';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../constants/theme';

const HEADER_BG = colors.surface; // deep blue (#102E50)
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

const Header = () => {
  const navigation = useNavigation();
  const { currentUser, isAuthenticated } = useAuth();

  // Name of the screen currently shown in this stack, for active highlighting.
  const activeRoute = useNavigationState((s) => s?.routes?.[s.index]?.name);
  const isOn = (name) => activeRoute === name;

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <StatusBar backgroundColor={HEADER_BG} barStyle="light-content" />

      <View style={styles.header}>
        {/* Top row: brand + menu */}
        <View style={styles.topRow}>
          <Image source={require('../assets/logo.png')} style={styles.logo} />
          <Text style={styles.title}>ADVENT LIGHT</Text>
          <View style={styles.menuContainer}>
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
  );
};

const styles = StyleSheet.create({
  safeArea: { backgroundColor: HEADER_BG },
  header: {
    backgroundColor: HEADER_BG,
    paddingHorizontal: 14,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  logo: { width: 64, height: 38, resizeMode: 'contain' },
  title: {
    color: colors.accent,
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginLeft: 10,
  },
  menuContainer: { marginLeft: 'auto' },
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
