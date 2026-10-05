import type { DrivingState } from './createDrivingModel.js';
import type { RacePhase } from './createTimeAttack.js';
import { upcomingHeightObstacle, type Track } from '../track/createTrack.js';

export type AltitudeWarning = 'up' | 'down' | null;
export type BoostSoundCue = 'boost-full' | 'boost-complete';

/** Edge-triggered boost cues, and an altitude warning within the approaching field's sight range. */
export function createRaceSoundFeedback(track: Track, warningSeconds = 1.5) {
  let charge = 1;
  let fullUse = false;
  let collisions = 0, exits = 0;
  return {
    reset() { charge = 1; fullUse = false; collisions = 0; exits = 0; },
    update(phase: RacePhase, state: DrivingState) {
      const cues: BoostSoundCue[] = [];
      if (phase !== 'running') return { cues, warning: null as AltitudeWarning };
      if (charge >= .999999 && state.charge < charge && state.boosting) fullUse = true;
      if (state.collisions > collisions || state.offTrackExits > exits) fullUse = false;
      collisions = state.collisions; exits = state.offTrackExits;
      if (charge > 0 && state.charge === 0 && fullUse) { cues.push('boost-complete'); fullUse = false; }
      if (state.charge > 0 && !state.boosting) fullUse = false;
      if (charge < .999999 && state.charge >= .999999) cues.push('boost-full');
      charge = state.charge;
      const next = upcomingHeightObstacle(track, state.distance);
      // Keep challenge-specific reaction distance even when speed reaches the warning cap.
      const range = Math.min(240, Math.max(85, state.speed * 1.5)) * warningSeconds / 1.5;
      const target = state.targetAltitude;
      const current = state.altitude;
      let warning: AltitudeWarning = null;
      if (next && next.distance >= 0 && next.distance <= range) {
        const { minAltitude, maxAltitude } = next.obstacle;
        // Warn about the actual position first, then a wrongly selected target.
        if (current < minAltitude) warning = 'up';
        else if (current > maxAltitude) warning = 'down';
        else if (target < minAltitude) warning = 'up';
        else if (target > maxAltitude) warning = 'down';
      }
      return { cues, warning };
    },
  };
}
