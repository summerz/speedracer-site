import type { DrivingState } from './createDrivingModel.js';
import type { DailyCounters } from '../progression/dailyChallenge.js';
/** Observe every physics step, so a short-lived drift reward is never lost between frames. */
export function createDailyRun() {
  let drift = 0; const rewards = new Set<number>();
  return {
    reset() { drift = 0; rewards.clear(); },
    observe(state: DrivingState) {
      const reward = state.drift.lastReward;
      if (reward && !rewards.has(reward.id)) {
        rewards.add(reward.id);
        if (!reward.cancelled && reward.stage >= 1 && reward.earnedCharge > 0) drift++;
      }
    },
    snapshot(state: DrivingState): DailyCounters { return { boost: state.boostUses, safePass: state.obstaclesPassed, drift }; },
  };
}
