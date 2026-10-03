// Single & Searching screens open at once: the last copy (this session's
// memory, else the phone's) is drawn on the first render, then refreshed
// behind it — and again each time the screen comes back into view. Keys are
// per account, so two people sharing a phone never see each other's.
import { useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import useCachedData from '../../utils/useCachedData';
import { userKey } from '../../utils/screenCache';
import { useAuth } from '../../context/useAuth';

export default function useSingles(name, fetcher, { enabled = true } = {}) {
  const { currentUser } = useAuth();
  const key = currentUser?.id ? userKey(currentUser.id, `singles:${name}`) : null;
  const state = useCachedData(key, fetcher, { enabled });
  // useCachedData loads when it mounts; a later return to the screen
  // refreshes quietly (the copy on screen stays meanwhile).
  const mounted = useRef(false);
  const { reload } = state;
  useFocusEffect(useCallback(() => {
    if (mounted.current) reload();
    mounted.current = true;
  }, [reload]));
  return state;
}
