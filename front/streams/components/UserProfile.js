import React from "react";

const UserProfile = ({ profile }) => {
  if (!profile) return null;

  return (
    <div className="user-profile">
      <img
        src={profile.profile_picture}
        alt={`${profile.user}'s profile`}
        className="profile-picture"
      />
      <div className="profile-details">
        <h3>{profile.user}</h3>
        <p>{profile.bio}</p>
        <p>{profile.location}</p>
      </div>
    </div>
  );
};

export default UserProfile;
