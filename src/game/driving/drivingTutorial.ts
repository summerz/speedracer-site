import type { RacePhase } from './createTimeAttack.js';

export type TutorialStepId = 'throttle' | 'steer' | 'altitude' | 'boost' | 'brake' | 'hazard' | 'near-miss';
export type TutorialMode = 'first-run' | 'practice';
export type TutorialOutcome = 'completed' | 'skipped';
export interface TutorialSnapshot {
  step: TutorialStepId; stepId: TutorialStepId; index: number; total: number;
  phase: 'show' | 'done'; checks: { id: string; done: boolean }[];
  progress: number; nextIn?: number;
}
export interface TutorialStatus {
  mode: TutorialMode; outcome: TutorialOutcome | null;
  completedSteps: number; skippedSteps: number;
}
export interface TutorialFrame {
  phase: RacePhase; speed: number; steer: number; brake: boolean;
  altitudeLevel: number; boosting: boolean; obstaclesPassed: number;
  collisions: number; nearMisses: number; hazardNearby: boolean;
  /** Set by the input adapter to distinguish manual changes from autonomous flight. */
  altitudeChanged?: boolean;
}
export const TUTORIAL_STEPS: readonly { id: TutorialStepId; checks: readonly string[] }[] = [
  { id: 'throttle', checks: ['auto'] }, { id: 'steer', checks: ['left', 'right'] },
  { id: 'altitude', checks: ['up', 'down'] }, { id: 'boost', checks: ['on', 'alt-change'] },
  { id: 'brake', checks: ['on'] }, { id: 'hazard', checks: ['pass'] },
  { id: 'near-miss', checks: ['once'] },
];
export const TUTORIAL_DONE_SECONDS = 1.2;
export const TUTORIAL_SPEED_SCALE = .85;

/** Input/outcome driven; paused time, earlier actions and cinematics never satisfy a step. */
export function createDrivingTutorial(options: { mode: TutorialMode; onFinish?: (status: TutorialStatus) => void }) {
  let index = 0, phase: 'show' | 'done' = 'show', nextIn = 0;
  let checks = TUTORIAL_STEPS[0].checks.map(id => ({ id, done: false }));
  let elapsed = 0, left = 0, right = 0, braking = 0;
  let previous: TutorialFrame | null = null, baseline: TutorialFrame | null = null, hazardSeen = false;
  let completedSteps = 0, skippedSteps = 0, outcome: TutorialOutcome | null = null;
  let speedScale = TUTORIAL_SPEED_SCALE;
  const listeners = new Set<(snapshot: TutorialSnapshot | null) => void>();
  const status = (): TutorialStatus => ({ mode: options.mode, outcome, completedSteps, skippedSteps });
  const snapshot = (): TutorialSnapshot | null => outcome ? null : {
    step: TUTORIAL_STEPS[index].id, stepId: TUTORIAL_STEPS[index].id, index, total: TUTORIAL_STEPS.length,
    phase, checks: checks.map(check => ({ ...check })),
    progress: phase === 'done' ? 1 : TUTORIAL_STEPS[index].id === 'throttle'
      ? Math.min(1, elapsed / 2) : checks.filter(check => check.done).length / checks.length,
    ...(phase === 'done' ? { nextIn } : {}),
  };
  const emit = () => { const value = snapshot(); for (const listener of listeners) listener(value); };
  const finish = () => { outcome = skippedSteps ? 'skipped' : 'completed'; options.onFinish?.(status()); };
  const done = (skipped: boolean) => {
    if (outcome || phase === 'done') return;
    if (skipped) skippedSteps++; else completedSteps++;
    phase = 'done'; nextIn = TUTORIAL_DONE_SECONDS;
  };
  const mark = (id: string) => { const check = checks.find(check => check.id === id); if (check) check.done = true; };
  return {
    snapshot, status,
    /** First-course caller applies this to ordinary and boosted speed ceilings. */
    speedScale: () => speedScale,
    onChange(listener: (snapshot: TutorialSnapshot | null) => void) {
      listeners.add(listener); listener(snapshot()); return () => { listeners.delete(listener); };
    },
    skip() { if (!outcome && phase === 'show') { done(true); emit(); } },
    skipAll() {
      if (outcome) return;
      skippedSteps += TUTORIAL_STEPS.length - completedSteps - skippedSteps;
      finish(); emit();
    },
    update(deltaSeconds: number, frame: TutorialFrame) {
      if (frame.phase !== 'running') return;
      const dt = Number.isFinite(deltaSeconds) ? Math.max(0, Math.min(.1, deltaSeconds)) : 0;
      if (outcome) {
        speedScale = Math.min(1, speedScale + dt * (1 - TUTORIAL_SPEED_SCALE));
        if (speedScale > 1 - 1e-8) speedScale = 1;
        return;
      }
      const before = JSON.stringify(snapshot());
      if (phase === 'done') {
        nextIn = Math.max(0, nextIn - dt);
        if (nextIn <= 1e-8) {
          index++;
          if (index === TUTORIAL_STEPS.length) finish();
          else {
            phase = 'show'; checks = TUTORIAL_STEPS[index].checks.map(id => ({ id, done: false }));
            elapsed = left = right = braking = 0; baseline = { ...frame }; hazardSeen = false;
          }
        }
      } else {
        baseline ??= { ...frame };
        const altitudeDelta = previous && frame.altitudeChanged !== false ? frame.altitudeLevel - previous.altitudeLevel : 0;
        switch (TUTORIAL_STEPS[index].id) {
          case 'throttle': if (frame.speed > 1 && !frame.brake) elapsed += dt; if (elapsed >= 2 - 1e-8) mark('auto'); break;
          case 'steer':
            left = frame.steer < -.2 ? left + dt : 0; right = frame.steer > .2 ? right + dt : 0;
            if (left >= .12) mark('left'); if (right >= .12) mark('right'); break;
          case 'altitude': if (altitudeDelta > 0) mark('up'); if (altitudeDelta < 0) mark('down'); break;
          case 'boost':
            if (frame.boosting) { mark('on'); if (altitudeDelta) mark('alt-change'); } break;
          case 'brake': braking = frame.brake ? braking + dt : 0; if (braking >= .15) mark('on'); break;
          case 'hazard':
            if (frame.collisions > baseline.collisions) { baseline = { ...frame }; hazardSeen = false; }
            if (hazardSeen && frame.obstaclesPassed > baseline.obstaclesPassed) mark('pass');
            hazardSeen ||= frame.hazardNearby; break;
          case 'near-miss': if (frame.nearMisses > baseline.nearMisses) mark('once'); break;
        }
        if (checks.every(check => check.done)) done(false);
      }
      previous = { ...frame };
      if (JSON.stringify(snapshot()) !== before) emit();
    },
  };
}
