import type { TutorialOutcome } from './drivingTutorial.js';
import type { RecordStorage } from './raceRecords.js';

export const TUTORIAL_STORAGE_KEY = 'speedracer:tutorial:v1';

/** A completed or explicitly dismissed guide stays dismissed; abandoned runs can retry. */
export function createTutorialProgress(storage?: RecordStorage) {
  let outcome: TutorialOutcome | null = null;
  try {
    const value = JSON.parse(storage?.getItem(TUTORIAL_STORAGE_KEY) ?? 'null');
    if (value?.version === 1 && (value.outcome === 'completed' || value.outcome === 'skipped')) outcome = value.outcome;
  } catch { /* Private browsing and malformed saves are supported. */ }
  return {
    shouldStart: (firstCourse: boolean) => firstCourse && outcome === null,
    outcome: () => outcome,
    finish(next: TutorialOutcome) {
      outcome = next;
      try { storage?.setItem(TUTORIAL_STORAGE_KEY, JSON.stringify({ version: 1, outcome })); } catch { /* Keep the session state. */ }
    },
  };
}
