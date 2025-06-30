import React from "react";
import { View, Text, StyleSheet } from "react-native";
import TrackList from "./TrackList";
// import Footer from "./Footer";
import SocialFeed from "./SocialFeed";

const HomePage = () => {
  return (
    <View style={styles.container}>
      <SocialFeed/>
      {/* <TrackList /> */}
      
      {/* <Footer /> */}
    </View>
  );
};

export default HomePage;

const styles = StyleSheet.create({
  container: {
    display:'flex',
    // marginTop:0,
    flex: 1,
    padding: 4,
    backgroundColor: "#102E50", // Adjust background color to your preference
  },
 
});
