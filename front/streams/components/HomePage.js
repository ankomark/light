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
  const { isAuthenticated, isLoading } = useAuth();
  const navigation = useNavigation();

  React.useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      navigation.navigate('Login');
    }
  }, [isAuthenticated, isLoading]);

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
