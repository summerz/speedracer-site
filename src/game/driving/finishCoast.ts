import type { DrivingState } from './createDrivingModel.js';

export interface FinishCoast {
  pose: DrivingState;
  step(delta: number): void;
}

/** Presentation-only motion: recorded finish distance, clocks and ranks stay fixed. */
export function createFinishCoast(state: DrivingState, speed: number, slot: number, trackLength: number): FinishCoast {
  const pose = { ...state, speed, routeId: null, boosting: false, boostStage: 0 as const,
    boostElapsed: 0, boostStageProgress: 0, awakeningRemaining: 0 };
  const start = state.distance;
  const travel = Math.min(trackLength * .25, Math.max(35, speed * 1.1)) + slot * Math.min(8, trackLength * .15 / 6);
  const duration = speed > 0 ? 2 * travel / speed : 0;
  let age = 0;
  return { pose, step(delta) {
    age = Math.min(duration, age + Math.max(0, Number.isFinite(delta) ? delta : 0));
    const fraction = duration > 0 ? age / duration : 1;
    pose.distance = start + travel * (2 * fraction - fraction * fraction);
    pose.speed = speed * (1 - fraction);
    pose.heading = state.heading * (1 - fraction);
  } };
}
