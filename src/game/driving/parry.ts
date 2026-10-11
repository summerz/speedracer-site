/** Player-only, one-impact defense. The clock is running race time, independent of focus slow motion. */
export type ParryTargetKind = 'height' | 'mine' | 'corridor' | 'wall' | 'craft';
export interface ParryPosition { x: number; y: number; z: number }
export interface ParryTarget {
  id: string; kind: ParryTargetKind; worldPosition: ParryPosition | null; secondsToImpact: number;
}
export interface ParryEvent { id: number; outcome: 'success' | 'failure'; target: ParryTarget | null }
export interface ParrySnapshot {
  enabled: boolean; phase: 'ready' | 'window' | 'cooldown'; windowRemaining: number; cooldownRemaining: number;
  target: ParryTarget | null; lastEvent: ParryEvent | null; successEventId: number; failureEventId: number;
  successes: number; failures: number; interrupted: boolean;
}
export const PARRY_TUNING = Object.freeze({ windowSeconds: .30, cooldownSeconds: 6, warningSeconds: .7,
  contactReleaseSeconds: .25, contactClearance: .5, contactPush: .25 });
export function createParryController(enabled = true) {
  let window = 0, cooldown = 0, id = 0, successes = 0, failures = 0, successEventId = 0, failureEventId = 0;
  let target: ParryTarget | null = null, lastEvent: ParryEvent | null = null;
  let interrupted = false;
  const episodes = new Set<string>();
  const emit = (outcome: ParryEvent['outcome'], hit: ParryTarget | null) => {
    lastEvent = { id: ++id, outcome, target: hit };
    if (outcome === 'success') { successes++; successEventId = id; }
    else { failures++; failureEventId = id; }
  };
  return {
    snapshot(): ParrySnapshot { return { enabled, phase: window > 0 ? 'window' : cooldown > 0 ? 'cooldown' : 'ready',
      windowRemaining: window, cooldownRemaining: cooldown, target, lastEvent, successEventId, failureEventId, successes, failures, interrupted }; },
    request() {
      if (!enabled || cooldown > 1e-8) return false;
      interrupted = false; window = PARRY_TUNING.windowSeconds; cooldown = PARRY_TUNING.cooldownSeconds; return true;
    },
    advance(dt: number) {
      if (!Number.isFinite(dt) || dt <= 0) return;
      cooldown = Math.max(0, cooldown - dt);
      if (cooldown < 1e-8) cooldown = 0;
      if (window > 0) {
        window = Math.max(0, window - dt);
        if (window < 1e-8) { window = 0; emit('failure', target); }
      }
    },
    /** A contact that began unprotected cannot be parried later while still rubbing that surface. */
    impact(hit: ParryTarget) {
      if (!enabled) return false;
      const fresh = !episodes.has(hit.id); episodes.add(hit.id);
      if (!fresh || window <= 0) return false;
      window = 0; emit('success', { ...hit, secondsToImpact: 0 }); return true;
    },
    releaseEpisode(episode: string) { episodes.delete(episode); },
    /** Actual damage consumes an open attempt and suppresses a lingering failed shield, without restarting recharge. */
    damage() { interrupted = true; if (window > 0) { window = 0; emit('failure', target); } },
    setTarget(next: ParryTarget | null) { target = enabled ? next : null; },
    /** Recovery, awakening and finish cancel an open window without inventing a failed timing attempt. */
    cancel() { interrupted = true; window = 0; target = null; },
    reset() { interrupted = false; window = cooldown = id = successes = failures = successEventId = failureEventId = 0; target = lastEvent = null; episodes.clear(); },
  };
}
