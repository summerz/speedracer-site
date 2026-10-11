import { createParryController, PARRY_TUNING } from './parry.js';
import type { ParrySnapshot, ParryTarget } from './parry.js';
import { parryWorldPosition, predictParryThreat } from './parryThreat.js';
import { createDriftController, DRIFT_TUNING } from './drift.js';
import type { DriftSnapshot } from './drift.js';
import { createJumpTracker } from './jumpPassage.js';
import { DEFAULT_DRONE_CONFIGURATION } from '../drone/droneConfiguration.js';
import type { DronePerformance } from '../drone/droneConfiguration.js';
import type { Track } from '../track/createTrack';
import { createTrackFrame } from '../track/createTrack.js';
import { forkAt, upcomingFork, selectBranch, routeDistanceScale, branchChoiceOpen, advanceTrackDistance, forkApproachDrift } from '../track/trackBranches.js';
import { flightAcceleration, slopeHandling, impactSpeedRetention, impactAccelerationScale } from './flightDynamics.js';
import { ALTITUDE_PROFILES, altitudeCanPass, resolveAltitudeProfile } from '../track/altitudeProfile.js';
import type { TravelSegment } from './raceProgress.js';
import { resolveHeightObstacle, obstacleInTransition, corridorCanPass } from '../track/obstacleDynamics.js';
import { MINE_SPEED_RETENTION } from '../track/mineField.js';
import { arcRailHit, RING_REACH } from '../track/arcRail.js';
import { CRAFT_HALF_WIDTH } from '../track/mineField.js';
import { OFF_TRACK_PENALTY_POINTS, COLLISION_PENALTY_POINTS, OBSTACLE_COLLISION_PENALTY_POINTS } from './raceScoring.js';
import { AWAKENING_SECONDS, AWAKENING_SPEED_SCALE, AWAKENING_CAPACITY, CORE_REACH, createAwakeningCores, awakeningTarget } from './awakening.js';
export { OFF_TRACK_PENALTY_POINTS, COLLISION_PENALTY_POINTS, OBSTACLE_COLLISION_PENALTY_POINTS } from './raceScoring.js';

/** lift is a single tap impulse (-1 / 0 / 1), never a held key. */
export interface DrivingInput { throttle: boolean; brake: boolean; steer: number; lift: number; boost: boolean; targetAltitudeLevel?: number; targetSpeedScale?: number; guidedSpeedScale?: number; guidedOffset?: number; guidedStopDistance?: number }
export interface DrivingState {
  drift: DriftSnapshot;
  parry: ParrySnapshot;
  routeId?: string | null;
  distance: number;
  offset: number;
  heading: number;
  altitude: number;
  targetAltitude: number;
  altitudeLevel: number;
  speed: number;
  charge: number;
  awakeningCores: number;
  coresCollected: number;
  awakeningRemaining: number;
  awakeningsUsed: number;
  /** Actual transitions into boost, including partial activations. */
  boostUses: number;
  jumpsPassed: number;
  jumpsMissed: number;
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
  obstaclesPassed: number;
  /** Boost pads triggered so far; feedback compares it against the previous frame. */
  boostPads: number;
  /** Boost rings triggered so far (same feedback path as pads). */
  boostRings: number;
  /** Clean passes within `NEAR_MISS_MARGIN` / a late altitude call; the HUD diffs it per event. */
  nearMisses: number;
  /** Hazard passes in a row without an obstacle hit, and the best run so far. */
  cleanStreak: number;
  bestStreak: number;
  notice: 'collision' | 'craft-collision' | 'height-collision' | 'corridor-collision' | 'jump-missed' | 'off-track' | 'recovery' | 'obstacle-pass' | null;
}

export const DRIVING_TUNING = {
  ...DEFAULT_DRONE_CONFIGURATION.performance, drag: 5,
  minAltitude: ALTITUDE_PROFILES.beginner.levels[0], maxAltitude: ALTITUDE_PROFILES.beginner.levels[1],
  defaultAltitude: ALTITUDE_PROFILES.beginner.levels[0], craftHalfWidth: 1.6, craftHalfLength: 2.2,
} as const;

/** Metres of clearance, or seconds since the altitude became safe, under which a pass counts as a near miss. */
export const NEAR_MISS_MARGIN = 1.2, NEAR_MISS_LATE_SECONDS = .4, NEAR_MISS_CHARGE = .08;
/** Pickups can bank an extra half battery; each button press spends at most one. */
export const BOOST_CAPACITY = 1.5, BOOST_ACTIVATION_LIMIT = 1;

export const NEUTRAL_INPUT: DrivingInput = { throttle: false, brake: false, steer: 0, lift: 0, boost: false };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Gentle speed-dependent yaw loss keeps lateral response growing during boost. */
export function steeringYawRate(speed: number, performance: DronePerformance = DEFAULT_DRONE_CONFIGURATION.performance) {
  return performance.maxYawRate / (1 + speed * 0.006 + Math.sqrt(Math.max(0, speed - performance.corneringReferenceSpeed)) * performance.highSpeedSteeringLoss) * Math.min(speed / 10, 1);
}

/** Track coordinates are the simulation; Three.js objects only display the resulting pose. */
export function createDrivingModel(track: Track, performance: DronePerformance = DEFAULT_DRONE_CONFIGURATION.performance, options: { drift?: boolean; parry?: boolean } = {}) {
  const driftController = createDriftController();
  const parry = createParryController(options.parry ?? true);
  const altitudeProfile = resolveAltitudeProfile(track.altitudeProfile);
  const { levels, initialLevel, transitionSeconds } = altitudeProfile;
  const initialAltitude = levels[initialLevel];
  const state: DrivingState = {
    drift: driftController.snapshot(), parry: parry.snapshot(), routeId: null,
    distance: 0, offset: 0, heading: 0, altitude: initialAltitude, targetAltitude: initialAltitude, altitudeLevel: initialLevel,
    speed: 0, charge: 1, awakeningCores: 0, coresCollected: 0, awakeningRemaining: 0, awakeningsUsed: 0,
    boostUses: 0, jumpsPassed: 0, jumpsMissed: 0, boosting: false, boostStage: 0, boostElapsed: 0, boostStageProgress: 0, boostNeedsRelease: false, checkpoint: 0, elapsed: 0,
    collisions: 0, recoveries: 0, offTrackExits: 0, penaltyPoints: 0, obstaclesPassed: 0, boostPads: 0, boostRings: 0, nearMisses: 0, cleanStreak: 0, bestStreak: 0, notice: null,
  };
  const initial = { ...state };
  const jumps = createJumpTracker(track);
  const frame = track.sample(0);
  const aheadFrame = createTrackFrame();
  let rechargeDelay = 0;
  let boostSpent = 0;
  let impactCooldown = 0;
  let wallEpisode = 0, wallContact = false, wallClearSeconds = 0;
  let externalThreat: ParryTarget | null = null;
  const publishParry = () => { state.parry = parry.snapshot(); };
  const hitTarget = (kind: ParryTarget['kind'], id: string, distance = state.distance, offset = state.offset): ParryTarget => ({
    id, kind, secondsToImpact: 0, worldPosition: parryWorldPosition(track, distance, offset, state.altitude, state.routeId),
  });
  const defend = (hit: ParryTarget) => { const success = parry.impact(hit); publishParry(); return success; };
  const cancelParry = () => { parry.cancel(); externalThreat = null; publishParry(); };
  let noticeRemaining = 0;
  let heightSwitchSpeed = 0;
  let offTrackEpisode = false;
  let accelerationRecovery = 0;
  let recoveryDuration = 1;
  let forkHandoffRemaining = 0;
  let approachChoiceId: string | null = null;
  let approachSteered = false;
  const impairAcceleration = (duration: number) => {
    // A craft contact cannot shorten an outstanding obstacle recovery.
    if (duration >= accelerationRecovery) { accelerationRecovery = duration; recoveryDuration = duration; }
  };
  const completedPassages = new Map<string, number>();
  // One penalty per field passage, even when the craft remains inside its volume.
  const fieldPassages = new Map<string, number>();
  // Smallest clearance per corridor/rail pass, and the altitude-call timing per height field and lap.
  const margins = new Map<string, number>(), lateCalls = new Map<string, boolean>(), safeSince = new Map<string, number>();
  const tuning = { ...DRIVING_TUNING, ...performance };
  const boostStage2Seconds = tuning.boostStage2Threshold / tuning.boostDrain;
  let settledAt = -Infinity;
  const publishDrift = () => { state.drift = driftController.snapshot(); };
  const finishDrift = () => {
    if (!state.drift.active) return;
    state.charge += driftController.finish(state.charge, BOOST_CAPACITY);
    settledAt = state.elapsed; publishDrift();
  };
  const cancelDrift = () => {
    if (state.drift.active) driftController.finish(state.charge, BOOST_CAPACITY, true);
    else if (Math.abs(settledAt - state.elapsed) < 1e-8) state.charge = Math.max(0, state.charge - driftController.revoke());
    publishDrift();
  };

  const interruptBoost = () => {
    state.boosting = false; state.boostStage = 0; state.boostElapsed = 0; state.boostStageProgress = 0;
  };
  const damageBoost = (loss: number) => {
    if (state.awakeningRemaining > 0) return;
    parry.damage(); publishParry();
    const appliedLoss = state.boosting ? loss : loss * .25;
    state.charge = Math.max(0, state.charge - appliedLoss);
    rechargeDelay = Math.max(rechargeDelay, .45);
    if (state.charge === 0) { state.boostNeedsRelease = true; interruptBoost(); }
  };
  const recover = () => {
    cancelDrift(); cancelParry(); state.cleanStreak = 0;
    state.awakeningRemaining = 0;
    state.distance = state.checkpoint;
    state.offset = 0; state.heading = 0; state.altitude = initialAltitude; state.targetAltitude = initialAltitude;
    state.altitudeLevel = initialLevel; heightSwitchSpeed = 0;
    state.speed = Math.min(state.speed, 12); interruptBoost();
    state.recoveries++; state.notice = 'recovery'; noticeRemaining = 1.8;
    rechargeDelay = Math.max(rechargeDelay, 0.6);
  };
  const fieldImpact = (retention: number, notice: 'height-collision' | 'corridor-collision' | 'jump-missed', target?: ParryTarget) => {
    if (state.awakeningRemaining > 0 || target && defend(target)) return;
    cancelDrift();
    const severity = (1 - retention) / DEFAULT_DRONE_CONFIGURATION.performance.collisionSpeedLoss;
    state.speed *= impactSpeedRetention(tuning.collisionSpeedLoss, severity);
    impairAcceleration(1.6); damageBoost(.18); state.collisions++;
    state.penaltyPoints += OBSTACLE_COLLISION_PENALTY_POINTS; state.cleanStreak = 0;
    state.notice = notice; noticeRemaining = 1.2;
  };
  const passedField = (near = false, counted = true) => {
    state.cleanStreak++; state.bestStreak = Math.max(state.bestStreak, state.cleanStreak);
    if (near) { state.nearMisses++; state.charge = Math.min(BOOST_CAPACITY, state.charge + NEAR_MISS_CHARGE); }
    if (!counted) return;
    state.obstaclesPassed++;
    if (!state.notice || state.notice === 'obstacle-pass') { state.notice = 'obstacle-pass'; noticeRemaining = .8; }
  };
  let cores = createAwakeningCores(track);
  const collectedCores = new Map<number, number>();
  let handoffRemaining = 0;
  const endAwakening = () => {
    if (state.awakeningRemaining <= 0) return;
    const target = awakeningTarget(track, state.distance, state.routeId, state.altitude, levels,
      track.obstacleTime ?? state.elapsed, state.speed, 0);
    // Return a tangent-aligned craft in a safe corridor, with a smooth speed handoff.
    state.offset = target.offset; state.heading = 0;
    state.altitude = target.altitude; state.altitudeLevel = target.level; state.targetAltitude = levels[target.level];
    heightSwitchSpeed = Math.abs(state.targetAltitude - state.altitude) / transitionSeconds;
    state.awakeningRemaining = 0; handoffRemaining = .65;
  };
  return {
    state,
    altitudeProfile,
    boostStage2Seconds,
    interruptBoost,
    endAwakening,
    cancelDrift,
    get cores() { return cores; },
    coreAvailable(index: number, lap: number) { return collectedCores.get(index) !== lap; },
    useParry() { if (state.awakeningRemaining > 0) return false; const used = parry.request(); publishParry(); return used; },
    cancelParry,
    setParryThreat(target: ParryTarget | null) { externalThreat = target; },
    releaseParryContact(id: string) { parry.releaseEpisode(id); },
    useAwakening() {
      if (state.awakeningCores <= 0 || state.awakeningRemaining > 0) return false;
      finishDrift(); cancelParry();
      state.awakeningCores--; state.awakeningsUsed++; state.awakeningRemaining = AWAKENING_SECONDS;
      interruptBoost(); boostSpent = 0; state.boostNeedsRelease = true;
      accelerationRecovery = 0; impactCooldown = 0; offTrackEpisode = false; handoffRemaining = 0;
      state.notice = null; noticeRemaining = 0;
      return true;
    },
    contact(episode = 'craft-contact', target?: ParryTarget, away = 0) {
      if (state.awakeningRemaining > 0) return;
      // Cushion the hit, never remove separation or let the push cross the road boundary.
      state.offset = clamp(state.offset + Math.sign(away) * PARRY_TUNING.contactPush,
        -(track.halfWidth - tuning.craftHalfWidth), track.halfWidth - tuning.craftHalfWidth);
      if (defend(target ?? hitTarget('craft', episode))) return;
      cancelDrift(); state.cleanStreak = 0;
      damageBoost(.08);
      state.speed *= impactSpeedRetention(tuning.collisionSpeedLoss, .7);
      impairAcceleration(.55);
      state.collisions++;
      state.penaltyPoints += COLLISION_PENALTY_POINTS;
      state.notice = 'craft-collision'; noticeRemaining = 0.8;
    },
    reset() {
      driftController.reset(); parry.reset(); settledAt = -Infinity;
      wallEpisode = 0; wallContact = false; wallClearSeconds = 0; externalThreat = null;
      Object.assign(state, initial); publishDrift(); publishParry(); jumps.reset();
      fieldPassages.clear(); completedPassages.clear(); margins.clear(); lateCalls.clear(); safeSince.clear(); accelerationRecovery = 0;
      rechargeDelay = 0; boostSpent = 0; impactCooldown = 0; noticeRemaining = 0; heightSwitchSpeed = 0;
      offTrackEpisode = false; forkHandoffRemaining = 0; approachChoiceId = null; approachSteered = false;
      cores = createAwakeningCores(track); collectedCores.clear(); handoffRemaining = 0;
    },
    recover,
    /** Instant launch (perfect start): never slows a craft that is already faster. */
    launch(speed: number) { state.speed = Math.max(state.speed, speed); },
    step(delta: number, input: DrivingInput, onTravel?: (segment: TravelSegment) => boolean, clockScale = 1) {
      if (state.awakeningRemaining <= 0 && (input.lift !== 0 || Number.isFinite(input.targetAltitudeLevel))) {
        const nextLevel = clamp(Number.isFinite(input.targetAltitudeLevel) ? Math.round(input.targetAltitudeLevel!)
          : state.altitudeLevel + Math.sign(input.lift), 0, levels.length - 1);
        if (nextLevel !== state.altitudeLevel) {
          const spacing = Math.abs(levels[nextLevel] - state.altitude);
          state.altitudeLevel = nextLevel;
          state.targetAltitude = levels[nextLevel];
          // Direct selection and rapid taps complete the move briskly without teleporting the craft.
          heightSwitchSpeed = spacing / transitionSeconds;
          // A small load surcharge per successful altitude selection, only during boost.
          if (input.boost && !input.brake && !state.boostNeedsRelease && state.charge > 0) {
            const load = Math.min(state.charge, tuning.boostDrain * .04, BOOST_ACTIVATION_LIMIT - boostSpent);
            state.charge -= load; boostSpent += load;
            if (state.charge === 0) { state.boostNeedsRelease = true; interruptBoost(); }
          }
        }
      }
      // A suspended or blocked frame never advances the simulation by a large jump.
      let remaining = clamp(Number.isFinite(delta) ? delta : 0, 0, 0.1);
      while (remaining > 1e-8) {
        const awake = state.awakeningRemaining > 0;
        const dt = Math.min(remaining, 1 / 120, awake ? state.awakeningRemaining : Infinity); remaining -= dt;
        const timeFrom = state.elapsed;
        const offsetFrom = state.offset;
        const altitudeFrom = state.altitude;
        state.elapsed += dt;
        parry.advance(dt * clockScale);
        impactCooldown = Math.max(0, impactCooldown - dt);
        accelerationRecovery = Math.max(0, accelerationRecovery - dt);
        noticeRemaining = Math.max(0, noticeRemaining - dt);
        if (noticeRemaining === 0) state.notice = null;
        if (!awake && !input.boost) {
          boostSpent = 0;
          if (state.charge >= 0.15) state.boostNeedsRelease = false;
        }
        const oldSpeed = state.speed;
        const fork = forkAt(track, state.distance);
        if (!fork) state.routeId = null;
        else if (branchChoiceOpen(track, state.distance) || !fork.routes.some(r => r.id === state.routeId))
          state.routeId = selectBranch(track, state.distance, state.offset, state.altitudeLevel);
        const sampled = track.sample(state.distance, frame, state.routeId);
        const curvature = sampled.curvature;
        const choiceFork = fork ?? upcomingFork(track, state.distance, Math.max(180, state.speed * 2.5));
        if (choiceFork?.id !== approachChoiceId) { approachChoiceId = choiceFork?.id ?? null; approachSteered = false; }
        if (Math.abs(input.steer) >= .15) approachSteered = true;
        forkHandoffRemaining = Math.max(0, forkHandoffRemaining - dt);
        const choiceAssist = !awake && !Number.isFinite(input.guidedOffset) && !!choiceFork
          && (!fork || branchChoiceOpen(track, state.distance));
        // Every fork accepts sustained steering as a lane choice. Keep the
        // transition into its Y separate from ordinary road cornering.
        const route = fork?.routes.find(r => r.id === state.routeId);
        const inMouth = !!fork && !!route && !branchChoiceOpen(track, state.distance) && state.distance % track.length < route.mouthEnd;
        const mouthAssist = !awake && !Number.isFinite(input.guidedOffset) && (!!fork && (inMouth || forkHandoffRemaining > 0));
        const fade = choiceAssist || mouthAssist ? 0 : forkApproachDrift(track, state.distance);
        const curveYaw = curvature * fade;

        const ordinaryScale = (Number.isFinite(input.targetSpeedScale) ? clamp(input.targetSpeedScale!, .1, 1) : 1)
          * (Number.isFinite(input.guidedSpeedScale) ? clamp(input.guidedSpeedScale!, .1, 1) : 1);
        const localDistance = ((state.distance % track.length) + track.length) % track.length;
        const airborne = track.jumps?.some(jump => (!jump.routeId || jump.routeId === state.routeId)
          && localDistance >= jump.start && localDistance < jump.end) ?? false;
        const blocked = !options.drift || awake || state.boosting || input.boost && !input.brake
          || Number.isFinite(input.guidedOffset) || Number.isFinite(input.guidedSpeedScale)
          || airborne || choiceAssist || mouthAssist || accelerationRecovery > 0;
        if (driftController.prepare(dt, { brake: input.brake, steer: input.steer, speed: state.speed,
          ordinarySpeed: tuning.topSpeed * ordinaryScale, curvature, blocked })) finishDrift();
        const driftMix = driftController.blend(dt); publishDrift();
        const wasBoosting = state.boosting;
        state.boosting = !awake && input.boost && !input.brake && !state.boostNeedsRelease && state.charge > 0;
        if (state.boosting && !wasBoosting) state.boostUses++;
        if (state.boosting) {
          state.boostElapsed += dt;
          state.boostStageProgress = Math.min(1, state.boostElapsed / boostStage2Seconds);
          state.boostStage = state.boostElapsed + 1e-8 >= boostStage2Seconds ? 2 : 1;
          const spent = Math.min(state.charge, BOOST_ACTIVATION_LIMIT - boostSpent,
            tuning.boostDrain * (1 + Math.abs(clamp(input.steer, -1, 1)) * .06) * dt);
          state.charge -= spent; boostSpent += spent;
          rechargeDelay = 0.8;
          if (state.charge <= 1e-8) { state.charge = 0; state.boostNeedsRelease = true; interruptBoost(); }
          else if (boostSpent >= BOOST_ACTIVATION_LIMIT - 1e-8) { state.boostNeedsRelease = true; interruptBoost(); }
        } else {
          interruptBoost();
          rechargeDelay = Math.max(0, rechargeDelay - dt);
          // Natural recovery and pickups share the same 150% storage capacity.
          if (!awake && rechargeDelay === 0 && state.charge < BOOST_CAPACITY) state.charge = Math.min(BOOST_CAPACITY, state.charge + tuning.boostRecovery * dt);
        }
        const bend = sampled.tangent ? sampled.tangent.distanceTo(track.sample(state.distance + 2, aheadFrame, state.routeId).tangent) / (2 * (sampled.distanceScale ?? 1)) : Math.abs(curvature);
        const grade = clamp((sampled.tangent?.y ?? 0) * Math.cos(state.heading) + (sampled.right?.y ?? 0) * Math.sin(state.heading), -1, 1);
        const steer = awake ? 0 : clamp(input.steer, -1, 1);
        const altitudeSpeed = Math.min(heightSwitchSpeed, Math.abs(state.targetAltitude - state.altitude) / dt);
        const guidedScale = Number.isFinite(input.guidedSpeedScale) ? clamp(input.guidedSpeedScale!, .1, 1) : 1;
        const speedScale = (!awake && Number.isFinite(input.targetSpeedScale) ? clamp(input.targetSpeedScale!, .1, 1) : 1) * guidedScale;
        const limit = (state.boostStage === 2 ? tuning.boostStage2Speed : state.boosting ? tuning.boostSpeed : tuning.topSpeed) * speedScale;
        const baseThrust = state.boostStage === 2 ? tuning.boostStage2Acceleration : state.boosting ? tuning.boostAcceleration : input.throttle ? tuning.acceleration : 0;
        const thrust = baseThrust * impactAccelerationScale(accelerationRecovery, recoveryDuration);
        const normalAcceleration = input.brake ? (state.speed < tuning.crawlSpeed ? tuning.acceleration : -tuning.braking)
          : flightAcceleration(state.speed, limit, thrust, tuning, { grade, curvature: bend, steer, altitudeSpeed });
        const driftTarget = tuning.topSpeed * speedScale * DRIFT_TUNING.targetSpeedScale;
        const driftThrust = state.speed < driftTarget - 2 ? tuning.acceleration * DRIFT_TUNING.thrustScale
          * impactAccelerationScale(accelerationRecovery, recoveryDuration) : 0;
        const driftAcceleration = flightAcceleration(state.speed, tuning.topSpeed * speedScale, driftThrust, tuning,
          { grade, curvature: bend, steer, altitudeSpeed })
          - (state.speed > driftTarget + 2 ? tuning.braking * DRIFT_TUNING.brakingScale : 0);
        const acceleration = normalAcceleration + (driftAcceleration - normalAcceleration) * driftMix;
        const ceiling = limit * (1 + tuning.downhillOverspeed);
        state.speed = clamp(state.speed + acceleration * dt, 0, Math.max(ceiling, state.speed));
        if (input.brake && driftMix === 0) state.speed = oldSpeed >= tuning.crawlSpeed ? Math.max(tuning.crawlSpeed, state.speed) : Math.min(tuning.crawlSpeed, state.speed);
        if (state.speed > ceiling) state.speed = Math.max(ceiling, state.speed - 18 * dt);
        if (!awake && handoffRemaining > 0) {
          state.speed = Math.max(Math.min(state.speed, ceiling), state.speed - (tuning.boostStage2Speed * AWAKENING_SPEED_SCALE - tuning.topSpeed) / .65 * dt);
          handoffRemaining = Math.max(0, handoffRemaining - dt);
        }
        if (awake) {
          const awakeSpeed = tuning.boostStage2Speed * AWAKENING_SPEED_SCALE * guidedScale;
          state.speed = oldSpeed + clamp(awakeSpeed - oldSpeed, -tuning.boostStage2Acceleration * 3 * dt, tuning.boostStage2Acceleration * 3 * dt);
        }
        const speed = (oldSpeed + state.speed) * 0.5;
        const travel = awake ? speed : speed * Math.cos(state.heading) / Math.max(0.5, 1 - curvature * state.offset);
        const yawCapacity = steeringYawRate(speed, tuning) * slopeHandling(grade) * (1 - (1 - DRIFT_TUNING.yawScale) * driftMix);
        const turnRate = steer * yawCapacity;
        const oldHeading = state.heading;
        // The heading is also the side-slip angle used for lateral travel. Released
        // or opposing input engages the craft's stabilizer; holding a turn keeps
        // its full yaw response. Feathered sticks blend smoothly into braking.
        const stabilization = steer * oldHeading < 0 ? 1 : Math.max(0, 1 - Math.abs(steer) / .15);
        const damping = tuning.lateralBraking * stabilization * (1 - (1 - DRIFT_TUNING.dampingScale) * driftMix);
        const decay = Math.exp(-damping * dt);
        const angularTravel = damping > 1e-8 ? (1 - decay) / damping : dt;
        const dampedHeading = oldHeading * decay + (turnRate - curveYaw * travel) * angularTravel;
        // Stabilizing side-slip consumes the same yaw capacity as steering. It
        // cannot turn an over-speed craft around a corner beyond that capacity.
        const yaw = clamp((dampedHeading - oldHeading) / dt + curveYaw * travel, -yawCapacity, yawCapacity);
        state.heading = clamp(oldHeading + (yaw - curveYaw * travel) * dt, -1.1, 1.1);
        if (driftMix > 0) {
          const slipLimit = 1.1 + (DRIFT_TUNING.headingLimit - 1.1) * driftMix;
          state.heading = clamp(state.heading, -slipLimit, slipLimit);
        }
        driftController.advance(dt, state.heading); publishDrift();
        state.offset += speed * Math.sin((oldHeading + state.heading) * 0.5) * dt;
        if (choiceAssist || mouthAssist) {
          // Holding a direction must reach beyond the 30% selection boundary,
          // then settle safely short of the rail. Preserve inward movement and
          // never snap an already-wide approach pose to a new position.
          const edge = Math.max(track.halfWidth * .55, Math.abs(offsetFrom));
          if (Math.abs(state.offset) > edge) {
            state.offset = clamp(state.offset, -edge, edge);
            if (state.heading * state.offset > 0) state.heading = 0;
          }
        }
        if (awake) {
          const target = awakeningTarget(track, state.distance, state.routeId, state.altitude, levels,
            track.obstacleTime ?? state.elapsed, state.speed);
          state.offset = offsetFrom + clamp((target.offset - offsetFrom) * (1 - Math.exp(-10 * dt)), -24 * dt, 24 * dt);
          state.heading = 0;
          state.altitudeLevel = target.level; state.targetAltitude = target.altitude;
          heightSwitchSpeed = 30;
        }
        if (Number.isFinite(input.guidedOffset)) {
          state.offset = offsetFrom + clamp((input.guidedOffset! - offsetFrom) * (1 - Math.exp(-10 * dt)), -24 * dt, 24 * dt);
          state.heading = 0;
        }
        const choiceDistance = choiceFork ? (choiceFork.start - state.distance % track.length + track.length) % track.length : 0;
        if (choiceAssist && !fork && choiceDistance > choiceFork!.junctionLength && !approachSteered && Math.abs(steer) < .15) {
          state.offset *= Math.exp(-6 * dt); state.heading *= Math.exp(-8 * dt);
        }
        // After locking, the chosen road moves under the craft. Settle toward
        // its centre while allowing opposite input to avoid an obstacle.
        if (mouthAssist) {
          const side = fork!.routes.indexOf(route!);
          const selectedDirection = fork!.kind === 'vertical' ? 0 : fork!.routes.length === 3 ? side - 1 : side ? 1 : -1;
          if (Math.abs(steer) < .15 || steer * selectedDirection > 0) {
            state.offset *= Math.exp(-4 * dt);
            state.heading *= Math.exp(-8 * dt);
          }
        }
        if (!choiceAssist && !mouthAssist && !fork?.authoredLayout && !Number.isFinite(input.guidedOffset) && Math.abs(steer) < .15) state.offset *= Math.exp(-6 * (1 - fade) * dt);
        const oldDistance = state.distance;
        state.distance = advanceTrackDistance(track, state.distance, travel * dt, state.routeId);
        if (Number.isFinite(input.guidedStopDistance)) state.distance = Math.max(oldDistance, Math.min(state.distance, input.guidedStopDistance!));
        // Commit the choice in the same tick that crosses the entrance, before
        // any renderer, obstacle or rival can observe an unselected route.
        const enteredFork = forkAt(track, state.distance);
        if (enteredFork && branchChoiceOpen(track, oldDistance) && !branchChoiceOpen(track, state.distance)) forkHandoffRemaining = 1.7;
        if (!enteredFork) state.routeId = null;
        else if (!fork || enteredFork.id !== fork.id || branchChoiceOpen(track, state.distance))
          state.routeId = selectBranch(track, state.distance, state.offset, state.altitudeLevel);
        state.altitude += clamp(state.targetAltitude - state.altitude, -heightSwitchSpeed * dt, heightSwitchSpeed * dt);
        // Launch settles cleanly, but a failed passage later in this tick still cancels it.
        if (state.drift.active && track.jumps?.some(jump => (!jump.routeId || jump.routeId === state.routeId)
          && Math.floor((state.distance - jump.start) / track.length) > Math.floor((oldDistance - jump.start) / track.length))) finishDrift();
        for (const event of jumps.update({ distance: oldDistance, altitude: altitudeFrom, offset: offsetFrom, routeId: state.routeId }, state, awake)) {
          if (event === 'missed') { state.jumpsMissed++; fieldImpact(.8, 'jump-missed'); }
          else { state.jumpsPassed++; passedField(); }
        }
        // Swept travel catches boost-speed crossings. Fields let the craft continue.
        for (let i = 0; i < track.heightObstacles.length; i++) {
          if (track.heightObstacles[i].routeId && track.heightObstacles[i].routeId !== state.routeId) continue;
          const obstacle = resolveHeightObstacle(track.heightObstacles[i], levels, track.obstacleTime ?? state.elapsed);
          const key = `height-${i}`;
          const lap = Math.floor(oldDistance / track.length);
          const center = obstacle.distance + lap * track.length;
          const clearance = (obstacle.depth / 2 + tuning.craftHalfLength) / routeDistanceScale(track, obstacle.distance, obstacle.routeId);
          const front = center - clearance;
          const rear = center + clearance;
          if (altitudeCanPass(levels[state.altitudeLevel], obstacle)) { if (!safeSince.has(key)) safeSince.set(key, state.elapsed); } else safeSince.delete(key);
          const lateKey = `${key}:${lap}`;
          if (oldDistance <= rear && state.distance >= front && !lateCalls.has(lateKey))
            lateCalls.set(lateKey, track.heightObstacles[i].motion ? obstacleInTransition(track.heightObstacles[i], levels, track.obstacleTime ?? state.elapsed)
              : state.elapsed - (safeSince.get(key) ?? -Infinity) < NEAR_MISS_LATE_SECONDS);
          if (oldDistance <= rear && state.distance >= front && fieldPassages.get(key) !== lap
            && Math.abs(state.offset) < track.halfWidth + tuning.craftHalfWidth
            && (state.altitude < obstacle.minAltitude || state.altitude > obstacle.maxAltitude)) {
            fieldPassages.set(key, lap);
            fieldImpact(obstacle.speedRetention, 'height-collision', hitTarget('height', `${key}:${lap}`, center));
          }
          if (oldDistance <= rear && state.distance > rear && completedPassages.get(key) !== lap) {
            completedPassages.set(key, lap);
            if (fieldPassages.get(key) !== lap && Math.abs(state.offset) <= track.halfWidth - tuning.craftHalfWidth
              && state.altitude >= obstacle.minAltitude && state.altitude <= obstacle.maxAltitude) {
              passedField(lateCalls.get(lateKey));
            }
            lateCalls.delete(lateKey);
          }
        }
        for (let i = 0; i < (track.corridorObstacles?.length ?? 0); i++) {
          const obstacle = track.corridorObstacles![i], key = `corridor-${i}`;
          if (obstacle.routeId && obstacle.routeId !== state.routeId) continue;
          const lap = Math.floor(oldDistance / track.length), center = obstacle.distance + lap * track.length;
          const clearance = (obstacle.depth / 2 + tuning.craftHalfLength) / routeDistanceScale(track, obstacle.distance, obstacle.routeId);
          const front = center - clearance;
          const rear = center + clearance;
          if (oldDistance > rear || state.distance < front) continue;
          const swept = state.distance - oldDistance;
          const at = (distance: number) => swept > 0 ? offsetFrom + (state.offset - offsetFrom)
            * clamp((distance - oldDistance) / swept, 0, 1) : state.offset;
          const safe = corridorCanPass(at(Math.max(oldDistance, front)), obstacle, tuning.craftHalfWidth)
            && corridorCanPass(at(Math.min(state.distance, rear)), obstacle, tuning.craftHalfWidth);
          const edge = (distance: number) => obstacle.safeWidth / 2 - Math.abs(at(distance) - obstacle.safeCenter) - tuning.craftHalfWidth;
          const marginKey = `${key}:${lap}`;
          margins.set(marginKey, Math.min(margins.get(marginKey) ?? Infinity, edge(Math.max(oldDistance, front)), edge(Math.min(state.distance, rear))));
          if (!safe && fieldPassages.get(key) !== lap && Math.abs(state.offset) < track.halfWidth + tuning.craftHalfWidth) {
            fieldPassages.set(key, lap);
            state.offset = clamp(state.offset + Math.sign(obstacle.safeCenter - state.offset) * PARRY_TUNING.contactPush,
              -(track.halfWidth - tuning.craftHalfWidth), track.halfWidth - tuning.craftHalfWidth);
            fieldImpact(obstacle.speedRetention, 'corridor-collision', hitTarget('corridor', `${key}:${lap}`, center));
          }
          if (state.distance > rear && completedPassages.get(key) !== lap) {
            completedPassages.set(key, lap);
            if (safe && fieldPassages.get(key) !== lap) passedField(margins.get(marginKey)! < NEAR_MISS_MARGIN);
            margins.delete(marginKey);
          }
        }
        // Mines are vertical columns: any altitude hits. Swept travel catches boost-speed crossings.
        for (let f = 0; f < (track.mineFields?.length ?? 0); f++) {
          const field = track.mineFields![f];
          if (field.routeId && field.routeId !== state.routeId) continue;
          const lap = Math.floor(oldDistance / track.length), scale = routeDistanceScale(track, field.distance, field.routeId);
          const swept = state.distance - oldDistance, fieldKey = `mine-${f}`;
          for (let m = 0; m < field.mines.length; m++) {
            const mine = field.mines[m], centre = field.distance + mine.at + lap * track.length, reach = (mine.radius + tuning.craftHalfLength) / scale;
            const from = Math.max(oldDistance, centre - reach), to = Math.min(state.distance, centre + reach), key = `${fieldKey}-${m}`;
            if (from > to || fieldPassages.get(key) === lap) continue;
            const side = (distance: number) => (swept > 0 ? offsetFrom + (state.offset - offsetFrom) * clamp((distance - oldDistance) / swept, 0, 1) : state.offset) - mine.offset;
            const [a, b] = [side(from), side(to)];
            if ((a * b <= 0 ? 0 : Math.min(Math.abs(a), Math.abs(b))) < mine.radius + tuning.craftHalfWidth) {
              fieldPassages.set(key, lap); fieldPassages.set(fieldKey, lap);
              fieldImpact(MINE_SPEED_RETENTION, 'corridor-collision', hitTarget('mine', `${key}:${lap}`, centre, mine.offset));
            }
          }
          const end = field.distance + field.length + lap * track.length + tuning.craftHalfLength / scale;
          if (oldDistance <= end && state.distance > end && completedPassages.get(fieldKey) !== lap) {
            completedPassages.set(fieldKey, lap);
            if (fieldPassages.get(fieldKey) !== lap) passedField();
          }
        }
        // Arc rails electrify one half of the road at every altitude: touching it anywhere along a segment costs one corridor-style hit per lap.
        for (let r = 0; r < (track.arcRails?.length ?? 0); r++) {
          const rail = track.arcRails![r];
          if (rail.routeId && rail.routeId !== state.routeId) continue;
          const lap = Math.floor(oldDistance / track.length), swept = state.distance - oldDistance;
          for (let g = 0; g < rail.segments.length; g++) {
            const { at: from, length, side } = rail.segments[g], key = `rail-${r}-${g}`, start = rail.distance + from + lap * track.length;
            if (oldDistance > start + length || state.distance < start || fieldPassages.get(key) === lap) continue;
            const offsetAt = (distance: number) => swept > 0 ? offsetFrom + (state.offset - offsetFrom) * clamp((distance - oldDistance) / swept, 0, 1) : state.offset;
            if (arcRailHit(offsetAt(Math.max(oldDistance, start)), side) || arcRailHit(offsetAt(Math.min(state.distance, start + length)), side)) {
              fieldPassages.set(key, lap); fieldImpact(MINE_SPEED_RETENTION, 'corridor-collision');
            }
            const marginKey = `${key}:${lap}`, gap = (distance: number) => -side * offsetAt(distance) - CRAFT_HALF_WIDTH;
            margins.set(marginKey, Math.min(margins.get(marginKey) ?? Infinity, gap(Math.max(oldDistance, start)), gap(Math.min(state.distance, start + length))));
            if (state.distance > start + length) {
              if (fieldPassages.get(key) !== lap) { completedPassages.set(key, lap); passedField(margins.get(marginKey)! < NEAR_MISS_MARGIN, false); }
              margins.delete(marginKey);
            }
          }
        }
        // Pads trigger on the swept crossing of their distance, at any altitude, once per lap.
        for (let i = 0; i < (track.boostPads?.length ?? 0); i++) {
          const pad = track.boostPads![i], key = `pad-${i}`;
          if (pad.routeId && pad.routeId !== state.routeId) continue;
          const lap = Math.floor(oldDistance / track.length), at = pad.distance + lap * track.length;
          if (oldDistance >= at || state.distance < at || fieldPassages.get(key) === lap) continue;
          const crossing = offsetFrom + (state.offset - offsetFrom) * clamp((at - oldDistance) / (state.distance - oldDistance), 0, 1);
          if (Math.abs(crossing - pad.center) > pad.width / 2) continue;
          fieldPassages.set(key, lap);
          state.charge = Math.min(BOOST_CAPACITY, state.charge + .5);
          state.speed = Math.max(state.speed, Math.min(tuning.boostSpeed * speedScale, state.speed + 18));
          state.boostPads++;
        }
        // Boost rings work like pads: the craft centre must cross within the ring's reach, at any altitude.
        for (let i = 0; i < (track.boostRings?.length ?? 0); i++) {
          const ring = track.boostRings![i], key = `ring-${i}`;
          if (ring.routeId && ring.routeId !== state.routeId) continue;
          const lap = Math.floor(oldDistance / track.length), at = ring.distance + lap * track.length;
          if (oldDistance >= at || state.distance < at || fieldPassages.get(key) === lap) continue;
          const crossing = offsetFrom + (state.offset - offsetFrom) * clamp((at - oldDistance) / (state.distance - oldDistance), 0, 1);
          if (Math.abs(crossing - ring.offset) > RING_REACH) continue;
          fieldPassages.set(key, lap);
          state.charge = Math.min(BOOST_CAPACITY, state.charge + 1);
          state.speed = Math.max(state.speed, Math.min(tuning.boostSpeed * speedScale, state.speed + 18));
          state.boostRings++;
        }
        // The third pickup banks one manual activation, independently of boost.
        for (let i = 0; i < cores.length; i++) {
          if (state.awakeningCores >= AWAKENING_CAPACITY) break;
          for (let lap = Math.floor(oldDistance / track.length); lap <= Math.floor(state.distance / track.length); lap++) {
            if (state.awakeningCores >= AWAKENING_CAPACITY) break;
            const core = cores[i], at = core.distance + lap * track.length;
            if (lap < 0 || oldDistance >= at || state.distance < at || collectedCores.get(i) === lap) continue;
            const crossing = offsetFrom + (state.offset - offsetFrom) * clamp((at - oldDistance) / (state.distance - oldDistance), 0, 1);
            if (Math.abs(crossing - core.offset) > CORE_REACH) continue;
            collectedCores.set(i, lap); state.awakeningCores++; state.coresCollected++;
          }
        }
        if (awake) state.speed = Math.min(state.speed, tuning.boostStage2Speed * AWAKENING_SPEED_SCALE);
        const boundary = track.halfWidth - tuning.craftHalfWidth;
        if (Math.abs(state.offset) < boundary - 0.5) offTrackEpisode = false;
        // High flight can clear the posts. Keep forward progress when it strays
        // beyond the road; one excursion earns one penalty until safely back in.
        if (!awake && Math.abs(state.offset) > track.halfWidth + 1) {
          cancelDrift(); state.cleanStreak = 0;
          const side = Math.sign(state.offset);
          state.offset = side * track.halfWidth;
          if (state.heading * side > 0) state.heading = -side * 0.12;
          if (!offTrackEpisode) {
            offTrackEpisode = true;
            state.offTrackExits++; state.penaltyPoints += OFF_TRACK_PENALTY_POINTS;
            state.speed *= impactSpeedRetention(tuning.collisionSpeedLoss);
            impairAcceleration(1);
            damageBoost(.15);
            state.notice = 'off-track'; noticeRemaining = 1.8;
          }
        }
        if (wallContact) {
          wallClearSeconds = Math.abs(state.offset) < boundary - PARRY_TUNING.contactClearance ? wallClearSeconds + dt * clockScale : 0;
          if (wallClearSeconds + 1e-8 >= PARRY_TUNING.contactReleaseSeconds) {
            parry.releaseEpisode(`wall:${wallEpisode}`); wallContact = false; wallClearSeconds = 0;
          }
        }
        if (!awake && Math.abs(state.offset) > boundary && state.altitude <= 3.2 && !offTrackEpisode) {
          if (!wallContact) { wallContact = true; wallEpisode++; }
          wallClearSeconds = 0;
          const side = Math.sign(state.offset);
          state.offset = side * boundary;
          if (state.heading * side > 0) state.heading = -side * 0.12;
          const defended = defend(hitTarget('wall', `wall:${wallEpisode}`));
          if (!defended) { cancelDrift(); state.cleanStreak = 0; }
          if (impactCooldown === 0) {
            impactCooldown = .5;
            if (!defended) {
              state.speed *= impactSpeedRetention(tuning.collisionSpeedLoss);
              impairAcceleration(1); damageBoost(.10); state.collisions++;
              state.penaltyPoints += COLLISION_PENALTY_POINTS;
              state.notice = 'collision'; noticeRemaining = 0.8;
            }
          }
        }
        if (state.parry.enabled && !awake) {
          const lateral = (state.offset - offsetFrom) / dt;
          let target = predictParryThreat(track, state, levels, lateral, heightSwitchSpeed, clockScale, id => {
            const split = id.lastIndexOf(':'); return fieldPassages.get(id.slice(0, split)) === Number(id.slice(split + 1));
          });
          const wallIn = lateral === 0 ? Infinity : (Math.sign(lateral) * boundary - state.offset) / lateral * clockScale;
          if (!wallContact && state.altitude <= 3.2 && wallIn >= 0 && wallIn <= PARRY_TUNING.warningSeconds
            && (!target || wallIn < target.secondsToImpact)) {
            target = { ...hitTarget('wall', `wall:${wallEpisode + 1}`, state.distance + state.speed * wallIn / clockScale, Math.sign(lateral) * boundary), secondsToImpact: wallIn };
          }
          if (externalThreat && (!target || externalThreat.secondsToImpact < target.secondsToImpact)) target = externalThreat;
          parry.setTarget(target);
        } else parry.setTarget(null);
        publishParry();
        if (!Number.isFinite(state.distance + state.offset)) {
          recover(); continue;
        }
        if (awake) {
          if (state.awakeningRemaining - dt <= 1e-8) endAwakening();
          else state.awakeningRemaining -= dt;
        }
        if (onTravel?.({ from: oldDistance, to: state.distance, offsetFrom, offsetTo: state.offset, timeFrom, timeTo: state.elapsed })) break;
        const checkpoint = Math.floor(state.distance / track.checkpointSpacing) * track.checkpointSpacing;
        if (!onTravel && checkpoint > state.checkpoint && oldDistance <= checkpoint) state.checkpoint = checkpoint;
      }
    },
  };
}
