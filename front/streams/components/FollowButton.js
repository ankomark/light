
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { TouchableOpacity, Text, StyleSheet, View } from 'react-native';
import { followUser } from '../services/api';

const FollowButton = ({
  userId,
  initialFollowing,
  initialFollowersCount,
  initialFollowStatus,   // 'following' | 'requested' | 'none'
  onFollowChange,
}) => {
  // Three states, not two: following a private account leaves the request
  // pending, and the button has to say so rather than claim it worked.
  const resolved = initialFollowStatus ?? (initialFollowing ? 'following' : 'none');
  const [followStatus, setFollowStatus] = useState(resolved);
  const [followersCount, setFollowersCount] = useState(initialFollowersCount || 0);

  // Same reconcile loop as the like/save buttons: the label always shows what
  // the user last asked for, and the request catches up behind it. Previously
  // the optimistic update was computed and then immediately covered by an
  // ActivityIndicator, so following someone looked like waiting rather than
  // following, and a re-tap during the request was dropped on the floor.
  const desired = useRef(resolved === 'following');   // what the user wants
  const server = useRef(resolved === 'following');    // what we think is stored
  const serverCount = useRef(initialFollowersCount || 0);
  const inFlight = useRef(false);

  // Adopt new props (row recycled, profile refreshed) only when the user's own
  // intent has settled — otherwise a stale prop would undo a fresh tap.
  useEffect(() => {
    if (inFlight.current || desired.current !== server.current) return;
    const next = initialFollowStatus ?? (initialFollowing ? 'following' : 'none');
    setFollowStatus(next);
    setFollowersCount(initialFollowersCount || 0);
    desired.current = next === 'following';
    server.current = next === 'following';
    serverCount.current = initialFollowersCount || 0;
  }, [initialFollowing, initialFollowersCount, initialFollowStatus]);

  const sync = useCallback(async () => {
    if (inFlight.current || desired.current === server.current) return;
    inFlight.current = true;
    try {
      const response = await followUser(userId);
      const serverFollowing = !!response.is_following;
      const serverStatus =
        response.follow_status ?? (serverFollowing ? 'following' : 'none');
      server.current = serverFollowing;
      if (typeof response.followers_count === 'number') {
        serverCount.current = response.followers_count;
      }

      if (server.current === desired.current) {
        // Settled. The server's answer is authoritative — and it's the only
        // thing that can tell us a private account turned this into a request.
        setFollowStatus(serverStatus);
        setFollowersCount(serverCount.current);
        onFollowChange?.({
          id: userId,
          is_following: serverFollowing,
          follow_status: serverStatus,
          followers_count: serverCount.current,
        });
      }
    } catch (error) {
      console.error('Follow error:', error);
      desired.current = server.current;                   // roll back
      setFollowStatus(server.current ? 'following' : 'none');
      setFollowersCount(serverCount.current);
      onFollowChange?.({
        id: userId,
        is_following: server.current,
        follow_status: server.current ? 'following' : 'none',
        followers_count: serverCount.current,
      });
    } finally {
      inFlight.current = false;
      if (desired.current !== server.current) sync();     // tapped again mid-flight
    }
  }, [userId, onFollowChange]);

  const handleFollow = useCallback(() => {
    const next = !desired.current;
    desired.current = next;
    // Paint this frame. A private account may come back 'requested' instead,
    // which `sync` corrects on settle — optimistically showing 'Following' is
    // the right guess for the common case.
    setFollowStatus(next ? 'following' : 'none');
    setFollowersCount((c) => (next ? c + 1 : Math.max(0, c - 1)));
    sync();
  }, [sync]);

  const isFollowing = followStatus === 'following';
  const isRequested = followStatus === 'requested';

  return (
    <TouchableOpacity
      style={[
        styles.button,
        isFollowing ? styles.unfollowButton : styles.followButton,
        isRequested && styles.requestedButton,
      ]}
      onPress={handleFollow}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityState={{ selected: isFollowing }}
    >
      <View style={styles.buttonContent}>
        <Text style={styles.buttonText}>
          {isFollowing ? 'Following' : isRequested ? 'Requested' : 'Follow'}
        </Text>
        {/* Only show count when following and count > 0 */}
        {isFollowing && followersCount > 0 && (
          <Text style={styles.followersCountText}>
            {followersCount}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    paddingHorizontal: 15,
    paddingVertical: 6,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    minWidth: 80, // Prevent button width changes
  },
  followButton: {
    backgroundColor: '#1DA1F2',
  },
  unfollowButton: {
    backgroundColor: 'orange',
    borderWidth: 1,
    borderColor: '#657786',
  },
  // Pending request: muted, so it reads as "waiting" rather than "done".
  requestedButton: {
    backgroundColor: '#657786',
    borderWidth: 1,
    borderColor: '#8899A6',
  },
  disabledButton: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  followersCountText: {
    color: '#fff',
    fontSize: 12,
    marginLeft: 5,
    fontWeight: '600',
  },
  disabledText: {
    opacity: 0.8,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default FollowButton;