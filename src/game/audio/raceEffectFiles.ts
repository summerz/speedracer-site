import collision from '../../assets/audio/collision.mp3';
import offTrack from '../../assets/audio/off-track.mp3';
import type { RaceEffectFiles } from './soundEffectBank.js';

// Imported resources receive content hashes and are included in the PWA shell.
export const RACE_EFFECT_FILES: RaceEffectFiles = {
  impact: { url: collision, level: .65 },
  'off-track': { url: offTrack, level: .5 },
};
