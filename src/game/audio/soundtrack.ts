import { readMidi } from './midi.js';
import type { MidiScore } from './midi.js';
import { createMidiSynth } from './synth.js';

export type MusicScene = 'menu' | 'ready' | 'countdown' | 'running' | 'paused' | 'finished';
export const SOUNDTRACKS = [
  { file: '01_grid_theme', title: 'Grid Theme', climaxEnd: 120 },
  { file: '02_light_cycle_run', title: 'Light Cycle Run', climaxEnd: 120 },
  { file: '03_horizon_line', title: 'Horizon Line', climaxEnd: 104 },
  { file: '04_neon_pursuit', title: 'Neon Pursuit', climaxEnd: 120 },
  { file: '05_afterglow_circuit', title: 'Afterglow Circuit', climaxEnd: 112 },
] as const;
const MENU_ORDER = [0, 3, 1, 4, 2];
const RACE_ORDER = [1, 3, 0];
export function musicRegion(song: number, racing: boolean) {
  if (!SOUNDTRACKS[song]) throw new RangeError('Unknown soundtrack');
  // Preserve the continuous arrangement: only remove the quiet intro/outro.
  return { start: racing ? 128 : 64, end: SOUNDTRACKS[song].climaxEnd * 4 };
}

/** App-owned transport survives hangar/shop/race remounts. Effects remain a separate bus. */
export function createSoundtrack(load: (song: number) => Promise<MidiScore>, contextFactory = () => new AudioContext()) {
  const cache = new Map<number, Promise<MidiScore>>();
  const scoreFor = (song: number) => { if (!cache.has(song)) cache.set(song, load(song).catch(error => { cache.delete(song); throw error; })); return cache.get(song)!; };
  let context: AudioContext | undefined; let gain: GainNode; let synth: ReturnType<typeof createMidiSynth>;
  let scene: MusicScene = 'menu'; let enabled = true; let disposed = false;
  let song = 0; let orderIndex = 0; let racing = false; let score: MidiScore | undefined;
  let startTime = 0; let endTime = 0; let index = 0; let generation = 0; let pending = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const level = () => scene === 'running' || scene === 'countdown' ? .8 : scene === 'paused' ? .30 : .55;
  const begin = async () => {
    const current = ++generation; pending = true;
    try {
      const loaded = await scoreFor(song);
      if (disposed || current !== generation || !context) return;
      score = loaded; const region = musicRegion(song, racing);
      const beatSeconds = 60 / score.bpm;
      startTime = context.currentTime + .012 - region.start * beatSeconds;
      endTime = startTime + region.end * beatSeconds;
      index = score.notes.findIndex(note => note.beat >= region.start); if (index < 0) index = score.notes.length;
      pending = false; tick();
    } catch { if (current === generation) { pending = false; score = undefined; } } // Retry on the next gesture, never block driving.
  };
  const tick = () => {
    if (!context || disposed || !enabled || pending || !score || context.state !== 'running') return;
    const now = context.currentTime;
    gain.gain.setTargetAtTime(level(), now, .025);
    const region = musicRegion(song, racing); const beatSeconds = 60 / score.bpm;
    // Skip expired notes after a throttled tab instead of scheduling a burst of past events.
    while (index < score.notes.length && startTime + score.notes[index].beat * beatSeconds < now - .06) index++;
    while (index < score.notes.length) {
      const note = score.notes[index]; const at = startTime + note.beat * beatSeconds;
      if (note.beat >= region.end || at > now + .16) break;
      index++;
      synth.play({ ...note, duration: Math.min(note.duration, region.end - note.beat) }, Math.max(now, at), beatSeconds);
    }
    if (endTime <= now + .16) {
      // Preserve the downbeat at each region boundary; load the next score in advance.
      const order = racing ? RACE_ORDER : MENU_ORDER; orderIndex = (orderIndex + 1) % order.length; song = order[orderIndex];
      const boundary = endTime;
      if (cache.has(song)) {
        const current = ++generation; pending = true;
        void scoreFor(song).then(loaded => {
          if (disposed || current !== generation) return;
          score = loaded; const region = musicRegion(song, racing); const beatSeconds = 60 / loaded.bpm;
          startTime = Math.max(boundary, context!.currentTime + .005) - region.start * beatSeconds;
          endTime = startTime + region.end * beatSeconds;
          index = loaded.notes.findIndex(note => note.beat >= region.start); if (index < 0) index = loaded.notes.length;
          pending = false; tick();
        }).catch(() => { if (current === generation) { pending = false; score = undefined; } });
      } else void begin();
      return;
    }
    const order = racing ? RACE_ORDER : MENU_ORDER;
    void scoreFor(order[(orderIndex + 1) % order.length]).catch(() => {});
  };
  const activate = () => {
    if (disposed || !enabled) return;
    try {
      if (!context) {
        context = contextFactory(); gain = context.createGain(); gain.gain.value = level();
        const limiter = context.createDynamicsCompressor(); limiter.threshold.value = -12; limiter.knee.value = 12; limiter.ratio.value = 4;
        const delay = context.createDelay(.5); delay.delayTime.value = .18;
        const echo = context.createGain(); echo.gain.value = .16;
        const filter = context.createBiquadFilter(); filter.frequency.value = 2200;
        gain.connect(limiter); gain.connect(delay); delay.connect(filter); filter.connect(echo); echo.connect(limiter);
        limiter.connect(context.destination); synth = createMidiSynth(context, gain);
        timer = setInterval(tick, 40);
      }
      void context.resume().then(() => { if (!disposed && !score && !pending) void begin(); }).catch(() => {});
    } catch { /* Audio is optional. */ }
  };
  return {
    activate,
    preload() { void scoreFor(0).catch(() => {}); void scoreFor(1).catch(() => {}); },
    setScene(next: MusicScene) {
      const enteringRace = (next === 'countdown' || next === 'running') && !['countdown', 'running', 'paused'].includes(scene);
      scene = next;
      if (enteringRace) {
        racing = true; song = RACE_ORDER[0]; orderIndex = 0; score = undefined;
        if (context) { synth.stop(); void begin(); }
      } else if (next === 'menu' && racing) {
        // Keep the current phrase; the next track follows the five-song menu playlist.
        racing = false; orderIndex = MENU_ORDER.indexOf(song);
        if (score) { const region = musicRegion(song, false); endTime = startTime + region.end * 60 / score.bpm; }
      }
      if (context) gain.gain.setTargetAtTime(enabled ? level() : 0, context.currentTime, .025);
    },
    setEnabled(value: boolean) { enabled = value; if (context) gain.gain.setTargetAtTime(value ? level() : 0, context.currentTime, .025); if (value) activate(); },
    get enabled() { return enabled; },
    snapshot() { return { song: SOUNDTRACKS[song].title, scene, racing, enabled, voices: synth?.voiceCount ?? 0, loaded: !!score, state: context?.state ?? 'locked' }; },
    suspend() { if (context) void context.suspend().catch(() => {}); },
    dispose() { disposed = true; generation++; if (timer) clearInterval(timer); synth?.dispose(); if (context) void context.close().catch(() => {}); },
  };
}

let player: ReturnType<typeof createSoundtrack> | undefined;
export const soundtrack = {
  start() {
    if (player) return;
    player = createSoundtrack(async song => {
      const response = await fetch(`${import.meta.env.BASE_URL}music/${SOUNDTRACKS[song].file}.mid`);
      if (!response.ok) throw new Error('Soundtrack unavailable');
      return readMidi(await response.arrayBuffer());
    });
    try { player.setEnabled(localStorage.getItem('speedracer-music') !== 'off'); } catch { /* Optional preference. */ }
    player.preload();
  },
  activate() { player?.activate(); },
  setScene(scene: MusicScene) { player?.setScene(scene); },
  setEnabled(enabled: boolean) { player?.setEnabled(enabled); try { localStorage.setItem('speedracer-music', enabled ? 'on' : 'off'); } catch { /* Optional preference. */ } },
  get enabled() { return player?.enabled ?? true; },
  suspend() { player?.suspend(); },
  dispose() { player?.dispose(); player = undefined; },
};
