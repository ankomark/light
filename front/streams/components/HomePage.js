// import React from "react";
// import { View, Text, StyleSheet } from "react-native";
// import TrackList from "./TrackList";
// // import Footer from "./Footer";
// import SocialFeed from "./SocialFeed";

// const HomePage = () => {
//   return (
//     <View style={styles.container}>
//       <SocialFeed/> 
//     </View>
//   );
// };

// export default HomePage;

// const styles = StyleSheet.create({
//   container: {
//     display:'flex',
//     // marginTop:0,
//     flex: 1,
//     backgroundColor: "#102E50", // Adjust background color to your preference
//   },
 
// });
import React from "react";
import { View, Text, StyleSheet,ActivityIndicator } from "react-native";
import SocialFeed from "./SocialFeed";
import { useAuth } from "../context/useAuth";
import { useNavigation } from '@react-navigation/native';

const HomePage = () => {
  const { isAuthenticated, isEmailVerified, isLoading } = useAuth();
  const navigation = useNavigation();

  React.useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      navigation.navigate('Login');
    } else if (!isEmailVerified) {
      // Email verification is required before app access.
      navigation.reset({ index: 0, routes: [{ name: 'EmailVerification' }] });
    }
  }, [isAuthenticated, isEmailVerified, isLoading]);

  if (isLoading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SocialFeed/> 
    </View>
  );
};

export default HomePage;

const styles = StyleSheet.create({
  container: {
    display:'flex',
    flex: 1,
    backgroundColor: "#102E50",
  },
});
