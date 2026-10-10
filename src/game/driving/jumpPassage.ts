import type { Track } from '../track/createTrack.js';

export interface JumpPose { distance: number; altitude: number; offset: number; routeId?: string | null }
/** A single swept launch/landing judgment per jump and lap; recovery cannot farm passes or repeat penalties. */
export function createJumpTracker(track: Track) {
  const attempts = new Map<string, { lap: number; launched: boolean; missed: boolean; finished: boolean }>();
  return {
    reset() { attempts.clear(); },
    update(from: JumpPose, to: JumpPose, protectedFlight = false): ('landed' | 'missed')[] {
      const events: ('landed' | 'missed')[] = [];
      if (to.distance <= from.distance) return events;
      const at = (distance: number) => {
        const u = Math.max(0, Math.min(1, (distance - from.distance) / (to.distance - from.distance)));
        return { altitude: from.altitude + (to.altitude - from.altitude) * u,
          offset: from.offset + (to.offset - from.offset) * u };
      };
      for (const j of track.jumps ?? []) {
        if (j.routeId !== to.routeId) continue;
        const lap = Math.floor(from.distance / track.length), start = j.start + lap * track.length, end = j.landingEnd + lap * track.length;
        if (to.distance < start || from.distance > end) continue;
        let attempt = attempts.get(j.id);
        if (!attempt || attempt.lap !== lap) {
          attempt = { lap, launched: false, missed: false, finished: false }; attempts.set(j.id, attempt);
        }
        if (attempt.finished) continue;
        const miss = () => { if (!attempt.missed) { attempt.missed = true; events.push('missed'); } };
        const inside = (pose: ReturnType<typeof at>) => Math.abs(pose.offset) <= track.halfWidth - 1.6;
        if (from.distance <= start && to.distance >= start) {
          const pose = at(start);
          attempt.launched = protectedFlight || (pose.altitude >= track.altitudeProfile.levels[j.launchLevel] - .6 && inside(pose));
          if (!attempt.launched) miss();
        }
        if (to.distance >= end) {
          attempt.finished = true;
          const pose = at(end);
          if (protectedFlight || (attempt.launched && pose.altitude <= track.altitudeProfile.levels[j.landingLevel] + .75 && inside(pose))) {
            if (!attempt.missed) events.push('landed');
          } else miss();
        }
      }
      return events;
    },
  };
}
