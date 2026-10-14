import { useCallback } from 'react';
import { useAudioPlayer } from 'expo-audio';

const SOUNDS = {
  new: require('../../assets/sounds/beep_new.wav'),
  duplicate: require('../../assets/sounds/beep_duplicate.wav'),
  error: require('../../assets/sounds/beep_error.wav'),
};

// Three preloaded players (one per outcome) so playback is instant on scan
// with no file-load delay. `outcome` is one of: 'new' | 'duplicate' | 'error'.
export function useScanSounds() {
  const newPlayer = useAudioPlayer(SOUNDS.new);
  const duplicatePlayer = useAudioPlayer(SOUNDS.duplicate);
  const errorPlayer = useAudioPlayer(SOUNDS.error);

  const playFor = useCallback((outcome) => {
    const player = outcome === 'duplicate' ? duplicatePlayer
      : outcome === 'error' ? errorPlayer
      : newPlayer;
    try {
      player.seekTo(0);
      player.play();
    } catch (e) {
      // Audio isn't critical to the scan flow — fail silently if the
      // device/OS blocks playback for any reason.
    }
  }, [newPlayer, duplicatePlayer, errorPlayer]);

  return playFor;
}
