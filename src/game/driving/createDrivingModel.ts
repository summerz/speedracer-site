import { DEFAULT_DRONE_CONFIGURATION } from '../drone/droneConfiguration.js';
import type { DronePerformance } from '../drone/droneConfiguration.js';
import type { Track } from '../track/createTrack';
import { ALTITUDE_PROFILES, resolveAltitudeProfile } from '../track/altitudeProfile.js';
import type { TravelSegment } from './raceProgress.js';

/** lift is a single tap impulse (-1 / 0 / 1), never a held key. */
export interface DrivingInput { throttle: boolean; brake: boolean; steer: number; lift: number; boost: boolean }
export interface DrivingState {
  distance: number;
  offset: number;
  heading: number;
  altitude: number;
  targetAltitude: number;
  altitudeLevel: number;
  speed: number;
  charge: number;
  boosting: boolean;
  boostStage: 0 | 1 | 2;
  boostElapsed: number;
  boostStageProgress: number;
  boostNeedsRelease: boolean;
  checkpoint: number;
  elapsed: number;
  collisions: number;
  recoveries: number;
  offTrackExits: number;
  penaltyPoints: number;
  notice: 'collision' | 'craft-collision' | 'height-collision' | 'off-track' | 'recovery' | null;
}

export const OFF_TRACK_PENALTY_POINTS = 5;

export const DRIVING_TUNING = {
  ...DEFAULT_DRONE_CONFIGURATION.performance, drag: 5,
  minAltitude: ALTITUDE_PROFILES.beginner.levels[0], maxAltitude: ALTITUDE_PROFILES.beginner.levels[1],
  defaultAltitude: ALTITUDE_PROFILES.beginner.levels[0], craftHalfWidth: 1.6, craftHalfLength: 2.2,
} as const;

export const NEUTRAL_INPUT: DrivingInput = { throttle: false, brake: false, steer: 0, lift: 0, boost: false };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Gentle speed-dependent yaw loss keeps lateral response growing during boost. */
export function steeringYawRate(speed: number, performance: DronePerformance = DEFAULT_DRONE_CONFIGURATION.performance) {
  return performance.maxYawRate / (1 + speed * 0.006 + Math.sqrt(Math.max(0, speed - performance.corneringReferenceSpeed)) * performance.highSpeedSteeringLoss) * Math.min(speed / 10, 1);
}

/** Track coordinates are the simulation; Three.js objects only display the resulting pose. */
export function createDrivingModel(track: Track, performance: DronePerformance = DEFAULT_DRONE_CONFIGURATION.performance) {
  const altitudeProfile = resolveAltitudeProfile(track.altitudeProfile);
  const { levels, initialLevel, transitionSeconds } = altitudeProfile;
  const initialAltitude = levels[initialLevel];
  const state: DrivingState = {
    distance: 0, offset: 0, heading: 0, altitude: initialAltitude, targetAltitude: initialAltitude, altitudeLevel: initialLevel,
    speed: 0, charge: 1, boosting: false, boostStage: 0, boostElapsed: 0, boostStageProgress: 0, boostNeedsRelease: false, checkpoint: 0, elapsed: 0,
    collisions: 0, recoveries: 0, offTrackExits: 0, penaltyPoints: 0, notice: null,
  };
  const initial = { ...state };
  const frame = track.sample(0);
  let rechargeDelay = 0;
  let impactCooldown = 0;
  let noticeRemaining = 0;
  let heightSwitchSpeed = 0;
  let offTrackEpisode = false;
  // One penalty per field passage, even when the craft remains inside its volume.
  const fieldPassages = new Map<number, number>();
  const tuning = { ...DRIVING_TUNING, ...performance };
  const boostStage2Seconds = tuning.boostStage2Threshold / tuning.boostDrain;
  const interruptBoost = () => {
    state.boosting = false; state.boostStage = 0; state.boostElapsed = 0; state.boostStageProgress = 0;
  };
  const recover = () => {
    fieldPassages.clear();
    state.distance = state.checkpoint;
    state.offset = 0; state.heading = 0; state.altitude = initialAltitude; state.targetAltitude = initialAltitude;
    state.altitudeLevel = initialLevel; heightSwitchSpeed = 0;
    state.speed = Math.min(state.speed, 12); interruptBoost();
    state.recoveries++; state.notice = 'recovery'; noticeRemaining = 1.8;
    rechargeDelay = Math.max(rechargeDelay, 0.6);
  };
  return {
    state,
    altitudeProfile,
    boostStage2Seconds,
    interruptBoost,
    contact() {
      state.speed *= 1 - tuning.collisionSpeedLoss * 0.7;
      state.collisions++;
      state.notice = 'craft-collision'; noticeRemaining = 0.8;
    },
    reset() {
      Object.assign(state, initial);
      fieldPassages.clear();
      rechargeDelay = 0; impactCooldown = 0; noticeRemaining = 0; heightSwitchSpeed = 0;
      offTrackEpisode = false;
    },
    recover,
    step(delta: number, input: DrivingInput, onTravel?: (segment: TravelSegment) => boolean) {
      if (input.lift !== 0) {
        const nextLevel = clamp(state.altitudeLevel + Math.sign(input.lift), 0, levels.length - 1);
        if (nextLevel !== state.altitudeLevel) {
          const spacing = Math.abs(levels[nextLevel] - levels[state.altitudeLevel]);
          state.altitudeLevel = nextLevel;
          state.targetAltitude = levels[nextLevel];
          // Rapid consecutive taps retain a brisk speed without teleporting the craft.
          heightSwitchSpeed = spacing / transitionSeconds;
        }
      }
      // A suspended or blocked frame never advances the simulation by a large jump.
      let remaining = clamp(delta, 0, 0.1);
      while (remaining > 1e-8) {
        const dt = Math.min(remaining, 1 / 120); remaining -= dt;
        const timeFrom = state.elapsed;
        const offsetFrom = state.offset;
        state.elapsed += dt;
        impactCooldown = Math.max(0, impactCooldown - dt);
        noticeRemaining = Math.max(0, noticeRemaining - dt);
        if (noticeRemaining === 0) state.notice = null;
        if (!input.boost && state.charge >= 0.15) state.boostNeedsRelease = false;
        state.boosting = input.boost && !input.brake && !state.boostNeedsRelease && state.charge > 0;
        if (state.boosting) {
          state.boostElapsed += dt;
          state.boostStageProgress = Math.min(1, state.boostElapsed / boostStage2Seconds);
          state.boostStage = state.boostElapsed + 1e-8 >= boostStage2Seconds ? 2 : 1;
          state.charge = Math.max(0, state.charge - tuning.boostDrain * dt);
          rechargeDelay = 0.8;
          if (state.charge <= 1e-8) { state.charge = 0; state.boostNeedsRelease = true; interruptBoost(); }
        } else {
          interruptBoost();
          rechargeDelay = Math.max(0, rechargeDelay - dt);
          if (rechargeDelay === 0) state.charge = Math.min(1, state.charge + tuning.boostRecovery * dt);
        }
        const oldSpeed = state.speed;
        const limit = state.boostStage === 2 ? tuning.boostStage2Speed : state.boosting ? tuning.boostSpeed : tuning.topSpeed;
        const acceleration = input.brake ? (state.speed < tuning.crawlSpeed ? tuning.acceleration : -tuning.braking)
          : state.boostStage === 2 ? tuning.boostStage2Acceleration : state.boosting ? tuning.boostAcceleration : input.throttle ? tuning.acceleration : -tuning.drag;
        state.speed = clamp(state.speed + acceleration * dt, 0, Math.max(limit, state.speed));
        if (input.brake) state.speed = oldSpeed >= tuning.crawlSpeed ? Math.max(tuning.crawlSpeed, state.speed) : Math.min(tuning.crawlSpeed, state.speed);
        if (state.speed > limit) state.speed = Math.max(limit, state.speed - 18 * dt);
        const speed = (oldSpeed + state.speed) * 0.5;
        const curvature = track.sample(state.distance, frame).curvature;
        const travel = speed * Math.cos(state.heading) / Math.max(0.5, 1 - curvature * state.offset);
        const turnRate = clamp(input.steer, -1, 1) * steeringYawRate(speed, tuning);
        const oldHeading = state.heading;
        state.heading = clamp(state.heading + (turnRate - curvature * travel) * dt, -1.1, 1.1);
        state.offset += speed * Math.sin((oldHeading + state.heading) * 0.5) * dt;
        const oldDistance = state.distance;
        state.distance += travel * dt;
        state.altitude += clamp(state.targetAltitude - state.altitude, -heightSwitchSpeed * dt, heightSwitchSpeed * dt);
        // Swept travel catches boost-speed crossings. Fields let the craft continue.
        for (let i = 0; i < track.heightObstacles.length; i++) {
          const obstacle = track.heightObstacles[i];
          const lap = Math.floor(oldDistance / track.length);
          const center = obstacle.distance + lap * track.length;
          const front = center - obstacle.depth / 2 - tuning.craftHalfLength;
          const rear = center + obstacle.depth / 2 + tuning.craftHalfLength;
          if (oldDistance <= rear && state.distance >= front && fieldPassages.get(i) !== lap
            && Math.abs(state.offset) < track.halfWidth + tuning.craftHalfWidth
            && (state.altitude < obstacle.minAltitude || state.altitude > obstacle.maxAltitude)) {
            fieldPassages.set(i, lap);
            const severity = (1 - obstacle.speedRetention) / DEFAULT_DRONE_CONFIGURATION.performance.collisionSpeedLoss;
            state.speed *= Math.max(0.05, 1 - severity * tuning.collisionSpeedLoss);
            state.collisions++;
            state.notice = 'height-collision'; noticeRemaining = 1.2;
          }
        }
        const boundary = track.halfWidth - tuning.craftHalfWidth;
        if (Math.abs(state.offset) < boundary - 0.5) offTrackEpisode = false;
        // High flight can clear the posts. Keep forward progress when it strays
        // beyond the road; one excursion earns one penalty until safely back in.
        if (Math.abs(state.offset) > track.halfWidth + 1) {
          const side = Math.sign(state.offset);
          state.offset = side * track.halfWidth;
          if (state.heading * side > 0) state.heading = -side * 0.12;
          if (!offTrackEpisode) {
            offTrackEpisode = true;
            state.offTrackExits++; state.penaltyPoints += OFF_TRACK_PENALTY_POINTS;
            state.speed *= 1 - tuning.collisionSpeedLoss;
            state.notice = 'off-track'; noticeRemaining = 1.8;
          }
        }
        if (Math.abs(state.offset) > boundary && state.altitude <= 3.2) {
          const side = Math.sign(state.offset);
          state.offset = side * boundary;
          if (state.heading * side > 0) state.heading = -side * 0.12;
          if (impactCooldown === 0) {
            state.speed *= 1 - tuning.collisionSpeedLoss; state.collisions++; impactCooldown = 0.5;
            if (state.notice !== 'off-track') { state.notice = 'collision'; noticeRemaining = 0.8; }
          }
        }
        if (!Number.isFinite(state.distance + state.offset)) {
          recover(); continue;
        }
        if (onTravel?.({ from: oldDistance, to: state.distance, offsetFrom, offsetTo: state.offset, timeFrom, timeTo: state.elapsed })) break;
        const checkpoint = Math.floor(state.distance / track.checkpointSpacing) * track.checkpointSpacing;
        if (!onTravel && checkpoint > state.checkpoint && oldDistance <= checkpoint) state.checkpoint = checkpoint;
      }
    },
  };
}
