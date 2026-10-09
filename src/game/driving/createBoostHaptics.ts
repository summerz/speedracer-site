type Vibration = (pattern: number | number[]) => boolean;

/** Short race cues and spaced boost pulses, driven by the race clock. */
export function createBoostHaptics(vibrate?: Vibration) {
  let enabled = true;
  let previousStage = 0;
  let elapsed = 0;
  let altitudeCue = false;
  let oneShotRemaining = 0;
  let collisionCooldown = 0;
  let nearMissCooldown = 0;
  const send = (pattern: number | number[]) => {
    try { vibrate?.(pattern); } catch { /* Device policy can deny vibration. */ }
  };
  const stop = () => {
    if (previousStage || altitudeCue || oneShotRemaining) send(0);
    previousStage = 0; elapsed = 0; altitudeCue = false;
    oneShotRemaining = 0; collisionCooldown = 0; nearMissCooldown = 0;
  };
  return {
    setEnabled(value: boolean) { enabled = value; if (!enabled) stop(); },
    altitudeStep() {
      if (!vibrate || !enabled || oneShotRemaining > 0) return;
      send(8); altitudeCue = true;
    },
    collision() {
      if (!vibrate || !enabled || collisionCooldown > 0) return;
      send([18, 25, 12]); oneShotRemaining = .09; collisionCooldown = .35;
    },
    nearMiss() {
      if (!vibrate || !enabled || oneShotRemaining > 0 || nearMissCooldown > 0) return;
      send(10); oneShotRemaining = .04; nearMissCooldown = .3;
    },
    update(delta: number, stage: number, active: boolean) {
      if (!vibrate || !enabled || !active) { stop(); return; }
      const dt = Number.isFinite(delta) ? Math.max(0, delta) : 0;
      collisionCooldown = Math.max(0, collisionCooldown - dt);
      nearMissCooldown = Math.max(0, nearMissCooldown - dt);
      if (oneShotRemaining > 0) {
        oneShotRemaining = Math.max(0, oneShotRemaining - dt);
        if (oneShotRemaining > 0) return;
      }
      if (stage === 0) {
        // Preserve race-cue cooldowns even while the pilot is not boosting.
        if (previousStage || altitudeCue) send(0);
        previousStage = 0; elapsed = 0; altitudeCue = false;
        return;
      }
      if (stage !== previousStage) {
        send(stage === 2 ? [28, 35, 18] : 18);
        previousStage = stage; elapsed = 0;
        return;
      }
      elapsed += dt;
      if (elapsed >= (stage === 2 ? 0.45 : 0.7)) {
        send(stage === 2 ? 10 : 6); elapsed = 0;
      }
    },
    stop,
    dispose: stop,
  };
}
