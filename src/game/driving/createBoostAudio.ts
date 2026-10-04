/** Small procedural boost sound, created only from a user gesture. */
export function createBoostAudio() {
  let context: AudioContext | undefined;
  let master: GainNode;
  let engine: OscillatorNode;
  let charge: OscillatorNode;
  let engineGain: GainNode;
  let chargeGain: GainNode;
  let noise: AudioBuffer;
  let enabled = true;
  let disposed = false;
  let previousStage = 0;
  const activate = () => {
    if (!enabled || disposed || typeof AudioContext === 'undefined') return;
    try {
      if (!context) {
        context = new AudioContext();
        master = context.createGain(); master.gain.value = 0.7; master.connect(context.destination);
        engine = context.createOscillator(); engine.type = 'triangle';
        charge = context.createOscillator(); charge.type = 'sine';
        engineGain = context.createGain(); chargeGain = context.createGain();
        engineGain.gain.value = 0; chargeGain.gain.value = 0;
        engine.connect(engineGain); charge.connect(chargeGain);
        engineGain.connect(master); chargeGain.connect(master);
        engine.start(); charge.start();
        noise = context.createBuffer(1, Math.ceil(context.sampleRate * 0.22), context.sampleRate);
        const data = noise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      }
      void context.resume().catch(() => {});
    } catch { /* Sound availability must not interrupt a race. */ }
  };
  const silence = () => {
    previousStage = 0;
    if (!context) return;
    master.gain.cancelScheduledValues(context.currentTime);
    master.gain.setTargetAtTime(0, context.currentTime, 0.012);
  };
  return {
    activate,
    silence,
    setEnabled(value: boolean) { enabled = value; if (enabled) activate(); else silence(); },
    update(running: boolean, stage: number, progress: number, speedRatio: number) {
      if (!context || !master) return;
      const now = context.currentTime;
      const active = running && enabled && stage > 0;
      master.gain.setTargetAtTime(active ? 0.7 : 0, now, 0.03);
      engine.frequency.setTargetAtTime(stage === 2 ? 156 + speedRatio * 65 : 88 + speedRatio * 60, now, 0.07);
      engineGain.gain.setTargetAtTime(active ? 0.045 : 0, now, 0.04);
      charge.frequency.setTargetAtTime(240 + progress * 420, now, 0.04);
      chargeGain.gain.setTargetAtTime(active && stage === 1 ? progress ** 3 * 0.035 : 0, now, 0.025);
      if (active && stage === 2 && previousStage !== 2) {
        const source = context.createBufferSource(); source.buffer = noise;
        const filter = context.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.value = 1400; filter.Q.value = 0.6;
        const envelope = context.createGain(); envelope.gain.setValueAtTime(0, now);
        envelope.gain.linearRampToValueAtTime(0.16, now + 0.015);
        envelope.gain.exponentialRampToValueAtTime(0.001, now + 0.21);
        source.connect(filter); filter.connect(envelope); envelope.connect(master);
        source.onended = () => { source.disconnect(); filter.disconnect(); envelope.disconnect(); };
        source.start(now); source.stop(now + 0.22);
      }
      previousStage = active ? stage : 0;
    },
    dispose() { disposed = true; if (context) { silence(); void context.close().catch(() => {}); } },
  };
}
