// import React from "react";

// const UserProfile = ({ profile }) => {
//   if (!profile) return null;

//   return (
//     <div className="user-profile">
//       <img
//         src={profile.profile_picture}
//         alt={`${profile.user}'s profile`}
//         className="profile-picture"
//       />
//       <div className="profile-details">
//         <h3>{profile.user}</h3>
//         <p>{profile.bio}</p>
//         <p>{profile.location}</p>
//       </div>
//     </div>
//   );
// };

// export default UserProfile;
import React from "react";
import { Image, View, Text, StyleSheet } from "react-native";

const UserProfile = ({ profile }) => {
  if (!profile) return null;

  // Cloudinary image URL construction
  const getCloudinaryUrl = (publicId, width = 200, height = 200) => {
    if (!publicId) return null;
    
    // Check if it's already a URL (for backward compatibility)
    if (publicId.startsWith('http')) {
      return publicId;
    }
    
    return `https://res.cloudinary.com/YOUR_CLOUD_NAME/image/upload/w_${width},h_${height},c_fill/${publicId}`;
  };

  return (
    <View style={styles.container}>
      <Image
        source={{ uri: getCloudinaryUrl(profile.profile_picture) || 'https://via.placeholder.com/200' }}
        style={styles.profilePicture}
        resizeMode="cover"
        onError={(e) => console.log("Image load error:", e.nativeEvent.error)}
      />
      <View style={styles.detailsContainer}>
        <Text style={styles.username}>{profile.user}</Text>
        {profile.bio && <Text style={styles.bio}>{profile.bio}</Text>}
        {profile.location && <Text style={styles.location}>{profile.location}</Text>}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
    marginBottom: 16,
  },
  profilePicture: {
    width: 80,
    height: 80,
    borderRadius: 40,
    marginRight: 16,
  },
  detailsContainer: {
    flex: 1,
  },
  username: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  bio: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  location: {
    fontSize: 12,
    color: '#999',
  },
});

export default UserProfile;