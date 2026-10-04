type Vibration = (pattern: number | number[]) => boolean;

/** Short stage cues and spaced pulses, driven by the race clock. */
export function createBoostHaptics(vibrate?: Vibration) {
  let enabled = true;
  let previousStage = 0;
  let elapsed = 0;
  let altitudeCue = false;
  const send = (pattern: number | number[]) => {
    try { vibrate?.(pattern); } catch { /* Device policy can deny vibration. */ }
  };
  const stop = () => {
    if (previousStage || altitudeCue) send(0);
    previousStage = 0; elapsed = 0; altitudeCue = false;
  };
  return {
    setEnabled(value: boolean) { enabled = value; if (!enabled) stop(); },
    altitudeStep() {
      if (!vibrate || !enabled) return;
      send(8); altitudeCue = true;
    },
    update(delta: number, stage: number, active: boolean) {
      if (!vibrate || !enabled || !active || stage === 0) { stop(); return; }
      if (stage !== previousStage) {
        send(stage === 2 ? [28, 35, 18] : 18);
        previousStage = stage; elapsed = 0;
        return;
      }
      elapsed += Math.max(0, delta);
      if (elapsed >= (stage === 2 ? 0.45 : 0.7)) {
        send(stage === 2 ? 10 : 6); elapsed = 0;
      }
    },
    stop,
    dispose: stop,
  };
}
