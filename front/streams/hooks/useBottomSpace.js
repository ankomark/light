/**
 * Room to leave at the bottom of a scrolling screen: the phone's own bottom
 * inset (iPhone home indicator, Android gesture bar) plus the mini player
 * when a song is loaded — so the last row and any floating button are never
 * hidden under either. `extra` is the screen's own breathing room.
 *
 * One rule for every screen: lists used fixed numbers (110, 140) that were
 * too little on some phones and too much on others.
 */
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayer } from '../context/PlayerContext';

// The mini player's height above the inset (its card plus its gap).
export const MINI_PLAYER_SPACE = 76;

export default function useBottomSpace(extra = 20) {
  const insets = useSafeAreaInsets();
  const { currentTrack } = usePlayer();
  return extra + (insets?.bottom || 0) + (currentTrack ? MINI_PLAYER_SPACE : 0);
}
