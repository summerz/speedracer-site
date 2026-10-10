import type { RacePhase } from './createTimeAttack.js';

export type TutorialStepId = 'throttle' | 'steer' | 'altitude' | 'boost' | 'brake' | 'hazard' | 'near-miss';
export type TutorialMode = 'first-run' | 'practice';
export type TutorialOutcome = 'completed' | 'skipped';
export type TutorialPhase = 'intro' | 'await' | 'act' | 'demo' | 'freeze' | 'done';
export interface TutorialTarget {
  kind: 'hazard' | 'near-miss'; distance: number; offset: number; altitude: number;
  altitudeLevel: number; worldPosition: { x: number; y: number; z: number };
}
export interface TutorialSnapshot {
  step: TutorialStepId; stepId: TutorialStepId; index: number; total: number;
  phase: TutorialPhase; checks: { id: string; done: boolean }[];
  progress: number; nextIn?: number; frozen: boolean; inputLocked: boolean;
  expectedCheck?: string; target?: TutorialTarget;
}
export interface TutorialStatus {
  mode: TutorialMode; outcome: TutorialOutcome | null; completedSteps: number; skippedSteps: number;
  steps: { id: TutorialStepId; result: 'pending' | 'completed' | 'skipped' }[];
}
export interface TutorialFrame {
  phase: RacePhase; speed: number; steer: number; brake: boolean; distance: number;
  altitudeLevel: number; boosting: boolean; obstaclesPassed: number;
  collisions: number; nearMisses: number; altitudeChanged?: boolean;
  /** The simulation adapter supplies exact geometric approach/closest-point boundaries. */
  atTarget?: boolean;
}
export interface TutorialAction {
  steer: number; brake: boolean; boost: boolean; requestedAltitudeLevel?: number;
}
export const TUTORIAL_STEPS: readonly { id: TutorialStepId; checks: readonly string[] }[] = [
  { id: 'throttle', checks: ['auto'] }, { id: 'steer', checks: ['left', 'right'] },
  { id: 'altitude', checks: ['up', 'down'] }, { id: 'boost', checks: ['on', 'alt-change'] },
  { id: 'brake', checks: ['on'] }, { id: 'hazard', checks: ['pass'] },
  { id: 'near-miss', checks: ['once'] },
];
export const TUTORIAL_DONE_SECONDS = 1.2;
export const TUTORIAL_SPEED_SCALE = .28;
const ACTION_SECONDS = .45;
const cloneTarget = (target: TutorialTarget): TutorialTarget => ({ ...target, worldPosition: { ...target.worldPosition } });

/** Lesson clock is separate from the world clock: reading never spends race or boost time. */
export function createDrivingTutorial(options: { mode: TutorialMode; onFinish?: (status: TutorialStatus) => void }) {
  let index = 0, phase: TutorialPhase = 'intro', nextIn = 0, elapsed = 0;
  let checks = TUTORIAL_STEPS[0].checks.map(id => ({ id, done: false }));
  let previous: TutorialFrame | null = null, baseline: TutorialFrame | null = null;
  let activeCheck: string | undefined, held = 0, demoExplained = false;
  let completedSteps = 0, skippedSteps = 0, outcome: TutorialOutcome | null = null;
  let speedScale = TUTORIAL_SPEED_SCALE;
  const results: TutorialStatus['steps'] = TUTORIAL_STEPS.map(({ id }) => ({ id, result: 'pending' }));
  let targets: Partial<Record<'hazard' | 'near-miss', TutorialTarget>> = {};
  const listeners = new Set<(snapshot: TutorialSnapshot | null) => void>();
  const step = () => TUTORIAL_STEPS[index].id;
  const expected = () => checks.find(check => !check.done)?.id;
  const status = (): TutorialStatus => ({ mode: options.mode, outcome, completedSteps, skippedSteps, steps: results.map(result => ({ ...result })) });
  const snapshot = (): TutorialSnapshot | null => {
    if (outcome) return null;
    const id = step(), target = id === 'hazard' || id === 'near-miss' ? targets[id] : undefined;
    return {
      step: id, stepId: id, index, total: TUTORIAL_STEPS.length, phase,
      checks: checks.map(check => ({ ...check })),
      progress: phase === 'done' ? 1 : id === 'throttle' ? Math.min(1, elapsed / 2)
        : checks.filter(check => check.done).length / checks.length,
      frozen: ['intro', 'await', 'freeze', 'done'].includes(phase),
      inputLocked: ['intro', 'demo', 'freeze', 'done'].includes(phase) || id === 'hazard' && phase === 'act',
      ...(phase === 'await' ? { expectedCheck: expected() } : {}),
      ...(phase === 'done' ? { nextIn } : {}), ...(target ? { target: cloneTarget(target) } : {}),
    };
  };
  const emit = () => { const value = snapshot(); for (const listener of listeners) listener(value); };
  const finish = () => { outcome = skippedSteps ? 'skipped' : 'completed'; options.onFinish?.(status()); };
  const done = (skipped: boolean) => {
    if (outcome || phase === 'done') return;
    if (skipped) skippedSteps++; else completedSteps++;
    results[index].result = skipped ? 'skipped' : 'completed';
    phase = 'done'; nextIn = TUTORIAL_DONE_SECONDS;
  };
  const mark = (id: string) => { const check = checks.find(check => check.id === id); if (check) check.done = true; };
  return {
    snapshot, status, speedScale: () => speedScale,
    setTargets(value: Partial<Record<'hazard' | 'near-miss', TutorialTarget>>) {
      targets = Object.fromEntries(Object.entries(value).map(([id, target]) => [id, cloneTarget(target)])); emit();
    },
    onChange(listener: (snapshot: TutorialSnapshot | null) => void) {
      listeners.add(listener); listener(snapshot()); return () => { listeners.delete(listener); };
    },
    continue() {
      if (outcome || !previous || previous.phase !== 'running') return false;
      if (phase === 'intro') {
        baseline = { ...previous }; elapsed = held = 0;
        phase = step() === 'throttle' ? 'act' : step() === 'hazard' || step() === 'near-miss' ? 'demo' : 'await';
      } else if (phase === 'freeze') { demoExplained = true; phase = 'demo'; }
      else return false;
      emit(); return true;
    },
    /** Only the current requested action can unfreeze an await phase. */
    acceptInput(action: TutorialAction, frame: TutorialFrame) {
      if (outcome || phase !== 'await' || frame.phase !== 'running') return false;
      const id = step(), check = expected(), requested = action.requestedAltitudeLevel;
      const changesAltitude = requested !== undefined && requested !== frame.altitudeLevel;
      const accepted = id === 'steer' ? check === 'left' ? action.steer < -.2 : action.steer > .2
        : id === 'altitude' ? changesAltitude && (check === 'up' ? requested! > frame.altitudeLevel : requested! < frame.altitudeLevel)
        : id === 'boost' ? action.boost && (check === 'on' || changesAltitude)
        : id === 'brake' ? action.brake
        : id === 'hazard' ? changesAltitude && requested === targets.hazard?.altitudeLevel : false;
      if (!accepted) return false;
      previous = { ...frame }; activeCheck = check; elapsed = held = 0; phase = 'act'; emit(); return true;
    },
    skip() { if (!outcome && phase !== 'done') { done(true); emit(); } },
    skipAll() {
      if (outcome) return;
      for (const result of results) if (result.result === 'pending') { result.result = 'skipped'; skippedSteps++; }
      finish(); emit();
    },
    update(deltaSeconds: number, frame: TutorialFrame) {
      if (frame.phase !== 'running') { previous = { ...frame }; return; }
      const dt = Number.isFinite(deltaSeconds) ? Math.max(0, Math.min(.1, deltaSeconds)) : 0;
      if (outcome) { speedScale = Math.min(1, speedScale + dt * (1 - TUTORIAL_SPEED_SCALE)); return; }
      const before = JSON.stringify(snapshot());
      baseline ??= { ...frame };
      if (phase === 'done') {
        nextIn = Math.max(0, nextIn - dt);
        if (nextIn <= 1e-8) {
          index++;
          if (index === TUTORIAL_STEPS.length) finish();
          else {
            phase = 'intro'; checks = TUTORIAL_STEPS[index].checks.map(id => ({ id, done: false }));
            elapsed = held = 0; baseline = { ...frame }; activeCheck = undefined; demoExplained = false;
          }
        }
      } else if (phase === 'demo') {
        if (step() === 'hazard' && frame.atTarget) phase = 'await';
        else if (step() === 'near-miss') {
          if (!demoExplained && frame.atTarget) phase = 'freeze';
          else if (demoExplained && frame.nearMisses > baseline.nearMisses) { mark('once'); done(false); }
        }
      } else if (phase === 'act') {
        elapsed += dt;
        const id = step();
        if (id === 'throttle') { if (frame.speed > 5 && elapsed >= 2 - 1e-8) { mark('auto'); done(false); } }
        else if (id === 'hazard') {
          if (frame.collisions === baseline.collisions && frame.obstaclesPassed > baseline.obstaclesPassed) { mark('pass'); done(false); }
        } else {
          if (id === 'steer') {
            held += (activeCheck === 'left' ? frame.steer < -.2 : frame.steer > .2) ? dt : -held;
            if (held >= .12 - 1e-8) mark(activeCheck!);
          } else if (id === 'altitude' && frame.altitudeChanged && previous) {
            if (activeCheck === 'up' && frame.altitudeLevel > previous.altitudeLevel
              || activeCheck === 'down' && frame.altitudeLevel < previous.altitudeLevel) mark(activeCheck!);
          } else if (id === 'boost') {
            if (activeCheck === 'on' && frame.boosting) mark('on');
            if (activeCheck === 'alt-change' && frame.boosting && frame.altitudeChanged) mark('alt-change');
          } else if (id === 'brake') {
            held += frame.brake ? dt : -held; if (held >= .15 - 1e-8) mark('on');
          }
          if (elapsed >= ACTION_SECONDS - 1e-8) {
            if (checks.every(check => check.done)) done(false); else phase = 'await';
          }
        }
      }
      previous = { ...frame };
      if (before !== JSON.stringify(snapshot())) emit();
    },
  };
}
