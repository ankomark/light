import React from "react";
import { Image, View, Text, StyleSheet } from "react-native";
import { useAuth } from "../hooks/useAuth";

const UserProfile = ({ profile, size = 200 }) => {
  const { currentUser } = useAuth();
  const displayedProfile = profile || currentUser;

  if (!displayedProfile) return null;

  return (
    <View style={styles.container}>
      <Image
        source={{ 
          uri: displayedProfile.profile_picture,
          cache: 'force-cache'
        }}
        style={[styles.profilePicture, { width: size, height: size, borderRadius: size/2 }]}
        resizeMode="cover"
        onError={(e) => console.log("Image load error:", e.nativeEvent.error)}
      />
      <View style={styles.detailsContainer}>
        <Text style={styles.username}>{displayedProfile.username}</Text>
        {displayedProfile.bio && <Text style={styles.bio}>{displayedProfile.bio}</Text>}
        {displayedProfile.location && (
          <Text style={styles.location}>{displayedProfile.location}</Text>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    backgroundColor: '#fff',
    borderRadius: 8,
    marginVertical: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  profilePicture: {
    width: 60,
    height: 60,
    borderRadius: 30,
    marginRight: 15,
  },
  detailsContainer: {
    flex: 1,
  },
  username: {
    fontWeight: 'bold',
    fontSize: 16,
    marginBottom: 4,
  },
  bio: {
    fontSize: 14,
    color: '#666',
    marginBottom: 2,
  },
  location: {
    fontSize: 12,
    color: '#999',
    fontStyle: 'italic',
  },
});

export default UserProfile;