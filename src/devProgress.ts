import { initialProgress, validateProgress } from './game/progression/progress';
import type { ProgressRepository } from './game/progression/progressStore';

// Loaded only by Vite's development branch; this module is absent from production builds.
export async function grantLocalPlaytestPoints(repository: ProgressRepository) {
  const receipt = 'development:shop-playtest-2026-10-05';
  await repository.transact(value => {
    const next = value === undefined ? initialProgress() : validateProgress(value);
    if (Object.hasOwn(next.rewards, receipt)) return next;
    const amount = 1_000_000;
    next.balance += amount;
    next.rewards[receipt] = { base: amount, clean: 0, best: 0, penalty: 0, total: amount, assisted: false };
    next.revision++;
    return validateProgress(next);
  });
}
