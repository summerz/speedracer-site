import { soundtrack } from '../audio/soundtrack.js';
import { createSoundEffectBank, type FileSoundCue, type RaceEffectFiles } from '../audio/soundEffectBank.js';
import type { RacePhase } from './createTimeAttack.js';
import type { AltitudeWarning } from './createRaceSoundFeedback.js';
import type { RaceCue } from './createRaceFeedback.js';
import { RAIN_INTENSITIES, type RainIntensity } from '../environment/raceEnvironment.js';

export type SoundCue = RaceCue | 'impact' | 'electric-impact' | 'off-track' | 'recovery' | 'height' | 'thunder' | 'boost-full' | 'boost-complete';
interface Voice { source: AudioScheduledSourceNode; nodes: AudioNode[]; music: boolean }
const frequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
const STEP_SECONDS = 60 / 144 / 4;

/** Drone engine and transient effects; the app owns the streaming soundtrack. Scheduling runs on the race frame, with no timers. */
export function createRaceAudio(files: RaceEffectFiles = {}) {
  const samples = createSoundEffectBank(files);
  let context: AudioContext | undefined;
  let effects: GainNode;
  let music: GainNode;
  let background: GainNode;
  let notification: GainNode;
  let notificationRouting = false;
  let warningDirection: AltitudeWarning = null;
  let alertUntil = 0, duckUntil = 0, alertPriority = 0;
  const pending = new Map<SoundCue, number>();
  const alertVoices = new Set<Voice>();
  let engine: OscillatorNode;
  let turbine: OscillatorNode;
  let charge: OscillatorNode;
  let engineGain: GainNode;
  let chargeGain: GainNode;
  let windGain: GainNode;
  let turbineGain: GainNode;
  let windFilter: BiquadFilterNode;
  let noise: AudioBuffer;
  let rainIntensity: RainIntensity | null = null;
  let rainSource: AudioBufferSourceNode | undefined;
  let rainGain: GainNode | undefined;
  let enabled = true;
  let musicEnabled = true;
  let disposed = false;
  let phase: RacePhase = 'ready';
  let previousStage = 0;
  let engineRestartAt = -10;
  const warningVoices = new Set<Voice>();
  let nextWarningAt = 0;
  const voices = new Set<Voice>();

  const release = (voice: Voice) => {
    voice.source.onended = null;
    for (const node of voice.nodes) node.disconnect();
    voices.delete(voice);
    warningVoices.delete(voice); alertVoices.delete(voice);
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
    return voice;
  };
  const envelope = (at: number, duration: number, level: number, bus: GainNode) => {
    const gain = context!.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(level, at + Math.min(0.012, duration / 4));
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    gain.connect(bus);
    return gain;
  };
  const tone = (hz: number, at: number, duration: number, level: number, type: OscillatorType = 'sine', isMusic = false, endHz?: number, isAlert = notificationRouting) => {
    const source = context!.createOscillator(); source.type = type;
    source.frequency.setValueAtTime(hz, at);
    if (endHz) source.frequency.exponentialRampToValueAtTime(endHz, at + duration * 0.8);
    const gain = envelope(at, duration, level, isMusic ? music : isAlert ? notification : background);
    const filter = context!.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = isMusic ? hz >= 500 ? 4800 : 1800 : 6500;
    source.connect(filter); filter.connect(gain);
    const voice = own(source, [source, filter, gain], isMusic, at, duration);
    if (isAlert) alertVoices.add(voice);
    return voice;
  };
  const hiss = (at: number, duration: number, level: number, hz: number, isMusic = false, type: BiquadFilterType = 'highpass') => {
    const source = context!.createBufferSource(); source.buffer = noise;
    const filter = context!.createBiquadFilter(); filter.type = type; filter.frequency.value = hz; filter.Q.value = 0.7;
    const gain = envelope(at, duration, level, isMusic ? music : notificationRouting ? notification : background);
    source.connect(filter); filter.connect(gain);
    own(source, [source, filter, gain], isMusic, at, duration);
  };
  const active = () => phase === 'running' || phase === 'countdown';
  const sample = (cue: FileSoundCue, at: number, isAlert = notificationRouting) => {
    const sound = samples.get(cue);
    if (!sound) return false;
    const source = context!.createBufferSource(); source.buffer = sound.buffer;
    const gain = context!.createGain(); gain.gain.value = sound.level;
    source.connect(gain); gain.connect(isAlert ? notification : background);
    const voice = own(source, [source, gain], false, at, sound.buffer.duration);
    if (isAlert) alertVoices.add(voice);
    return voice;
  };
  const ensureRain = () => {
    if (!context || rainSource || !rainIntensity) return;
    const buffer = context.createBuffer(1, context.sampleRate * 4, context.sampleRate);
    const samples = buffer.getChannelData(0);
    let patter = 0;
    const decay = Math.exp(-1 / (context.sampleRate * .012));
    for (let i = 0; i < samples.length; i++) {
      patter *= decay;
      if (Math.random() < 160 / context.sampleRate) patter = Math.random();
      samples[i] = (Math.random() * 2 - 1) * (.35 + patter * .65);
    }
    rainSource = context.createBufferSource(); rainSource.buffer = buffer; rainSource.loop = true;
    const filter = context.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.value = 2800; filter.Q.value = .3;
    rainGain = context.createGain(); rainGain.gain.value = 0;
    rainSource.connect(filter); filter.connect(rainGain); rainGain.connect(background); rainSource.start();
  };
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
        background = context.createGain(); notification = context.createGain();
        background.connect(effects); notification.connect(effects);
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
        engine.connect(engineFilter); engineFilter.connect(engineGain); engineGain.connect(background);
        turbine.connect(turbineGain); turbineGain.connect(background);
        charge.connect(chargeGain); chargeGain.connect(background);
        engine.start(); turbine.start(); charge.start();
        noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
        const data = noise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        const wind = context.createBufferSource(); wind.buffer = noise; wind.loop = true;
        windFilter = context.createBiquadFilter(); windFilter.type = 'bandpass'; windFilter.Q.value = 0.5;
        windGain = context.createGain(); windGain.gain.value = 0;
        wind.connect(windFilter); windFilter.connect(windGain); windGain.connect(background); wind.start();
      }
      ensureRain();
      void context.resume().catch(() => {});
      void samples.prepare(context);
    } catch { /* Optional audio never prevents playing. */ }
  };
  const emit = (cue: SoundCue) => {
    if (!context || context.state !== 'running' || !enabled || disposed) return;
    const now = context.currentTime;
    effects.gain.setTargetAtTime(0.75, now, 0.01);
    // Collisions still interrupt the continuous engine envelope, never its sources.
    if (cue === 'impact' || cue === 'electric-impact' || cue === 'off-track') engineRestartAt = now;
    if (sample(cue, now)) return;
    if (cue === 'impact' || cue === 'electric-impact' || cue === 'off-track') {
      engineRestartAt = now;
      if (cue === 'off-track') {
        // A falling skid/scrape, distinct from the short electrical impact.
        if (!sample('off-track', now)) hiss(now, .42, .38, 850, false, 'bandpass');
        tone(520, now, .34, .20, 'triangle', false, 85);
        tone(72, now + .04, .30, .24, 'sine', false, 32);
      } else {
        tone(110, now, .30, .32, 'sine', false, 26);
        if (!sample('impact', now)) {
          hiss(now, .12, .45, 1800, false, 'highpass');
          hiss(now + .035, .30, .34, cue === 'impact' ? 650 : 2600, false, 'bandpass');
        }
        if (cue === 'electric-impact') for (let i = 0; i < 4; i++) tone(2100 - i * 390, now + i * .032, .065, .12, 'sawtooth');
      }
    } else if (cue === 'boost-full') {
      // One high metallic bell: simultaneous inharmonic partials, long tail.
      tone(1568, now, .55, .12);
      tone(2510, now, .35, .045);
      tone(4234, now, .20, .025);
    } else if (cue === 'boost-complete') {
      // Lower rhythmic fanfare, resolving to a bright chord, distinct from recharge.
      [392, 494, 587].forEach((hz, i) => tone(hz, now + i * .10, .13, .12, 'square'));
      [392, 494, 784].forEach(hz => tone(hz, now + .30, .38, .065, 'triangle'));
    } else if (cue === 'thunder') {
      // Low noise rumble with an initial crack, kept beneath the engine/music mix.
      hiss(now, 1.8, .20, 220, false, 'lowpass');
      hiss(now, .18, .14, 1800, false, 'lowpass');
      tone(48, now, 1.3, .09, 'sine', false, 27);
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
  const priority = (cue: SoundCue) => cue === 'finish' || cue === 'final-lap' ? 5
    : cue === 'countdown' || cue === 'start' ? 4 : cue === 'lap' || cue === 'half-lap' ? 3 : 2;
  const cancelAlerts = () => {
    for (const voice of [...alertVoices]) {
      try { voice.source.stop(); } catch { /* Already ended. */ }
      release(voice);
    }
  };
  const mix = () => {
    if (!context) return;
    const ducked = enabled && context.currentTime < duckUntil;
    background.gain.setTargetAtTime(ducked ? .28 : 1, context.currentTime, ducked ? .012 : .12);
    soundtrack.setDucking(ducked ? .32 : 1);
  };
  const flush = () => {
    if (!context || !enabled || context.state !== 'running' || disposed) return;
    const now = context.currentTime;
    for (const [cue, at] of pending) if (now - at > 2.5) pending.delete(cue);
    const cue = [...pending.keys()].sort((a, b) => priority(b) - priority(a))[0];
    if (!cue || (warningDirection && priority(cue) < 3)
      || (now < alertUntil && priority(cue) <= alertPriority)) return;
    cancelAlerts(); pending.delete(cue);
    const duration = samples.get(cue)?.buffer.duration ?? (cue === 'boost-full' ? .62 : cue === 'boost-complete' ? .75
      : cue === 'finish' ? .85 : cue === 'final-lap' ? .75 : cue === 'lap' ? .6 : .45);
    alertUntil = now + duration; alertPriority = priority(cue); duckUntil = alertUntil;
    notificationRouting = true; emit(cue); notificationRouting = false; mix();
  };
  const play = (cue: SoundCue) => {
    if (!context || context.state !== 'running' || !enabled || disposed) return;
    if (cue === 'impact' || cue === 'electric-impact' || cue === 'off-track') {
      cancelAlerts(); clearWarning(); pending.clear();
      const duration = Math.max(.32, (samples.get(cue) ?? samples.get(cue === 'electric-impact' ? 'impact' : cue))?.buffer.duration ?? 0);
      alertUntil = context.currentTime + duration; alertPriority = 5;
      duckUntil = alertUntil + .1; mix(); notificationRouting = true; emit(cue); notificationRouting = false;
    } else if (cue === 'height' || cue === 'thunder' || cue === 'recovery') {
      // Mechanical/weather sounds stay under the notification bus.
      if (cue !== 'height' || context.currentTime >= alertUntil) emit(cue);
    } else {
      if (cue === 'finish') { pending.clear(); warningDirection = null; }
      pending.set(cue, context.currentTime); flush();
    }
  };
  const resetMix = () => {
    pending.clear(); warningDirection = null; alertUntil = duckUntil = alertPriority = 0;
    mix();
  };
  const clearWarning = () => {
    for (const voice of [...warningVoices]) {
      try { voice.source.stop(); } catch { /* Already ended. */ }
      release(voice);
    }
    nextWarningAt = 0;
  };
  return {
    activate,
    play,
    reset() { clearWarning(); stopVoices(); resetMix(); previousStage = 0; },
    setAltitudeWarning(direction: AltitudeWarning) {
      if (!direction || phase !== 'running' || !enabled || disposed || !context || context.state !== 'running') {
        clearWarning(); warningDirection = null; flush(); return;
      }
      if (direction !== warningDirection) { clearWarning(); warningDirection = direction; }
      const now = context.currentTime;
      if (now >= nextWarningAt && now >= alertUntil) {
        const cue = direction === 'up' ? 'warning-up' : 'warning-down';
        const warning = sample(cue, now, true);
        if (warning) {
          warningVoices.add(warning);
          const duration = samples.get(cue)!.buffer.duration;
          nextWarningAt = now + Math.max(.8, duration + .15);
          alertUntil = now + duration; alertPriority = 3; duckUntil = alertUntil + .08; mix();
          return;
        }
        const notes = direction === 'up' ? [660, 990, 1320] : [440, 330, 220];
        // Two rising whistle pulses vs a softer falling sine pair.
        warningVoices.add(tone(notes[0], now, .10, .095, direction === 'up' ? 'triangle' : 'sine', false, notes[1], true));
        warningVoices.add(tone(notes[1], now + .14, .10, .095, direction === 'up' ? 'triangle' : 'sine', false, notes[2], true));
        nextWarningAt = now + .8; alertUntil = now + .3; alertPriority = 3; duckUntil = now + .38; mix();
      }
    },
    pause() {
      clearWarning(); resetMix();
      phase = 'paused'; previousStage = 0; stopVoices(false, true); soundtrack.setScene('paused');
      if (context) {
        rainGain?.gain.setTargetAtTime(0, context.currentTime, .03);
        effects.gain.setTargetAtTime(0, context.currentTime, 0.015);
        music.gain.setTargetAtTime(0, context.currentTime, 0.035);
      }
    },
    setEnabled(value: boolean) {
      enabled = value;
      if (value) activate();
      else { clearWarning(); stopVoices(false, true); resetMix(); if (context) effects.gain.setTargetAtTime(0, context.currentTime, 0.015); }
    },
    setRainIntensity(value: RainIntensity | null) {
      rainIntensity = value;
      if (disposed) return;
      ensureRain();
      if (context) rainGain?.gain.setTargetAtTime(enabled && active() && value ? RAIN_INTENSITIES[value].volume : 0, context.currentTime, .15);
    },
    setMusicEnabled(value: boolean) {
      musicEnabled = value; soundtrack.setEnabled(value);
      if (value) activate();
      else { stopVoices(true, true); if (context) music.gain.setTargetAtTime(0, context.currentTime, 0.015); }
    },
    update(nextPhase: RacePhase, stage: number, progress: number, speedRatio: number, braking: boolean) {
      phase = nextPhase; soundtrack.setScene(nextPhase);
      if (!context || context.state !== 'running' || disposed) return;
      flush(); mix();
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
      rainGain?.gain.setTargetAtTime(enabled && active() && rainIntensity ? RAIN_INTENSITIES[rainIntensity].volume : 0, now, .15);
      charge.frequency.setTargetAtTime(260 + progress * 540, now, 0.04);
      chargeGain.gain.setTargetAtTime(racing && stage === 1 ? progress ** 2 * 0.05 : 0, now, 0.025);
      if (racing && enabled && stage > previousStage && !sample(stage === 2 ? 'boost-stage2' : 'boost-on', now, false)) {
        hiss(now, stage === 2 ? 0.38 : 0.2, stage === 2 ? 0.27 : 0.1, 1800, false, 'bandpass');
        tone(stage === 2 ? 110 : 160, now, 0.28, 0.15, 'sine', false, stage === 2 ? 330 : 220);
      }
      previousStage = racing ? stage : 0;
      music.gain.setTargetAtTime(active() && musicEnabled ? 0.65 : 0, now, 0.12);

    },
    dispose() {
      disposed = true; samples.dispose(); resetMix(); stopVoices();
      rainSource?.stop();
      if (context) void context.close().catch(() => {});
    },
  };
}
