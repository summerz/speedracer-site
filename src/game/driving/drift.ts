/** Pure drift state machine; charge is banked only at a clean exit. */
export type DriftStage = 0 | 1 | 2 | 3;
export type DriftDirection = -1 | 0 | 1;
export interface DriftReward {
  id: number; stage: DriftStage; earnedCharge: number; addedCharge: number; cancelled: boolean;
}
export interface DriftSnapshot {
  active: boolean; direction: DriftDirection; angle: number; seconds: number;
  stage: DriftStage; stageProgress: number; pendingCharge: number; lastReward: DriftReward | null;
}
export const DRIFT_TUNING = Object.freeze({
  entrySeconds: .15, rearmSeconds: .25, blendSeconds: .15,
  entrySteer: .35, sustainSteer: .20, entryCurvature: .0015, sustainCurvature: .001,
  minimumSpeed: 20, entrySpeedScale: .45, sustainSpeedScale: .8,
  targetSpeedScale: .78, brakingScale: .18, thrustScale: .60,
  yawScale: .55, dampingScale: .60, headingLimit: .28, chargeAngle: .07,
});
export interface DriftConditions {
  brake: boolean; steer: number; speed: number; ordinarySpeed: number; curvature: number; blocked: boolean;
}
const thresholds = [0, .6, 1.2, 2] as const;
const rewards = [0, .05, .10, .15] as const;
export function driftStage(seconds: number): DriftStage {
  return seconds + 1e-8 >= 2 ? 3 : seconds + 1e-8 >= 1.2 ? 2 : seconds + 1e-8 >= .6 ? 1 : 0;
}
export function createDriftController() {
  let active = false, direction: DriftDirection = 0, seconds = 0, angle = 0;
  let entry = 0, cooldown = 0, released = true, releaseAtExit = false, mix = 0, id = 0;
  let lastReward: DriftReward | null = null;
  const snapshot = (): DriftSnapshot => {
    const stage = active ? driftStage(seconds) : 0;
    return { active, direction, angle: active ? angle : 0, seconds: active ? seconds : 0, stage,
      stageProgress: !active ? 0 : stage === 3 ? 1 : Math.max(0, Math.min(1,
        (seconds - thresholds[stage]) / (thresholds[stage + 1] - thresholds[stage]))),
      pendingCharge: active ? rewards[stage] : 0, lastReward };
  };
  const finish = (charge: number, capacity: number, cancelled = false) => {
    if (!active) return 0;
    const stage = driftStage(seconds), earnedCharge = rewards[stage];
    const addedCharge = cancelled ? 0 : Math.max(0, Math.min(earnedCharge, capacity - charge));
    lastReward = { id: ++id, stage, earnedCharge, addedCharge, cancelled };
    active = false; direction = 0; seconds = angle = entry = 0; cooldown = DRIFT_TUNING.rearmSeconds; released = releaseAtExit;
    if (cancelled) mix = 0;
    return addedCharge;
  };
  return {
    snapshot, finish,
    /** Returns true when an active drift needs normal settlement before boost starts. */
    prepare(dt: number, c: DriftConditions) {
      cooldown = Math.max(0, cooldown - dt);
      releaseAtExit = !c.brake || Math.abs(c.steer) < DRIFT_TUNING.sustainSteer;
      if (releaseAtExit) released = true;
      const minimum = Math.max(DRIFT_TUNING.minimumSpeed, c.ordinarySpeed * DRIFT_TUNING.entrySpeedScale);
      const inside = Math.sign(c.steer) === Math.sign(c.curvature);
      const sustain = !c.blocked && c.brake && inside && Math.abs(c.steer) >= DRIFT_TUNING.sustainSteer
        && Math.abs(c.curvature) >= DRIFT_TUNING.sustainCurvature && c.speed >= minimum * DRIFT_TUNING.sustainSpeedScale;
      if (active && (!sustain || Math.sign(c.steer) !== direction)) return true;
      if (!active) {
        const eligible = cooldown <= 1e-8 && released && !c.blocked && c.brake && inside
          && Math.abs(c.steer) >= DRIFT_TUNING.entrySteer && Math.abs(c.curvature) >= DRIFT_TUNING.entryCurvature && c.speed >= minimum;
        entry = eligible ? entry + dt : 0;
        if (entry + 1e-8 >= DRIFT_TUNING.entrySeconds) { active = true; direction = Math.sign(c.steer) as DriftDirection; entry = 0; }
      }
      return false;
    },
    blend(dt: number) {
      mix = Math.max(0, Math.min(1, mix + (active ? dt : -dt) / DRIFT_TUNING.blendSeconds));
      return mix;
    },
    advance(dt: number, heading: number) {
      if (!active) return;
      angle = heading;
      if (Math.abs(heading) + 1e-8 >= DRIFT_TUNING.chargeAngle) seconds += dt;
    },
    /** An impact later in the same physics tick can revoke a provisional clean exit. */
    revoke() {
      if (!lastReward || lastReward.cancelled) return 0;
      const added = lastReward.addedCharge;
      lastReward = { ...lastReward, addedCharge: 0, cancelled: true }; mix = 0;
      return added;
    },
    reset() { active = false; direction = 0; seconds = angle = entry = cooldown = mix = id = 0; released = true; releaseAtExit = false; lastReward = null; },
  };
}
