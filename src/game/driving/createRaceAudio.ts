import type { RacePhase } from './createTimeAttack.js';
import type { RaceCue } from './createRaceFeedback.js';

export type SoundCue = RaceCue | 'impact' | 'electric-impact' | 'recovery' | 'height';
interface Voice { source: AudioScheduledSourceNode; nodes: AudioNode[]; music: boolean }
const frequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
const STEP_SECONDS = 60 / 132 / 4;

/** Original synth score and drone sounds. Scheduling runs on the race frame, with no timers. */
export function createRaceAudio() {
  let context: AudioContext | undefined;
  let effects: GainNode;
  let music: GainNode;
  let engine: OscillatorNode;
  let turbine: OscillatorNode;
  let charge: OscillatorNode;
  let engineGain: GainNode;
  let chargeGain: GainNode;
  let windGain: GainNode;
  let turbineGain: GainNode;
  let windFilter: BiquadFilterNode;
  let noise: AudioBuffer;
  let enabled = true;
  let musicEnabled = true;
  let disposed = false;
  let phase: RacePhase = 'ready';
  let previousStage = 0;
  let nextStep = 0;
  let step = 0;
  let sequencing = false;
  let engineRestartAt = -10;
  const voices = new Set<Voice>();

  const release = (voice: Voice) => {
    voice.source.onended = null;
    for (const node of voice.nodes) node.disconnect();
    voices.delete(voice);
  };
  const stopVoices = (musicOnly = false, fade = false) => {
    for (const voice of [...voices]) {
      if (musicOnly && !voice.music) continue;
      try { voice.source.stop(fade ? context!.currentTime + 0.04 : undefined); } catch { /* Already ended. */ }
      if (!fade) release(voice);
    }
  };
  const own = (source: AudioScheduledSourceNode, nodes: AudioNode[], isMusic: boolean, at: number, duration: number) => {
    if (voices.size >= 80) {
      const oldest = voices.values().next().value!;
      try { oldest.source.stop(); } catch { /* Already ended. */ }
      release(oldest);
    }
    const voice = { source, nodes, music: isMusic };
    voices.add(voice);
    source.onended = () => release(voice);
    source.start(at); source.stop(at + duration);
  };
  const envelope = (at: number, duration: number, level: number, bus: GainNode) => {
    const gain = context!.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(level, at + Math.min(0.012, duration / 4));
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    gain.connect(bus);
    return gain;
  };
  const tone = (hz: number, at: number, duration: number, level: number, type: OscillatorType = 'sine', isMusic = false, endHz?: number) => {
    const source = context!.createOscillator(); source.type = type;
    source.frequency.setValueAtTime(hz, at);
    if (endHz) source.frequency.exponentialRampToValueAtTime(endHz, at + duration * 0.8);
    const gain = envelope(at, duration, level, isMusic ? music : effects);
    const filter = context!.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = isMusic ? 2100 : 6500;
    source.connect(filter); filter.connect(gain);
    own(source, [source, filter, gain], isMusic, at, duration);
  };
  const hiss = (at: number, duration: number, level: number, hz: number, isMusic = false, type: BiquadFilterType = 'highpass') => {
    const source = context!.createBufferSource(); source.buffer = noise;
    const filter = context!.createBiquadFilter(); filter.type = type; filter.frequency.value = hz; filter.Q.value = 0.7;
    const gain = envelope(at, duration, level, isMusic ? music : effects);
    source.connect(filter); filter.connect(gain);
    own(source, [source, filter, gain], isMusic, at, duration);
  };
  const active = () => phase === 'running' || phase === 'countdown';
  const activate = () => {
    if (disposed || (!enabled && !musicEnabled) || typeof AudioContext === 'undefined') return;
    try {
      if (!context) {
        context = new AudioContext();
        const master = context.createGain(); master.gain.value = 0.8;
        const limiter = context.createDynamicsCompressor();
        limiter.threshold.value = -15; limiter.knee.value = 14; limiter.ratio.value = 5;
        master.connect(limiter); limiter.connect(context.destination);
        effects = context.createGain(); music = context.createGain();
        effects.gain.value = 0; music.gain.value = 0;
        effects.connect(master); music.connect(master);
        const echo = context.createDelay(1); echo.delayTime.value = STEP_SECONDS * 3;
        const feedback = context.createGain(); feedback.gain.value = 0.24;
        const echoFilter = context.createBiquadFilter(); echoFilter.frequency.value = 1600;
        music.connect(echo); echo.connect(echoFilter); echoFilter.connect(feedback);
        feedback.connect(echo); feedback.connect(master);
        engine = context.createOscillator(); engine.type = 'sawtooth';
        turbine = context.createOscillator(); turbine.type = 'triangle'; turbine.detune.value = 9;
        charge = context.createOscillator(); charge.type = 'sine';
        engineGain = context.createGain(); chargeGain = context.createGain();
        turbineGain = context.createGain(); turbineGain.gain.value = 0;
        engineGain.gain.value = 0; chargeGain.gain.value = 0;
        const engineFilter = context.createBiquadFilter(); engineFilter.frequency.value = 380;
        engine.connect(engineFilter); engineFilter.connect(engineGain); engineGain.connect(effects);
        turbine.connect(turbineGain); turbineGain.connect(effects);
        charge.connect(chargeGain); chargeGain.connect(effects);
        engine.start(); turbine.start(); charge.start();
        noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
        const data = noise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        const wind = context.createBufferSource(); wind.buffer = noise; wind.loop = true;
        windFilter = context.createBiquadFilter(); windFilter.type = 'bandpass'; windFilter.Q.value = 0.5;
        windGain = context.createGain(); windGain.gain.value = 0;
        wind.connect(windFilter); windFilter.connect(windGain); windGain.connect(effects); wind.start();
      }
      void context.resume().catch(() => {});
    } catch { /* Optional audio never prevents playing. */ }
  };
  const play = (cue: SoundCue) => {
    if (!context || context.state !== 'running' || !enabled || disposed) return;
    const now = context.currentTime;
    effects.gain.setTargetAtTime(0.75, now, 0.01);
    if (cue === 'impact' || cue === 'electric-impact') {
      engineRestartAt = now;
      tone(90, now, 0.23, 0.22, 'sine', false, 28);
      hiss(now, 0.26, 0.3, cue === 'impact' ? 650 : 2600, false, 'bandpass');
      if (cue === 'electric-impact') for (let i = 0; i < 3; i++) tone(1800 - i * 430, now + i * 0.035, 0.055, 0.07, 'sawtooth');
    } else if (cue === 'countdown') {
      tone(440, now, 0.12, 0.15);
    } else if (cue === 'height') {
      tone(660, now, 0.09, 0.06, 'sine', false, 880);
    } else if (cue === 'recovery') {
      tone(230, now, 0.35, 0.12, 'triangle', false, 480);
    } else {
      const notes = cue === 'final-lap' ? [64, 71, 76, 83] : cue === 'finish' ? [64, 67, 71, 76, 83] : cue === 'half-lap' ? [76, 79] : cue === 'lap' ? [71, 76, 79] : [64, 76];
      notes.forEach((note, i) => tone(frequency(note), now + i * 0.11, 0.24, cue === 'final-lap' ? 0.14 : 0.1, 'triangle'));
    }
  };
  const sequenceStep = (index: number, at: number) => {
    const bar = Math.floor(index / 16) % 8;
    const beat = index % 16;
    const roots = [40, 36, 43, 38, 40, 36, 45, 47];
    const intervals = bar === 1 || bar === 2 || bar === 5 ? [0, 4, 7, 11] : [0, 3, 7, 10];
    const root = roots[bar];
    if (beat % 4 === 0) tone(125, at, 0.2, 0.28, 'sine', true, 38);
    if (beat === 4 || beat === 12) { hiss(at, 0.13, 0.16, 1600, true); tone(170, at, 0.08, 0.07, 'triangle', true); }
    if (beat % 2 === 0) hiss(at, beat === 14 ? 0.12 : 0.045, beat % 4 === 2 ? 0.065 : 0.035, 7500, true);
    if ([0, 3, 6, 8, 11, 14].includes(beat)) tone(frequency(root), at, STEP_SECONDS * 1.7, 0.075, 'triangle', true);
    // Offset arpeggio and a long, quiet chord leave room for the engine and impact sounds.
    const motif = [0, 2, 1, 3, 2, 1, 3, 1];
    if (beat % 2 === 1) tone(frequency(root + 24 + intervals[motif[Math.floor(beat / 2)]]), at, STEP_SECONDS * 2.2, 0.034, 'triangle', true);
    if (beat === 0) for (const interval of intervals.slice(0, 3)) tone(frequency(root + 12 + interval), at, STEP_SECONDS * 15, 0.019, 'sine', true);
  };
  return {
    activate,
    play,
    reset() { stopVoices(); previousStage = 0; step = 0; sequencing = false; },
    pause() {
      phase = 'paused'; sequencing = false; previousStage = 0; stopVoices(false, true);
      if (context) {
        effects.gain.setTargetAtTime(0, context.currentTime, 0.015);
        music.gain.setTargetAtTime(0, context.currentTime, 0.035);
      }
    },
    setEnabled(value: boolean) {
      enabled = value;
      if (value) activate();
      else if (context) effects.gain.setTargetAtTime(0, context.currentTime, 0.015);
    },
    setMusicEnabled(value: boolean) {
      musicEnabled = value;
      if (value) activate();
      else { sequencing = false; stopVoices(true, true); if (context) music.gain.setTargetAtTime(0, context.currentTime, 0.015); }
    },
    update(nextPhase: RacePhase, stage: number, progress: number, speedRatio: number, braking: boolean) {
      phase = nextPhase;
      if (!context || context.state !== 'running' || disposed) return;
      const now = context.currentTime;
      const racing = phase === 'running';
      effects.gain.setTargetAtTime(enabled && (active() || phase === 'finished') ? 0.75 : 0, now, 0.025);
      const restart = Math.min(1, Math.max(0, now - engineRestartAt) / 0.65);
      engine.frequency.setTargetAtTime((46 + Math.max(0, speedRatio) * 90 + stage * 28) * (0.35 + restart * 0.65), now, 0.06);
      engineGain.gain.setTargetAtTime(racing ? (0.025 + Math.min(speedRatio, 2) * 0.035 + stage * 0.015) * (0.15 + restart * 0.85) : 0, now, 0.035);
      turbine.frequency.setTargetAtTime((190 + speedRatio * 230 + stage * 70) * (0.5 + restart * 0.5), now, 0.08);
      turbineGain.gain.setTargetAtTime(racing ? (0.012 + stage * 0.004) * restart : 0, now, 0.04);
      windFilter.frequency.setTargetAtTime(450 + speedRatio * 1400 + (braking ? 1100 : 0), now, 0.1);
      windGain.gain.setTargetAtTime(racing ? Math.min(speedRatio, 2) * 0.025 + (braking ? 0.03 : 0) : 0, now, 0.06);
      charge.frequency.setTargetAtTime(260 + progress * 540, now, 0.04);
      chargeGain.gain.setTargetAtTime(racing && stage === 1 ? progress ** 2 * 0.05 : 0, now, 0.025);
      if (racing && enabled && stage > previousStage) {
        hiss(now, stage === 2 ? 0.38 : 0.2, stage === 2 ? 0.27 : 0.1, 1800, false, 'bandpass');
        tone(stage === 2 ? 110 : 160, now, 0.28, 0.15, 'sine', false, stage === 2 ? 330 : 220);
      }
      previousStage = racing ? stage : 0;
      music.gain.setTargetAtTime(active() && musicEnabled ? 0.65 : 0, now, 0.12);
      if (active() && musicEnabled) {
        if (!sequencing || nextStep < now - 0.2) { nextStep = now + 0.025; sequencing = true; }
        while (nextStep < now + 0.22) { sequenceStep(step++, nextStep); nextStep += STEP_SECONDS; }
      } else if (sequencing) { sequencing = false; stopVoices(true, true); }
    },
    dispose() {
      disposed = true; stopVoices();
      if (context) void context.close().catch(() => {});
    },
  };
}
