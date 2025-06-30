import React, { useState } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Text,
  ScrollView,
  Modal,
  SafeAreaView,
  Platform,
  Pressable,
  StatusBar,
} from 'react-native';
import {
  Ionicons,
  MaterialIcons,
  FontAwesome,
  MaterialCommunityIcons,
  Feather
} from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

const { width, height } = Dimensions.get('window');

const COLORS = {
  primary: '#1D478B',
  secondary: '#2E8B57',
  tertiary: '#6A5ACD',
  accent: '#FF6347',
  dark: '#222',
  light: '#888',
  white: '#fff',
  bgGradientStart: '#E0F7FA',
  bgGradientEnd: '#FCE4EC',
  cardBg: '#fff',
};

function HamburgerMenu() {
  const navigation = useNavigation();
  const [menuVisible, setMenuVisible] = useState(false);

  const toggleMenu = () => {
    setMenuVisible(!menuVisible);
  };

  const navigateTo = (screen) => {
    setMenuVisible(false);
    navigation.navigate(screen.replace(/\s+/g, ''));
  };

  const menuItems = [
    { name: 'Groups', icon: 'group', iconType: 'FontAwesome', color: COLORS.tertiary },
    { name: 'Rooms', icon: 'users', iconType: 'Feather', color: COLORS.tertiary },
    { name: 'Churches', icon: 'church', iconType: 'MaterialCommunityIcons', color: COLORS.primary },
    { name: 'Choirs', icon: 'music-note', iconType: 'MaterialIcons', color: COLORS.accent },
    { name: 'Live Events', icon: 'broadcast', iconType: 'MaterialCommunityIcons', color: 'red'},
    { name: 'Unions&Conferences', icon: 'account-group', iconType: 'MaterialCommunityIcons', color: COLORS.primary },
    { name: 'MediaScreen', icon: 'radio', iconType: 'MaterialCommunityIcons', color: COLORS.secondary },
    { name: 'Studios', icon: 'video', iconType: 'Feather', color: COLORS.accent },
    // { name: 'SoloArtist', icon: 'mic', iconType: 'Feather', color: COLORS.primary },
    { name: 'News', icon: 'newspaper', iconType: 'MaterialCommunityIcons', color: COLORS.tertiary },
    { name: 'Market Places', icon: 'shopping-cart', iconType: 'Feather', color: COLORS.accent },
    { name: 'Settings', icon: 'settings', iconType: 'Feather', color: COLORS.light },
    { name: 'About', icon: 'info', iconType: 'Feather', color: COLORS.light },
    { name: 'Help', icon: 'help-circle', iconType: 'Feather', color: COLORS.light },
  ];

  const getIconComponent = (iconType, iconName, color, size) => {
    switch (iconType) {
      case 'MaterialIcons':
        return <MaterialIcons name={iconName} size={size} color={color} />;
      case 'FontAwesome':
        return <FontAwesome name={iconName} size={size} color={color} />;
      case 'MaterialCommunityIcons':
        return <MaterialCommunityIcons name={iconName} size={size} color={color} />;
      case 'Feather':
        return <Feather name={iconName} size={size} color={color} />;
      default:
        return <Ionicons name={iconName} size={size} color={color} />;
    }
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={toggleMenu} style={styles.menuButton}>
        <Ionicons name="menu" size={width * 0.07} color="aliceblue" />
      </TouchableOpacity>

      <Modal visible={menuVisible} animationType="slide" onRequestClose={toggleMenu}  statusBarTranslucent={true}>
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>📂 Navigation Menu</Text>
            <TouchableOpacity onPress={toggleMenu} style={styles.closeButton}>
              <Ionicons name="close-circle" size={30} color={COLORS.accent} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.scrollContainer}>
            {menuItems.map((item, index) => (
              <Pressable
                key={index}
                onPress={() => navigateTo(item.name)}
                android_ripple={{ color: '#ddd' }}
                style={({ pressed }) => [
                  styles.menuItem,
                  { backgroundColor: pressed ? '#F0F8FF' : COLORS.cardBg }
                ]}
              >
                <View style={styles.menuItemLeft}>
                  {getIconComponent(item.iconType, item.icon, item.color, 22)}
                  <Text style={styles.menuText}>{item.name}</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={COLORS.light} />
              </Pressable>
            ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    // padding: 10,
  },
  menuButton: {
    elevation: 3,
    shadowColor: 'white',
    shadowOpacity: 0.1,
    shadowOffset: { width: 1, height: 2 },
  },
  modalContainer: {
    flex: 1,
    backgroundColor:'black',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    backgroundColor: COLORS.primary,
    borderBottomWidth: 1,
    borderBottomColor: '#EEE',
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: COLORS.white,
  },
  closeButton: {
    padding: 5,
  },
  scrollContainer: {
    padding: 10,
  },
  menuItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 6,
    padding: 15,
    borderRadius: 12,
    elevation: 1,
    backgroundColor: COLORS.cardBg,
    shadowColor: '#999',
    shadowOffset: { width: 1, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
  },
  menuText: {
    fontSize: 16,
    color: COLORS.dark,
    fontWeight: '500',
  },
});

export default HamburgerMenu;
