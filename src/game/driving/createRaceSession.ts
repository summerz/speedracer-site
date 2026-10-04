import { DRONE_CATALOG } from '../drone/droneCatalog.js';
import type { DroneConfiguration } from '../drone/droneConfiguration.js';
import { upcomingHeightObstacle } from '../track/createTrack.js';
import type { Track } from '../track/createTrack.js';
import { steeringYawRate } from './createDrivingModel.js';
import type { DrivingInput, DrivingState } from './createDrivingModel.js';
import { createTimeAttack } from './createTimeAttack.js';
import { createRaceRecords } from './raceRecords.js';

export type RaceMode = 'time-attack' | 'competition';
export interface Standing {
  id: string; name: string; color: string; player: boolean;
  distance: number; completedLaps: number; finishTime: number | null; rank: number;
}
export interface CompetitionSnapshot {
  standings: Standing[]; playerRank: number; complete: boolean;
}

/** Unwrapped distance separates lapped runners; interpolated finish times decide finish order. */
export function rankParticipants(entries: Omit<Standing, 'rank'>[]): Standing[] {
  return [...entries].sort((a, b) => {
    if (a.finishTime !== null && b.finishTime !== null) return a.finishTime - b.finishTime || Number(b.player) - Number(a.player) || a.id.localeCompare(b.id);
    if (a.finishTime !== null) return -1;
    if (b.finishTime !== null) return 1;
    return b.distance - a.distance || Number(b.player) - Number(a.player) || a.id.localeCompare(b.id);
  }).map((entry, i) => ({ ...entry, rank: i + 1 }));
}

type ContactPose = Pick<DrivingState, 'distance' | 'offset' | 'altitude'>;
/** Swept track-space boxes catch fast overtakes, including racers a lap apart and the start seam. */
export function craftContact(a0: ContactPose, a1: ContactPose, b0: ContactPose, b1: ContactPose, length: number): boolean {
  const d0 = a0.distance - b0.distance;
  const nearestLap = Math.round(d0 / length) * length;
  const starts = [d0 - nearestLap, a0.offset - b0.offset, a0.altitude - b0.altitude];
  const ends = [a1.distance - b1.distance - nearestLap, a1.offset - b1.offset, a1.altitude - b1.altitude];
  const sizes = [4.4, 3.2, 1.1];
  let enter = 0, leave = 1;
  for (let axis = 0; axis < 3; axis++) {
    const velocity = ends[axis] - starts[axis];
    if (Math.abs(velocity) < 1e-9) { if (Math.abs(starts[axis]) > sizes[axis]) return false; continue; }
    const x = (-sizes[axis] - starts[axis]) / velocity, y = (sizes[axis] - starts[axis]) / velocity;
    enter = Math.max(enter, Math.min(x, y)); leave = Math.min(leave, Math.max(x, y));
    if (enter > leave) return false;
  }
  return true;
}

/** AI makes ordinary driving decisions; it never writes speed, distance or lap progress. */
export function aiDrivingInput(track: Track, configuration: DroneConfiguration, state: DrivingState,
  index: number, opponents: readonly DrivingState[]): DrivingInput {
  const p = configuration.performance;
  const curvature = track.sample(state.distance).curvature;
  const bend = Math.max(Math.abs(curvature), Math.abs(track.sample(state.distance + 25).curvature), Math.abs(track.sample(state.distance + 55).curvature));
  const difficulty = track.altitudeProfile.levels.length;
  const pace = difficulty === 2 ? .82 : difficulty === 3 ? .91 : 1;
  const boost = bend < .0025 && Math.sin(state.elapsed * .28 + index * 1.8) > .12
    && !state.boostNeedsRelease && (state.boosting ? state.charge > .04 : state.charge > .65);
  const desiredSpeed = (boost ? p.boostStage2Speed : p.topSpeed) * pace * (1 + .045 * Math.sin(state.elapsed * .09 + index));
  const goalSpeed = Math.min(desiredSpeed, (.57 + index * .025) / Math.max(.001, bend));
  const edge = track.halfWidth - 3.5;
  let lane = (index - 1) * Math.min(4.5, edge * .7) + Math.sin(state.distance / 210 + index * 2) * 1.3;
  for (const other of opponents) {
    const ahead = ((other.distance - state.distance) % track.length + track.length) % track.length;
    if (ahead > 0 && ahead < 22 && Math.abs(other.offset - lane) < 3.5 && Math.abs(other.altitude - state.altitude) < 1.5) {
      lane = other.offset > 0 ? other.offset - 4.5 : other.offset + 4.5; break;
    }
  }
  lane = Math.max(-edge, Math.min(edge, lane));
  const next = upcomingHeightObstacle(track, state.distance);
  let lift = 0;
  if (next && next.distance < Math.max(70, state.speed * 2.2)) {
    const level = track.altitudeProfile.levels.findIndex(h => h >= next.obstacle.minAltitude && h <= next.obstacle.maxAltitude);
    if (level >= 0) lift = Math.sign(level - state.altitudeLevel);
  }
  return { throttle: true, brake: state.speed > goalSpeed + 1, boost,
    steer: (curvature * state.speed - state.heading * 2.8 + (lane - state.offset) * .14) / Math.max(.1, steeringYawRate(state.speed, p)), lift };
}

/** One clock, countdown and pause lifecycle for both modes; completed pilots become ghosts. */
export function createRaceSession(track: Track, configuration: DroneConfiguration,
  records: ReturnType<typeof createRaceRecords>, focusSlots = 0, mode: RaceMode = 'time-attack') {
  const player = createTimeAttack(track, configuration.performance, records, focusSlots);
  const candidates = DRONE_CATALOG.filter(entry => entry.configuration.modelVariant !== configuration.modelVariant).slice(0, 3);
  const rivals = mode === 'competition' ? candidates.map((entry, index) => ({
    id: `ai-${index + 1}`, name: entry.name, color: entry.lineColor, configuration: entry.configuration,
    controller: createTimeAttack(track, entry.configuration.performance,
      createRaceRecords({ trackId: 'ai-memory', configurationId: entry.name }), focusSlots),
  })) : [];
  const craft = DRONE_CATALOG.find(c => c.configuration.modelVariant === configuration.modelVariant);
  const participants = [{ id: 'player', name: craft?.name ?? 'PLAYER',
    color: craft?.lineColor ?? configuration.boostStyle.pulseColor, configuration, controller: player }, ...rivals];
  const contacts = new Map<string, number>();
  let clock = 0;
  const grid = () => {
    contacts.clear(); clock = 0;
    rivals.forEach((rival, index) => {
      rival.controller.model.state.distance = -(index + 1) * 7;
      rival.controller.model.state.offset = (index - 1) * Math.min(4.5, track.halfWidth - 3.5);
    });
  };
  grid();
  const competition = (): CompetitionSnapshot | null => {
    if (!rivals.length) return null;
    const standings = rankParticipants(participants.map(p => {
      const s = p.controller.snapshot();
      return { id: p.id, name: p.name, color: p.color, player: p === participants[0],
        distance: p.controller.model.state.distance, completedLaps: s.completedLaps, finishTime: s.finishTime };
    }));
    return { standings, playerRank: standings.find(p => p.player)!.rank, complete: standings.every(p => p.finishTime !== null) };
  };
  return {
    model: player.model, rivals,
    get phase() { return player.phase; },
    snapshot() { return { ...player.snapshot(), mode, competition: competition() }; },
    start() {
      const fresh = player.phase === 'ready' || player.phase === 'finished';
      player.start(); rivals.forEach(p => fresh ? p.controller.restart() : p.controller.start()); if (fresh) grid();
    },
    restart() { player.restart(); rivals.forEach(p => p.controller.restart()); grid(); },
    pause() { player.pause(); rivals.forEach(p => p.controller.pause()); },
    recover() { player.recover(); },
    useFocus() {
      if (!player.useFocus()) return false;
      rivals.forEach(p => p.controller.useFocus()); return true;
    },
    step(delta: number, input: DrivingInput) {
      const dt = Math.max(0, Math.min(Number.isFinite(delta) ? delta : 0, .1));
      if (player.phase === 'ready' || player.phase === 'paused' || dt === 0) return;
      if (!rivals.length) { player.step(dt, input); return; }
      // Small shared substeps keep contact decisions stable across rendering frame rates.
      let remaining = dt; let firstStep = true;
      while (remaining > 1e-8) {
        const step = Math.min(remaining, 1 / 120); remaining -= step;
        const before = participants.map(p => ({ ...p.controller.model.state }));
        const active = participants.map(p => p.controller.phase === 'running');
        player.step(step, { ...input, lift: firstStep ? input.lift : 0 }); firstStep = false;
        rivals.forEach((rival, index) => {
          const opponents = participants.filter(p => p !== rival && p.controller.phase !== 'finished').map(p => p.controller.model.state);
          rival.controller.step(step, aiDrivingInput(track, rival.configuration, rival.controller.model.state, index, opponents));
        });
        if (participants.some(p => p.controller.phase === 'running')) clock += step;
        for (let a = 0; a < participants.length; a++) for (let b = a + 1; b < participants.length; b++) {
          if (!active[a] || !active[b] || participants[a].controller.phase !== 'running' || participants[b].controller.phase !== 'running') continue;
          const key = `${a}:${b}`;
          const sa = participants[a].controller.model.state, sb = participants[b].controller.model.state;
          if (clock < (contacts.get(key) ?? 0) || !craftContact(before[a], sa, before[b], sb, track.length)) continue;
          participants[a].controller.model.contact(); participants[b].controller.model.contact();
          contacts.set(key, clock + .7);
        }
      }
    },
  };
}
