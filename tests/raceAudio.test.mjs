import test from 'node:test';
import assert from 'node:assert/strict';
import { createRaceAudio } from '../output/test/game/driving/createRaceAudio.js';

class Param {
  value = 0;
  values = [];
  setValueAtTime(value) { this.value = value; this.values.push(value); }
  linearRampToValueAtTime(value) { this.value = value; }
  exponentialRampToValueAtTime(value) { this.value = value; }
  setTargetAtTime(value) { this.value = value; }
}
class Node {
  gain = new Param(); frequency = new Param(); Q = new Param(); detune = new Param(); delayTime = new Param();
  threshold = new Param(); knee = new Param(); ratio = new Param();
  connections = []; stops = []; starts = [];
  connect(node) { this.connections.push(node); }
  disconnect() { this.connections = []; }
  start(at = 0) { this.starts.push(at); }
  stop(at = 0) { this.stops.push(at); }
}
class Context {
  static instances = [];
  currentTime = 0; sampleRate = 100; state = 'running'; destination = new Node();
  gains = []; oscillators = []; sources = []; decoded = [];
  constructor() { Context.instances.push(this); }
  createGain() { const node = new Node(); this.gains.push(node); return node; }
  createOscillator() { const node = new Node(); this.oscillators.push(node); return node; }
  createBufferSource() { const node = new Node(); this.sources.push(node); return node; }
  createBiquadFilter() { return new Node(); }
  createDynamicsCompressor() { return new Node(); }
  createDelay() { return new Node(); }
  createBuffer(_, frames) { return { getChannelData: () => new Float32Array(frames) }; }
  async decodeAudioData(bytes) { const buffer = { duration: new Uint8Array(bytes)[0] / 10 }; this.decoded.push(buffer); return buffer; }
  resume() { this.state = 'running'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
}

test('file effects use the alert bus, cancel earlier impacts, preserve the engine, and stop with race lifecycle', async () => {
  const originalContext = globalThis.AudioContext, originalFetch = globalThis.fetch;
  globalThis.AudioContext = Context;
  globalThis.fetch = async url => new Response(new Uint8Array([url.includes('collision') ? 5 : 9]));
  const audio = createRaceAudio({
    impact: { url: '/audio-test-collision.mp3', level: .65 },
    'off-track': { url: '/audio-test-departure.mp3', level: .5 },
  });
  try {
    audio.activate(); await new Promise(resolve => setImmediate(resolve));
    const ctx = Context.instances.at(-1), engine = ctx.oscillators[0];
    audio.update('running', 0, 0, 1, false);
    audio.play('electric-impact');
    const collision = ctx.sources.find(source => source.buffer?.duration === .5);
    assert.ok(collision); assert.equal(collision.starts.length, 1);
    const alertBus = collision.connections[0].connections[0];
    assert.notEqual(alertBus, engine.connections[0].connections[0].connections[0]);
    ctx.currentTime = .1; audio.play('off-track');
    assert.ok(collision.stops.includes(0)); assert.equal(collision.connections.length, 0);
    const departure = ctx.sources.find(source => source.buffer?.duration === .9);
    assert.ok(departure); assert.equal(departure.connections[0].connections[0], alertBus);
    assert.equal(engine.starts.length, 1); assert.equal(engine.stops.length, 0);
    ctx.currentTime = .2; audio.pause(); assert.ok(departure.stops.some(at => Math.abs(at - .24) < 1e-8));
    ctx.currentTime = 1; audio.update('running', 0, 0, 1, false); audio.play('impact');
    const muted = ctx.sources.at(-1);
    audio.setEnabled(false); assert.ok(muted.stops.includes(1.04));
    const count = ctx.sources.length; audio.play('impact'); assert.equal(ctx.sources.length, count);
    audio.setEnabled(true); ctx.currentTime = 2; audio.play('impact');
    const disposed = ctx.sources.at(-1); audio.dispose();
    assert.ok(disposed.stops.includes(0)); assert.equal(disposed.connections.length, 0);
    assert.equal(ctx.state, 'closed');
  } finally { audio.dispose(); globalThis.AudioContext = originalContext; globalThis.fetch = originalFetch; }
});

test('an early collision falls back immediately; finishing a download never plays a stale cue', async () => {
  const originalContext = globalThis.AudioContext, originalFetch = globalThis.fetch;
  globalThis.AudioContext = Context;
  let finish;
  globalThis.fetch = () => new Promise(resolve => { finish = resolve; });
  const audio = createRaceAudio({ impact: { url: '/audio-test-delayed.mp3', level: .6 } });
  try {
    audio.activate(); const ctx = Context.instances.at(-1);
    audio.update('running', 0, 0, 1, false); audio.play('impact');
    assert.equal(ctx.sources.filter(source => !source.loop).length, 2);
    const before = ctx.sources.length;
    finish(new Response(new Uint8Array([5]))); await new Promise(resolve => setImmediate(resolve));
    assert.equal(ctx.sources.length, before);
    ctx.currentTime = 1; audio.play('impact');
    assert.equal(ctx.sources.at(-1).buffer.duration, .5);
  } finally { audio.dispose(); globalThis.AudioContext = originalContext; globalThis.fetch = originalFetch; }
});

test('unavailable files retain synthesized collision and off-track feedback', async () => {
  const originalContext = globalThis.AudioContext, originalFetch = globalThis.fetch;
  globalThis.AudioContext = Context;
  globalThis.fetch = async () => { throw new Error('Offline'); };
  const audio = createRaceAudio({
    impact: { url: '/audio-test-missing-impact.mp3', level: .6 },
    'off-track': { url: '/audio-test-missing-departure.mp3', level: .5 },
  });
  try {
    audio.activate(); await new Promise(resolve => setImmediate(resolve));
    const ctx = Context.instances.at(-1);
    audio.play('impact'); assert.equal(ctx.sources.filter(source => !source.loop).length, 2);
    const before = ctx.sources.length; audio.play('off-track');
    assert.equal(ctx.sources.length, before + 1);
    assert.ok(ctx.oscillators.some(source => source.type === 'triangle' && source.frequency.values.includes(520)));
  } finally { audio.dispose(); globalThis.AudioContext = originalContext; globalThis.fetch = originalFetch; }
});

test('rain runs continuously through impacts, follows intensity, ducks warnings, and stops on pause/mute/dispose', () => {
  const original = globalThis.AudioContext; globalThis.AudioContext = Context;
  try {
    const audio = createRaceAudio(); audio.setRainIntensity('light'); audio.activate();
    const ctx = Context.instances.at(-1);
    const rain = ctx.sources.find(source => source.loop && source.buffer !== ctx.sources[0].buffer);
    assert.ok(rain);
    const gain = rain.connections[0].connections[0];
    const bus = gain.connections[0];
    audio.update('ready', 0, 0, 1, false); assert.equal(gain.gain.value, 0);
    audio.update('running', 0, 0, 1, false); const lightVolume = gain.gain.value;
    assert.ok(lightVolume > 0);
    audio.setRainIntensity('heavy'); assert.ok(gain.gain.value > lightVolume);
    audio.play('electric-impact'); audio.update('running', 0, 0, 1, false);
    assert.equal(rain.starts.length, 1); assert.equal(rain.stops.length, 0);
    ctx.currentTime = 1; audio.setAltitudeWarning('up'); assert.ok(bus.gain.value < 1);
    audio.pause(); assert.equal(gain.gain.value, 0);
    audio.update('running', 0, 0, 1, false); assert.ok(gain.gain.value > 0);
    audio.setEnabled(false); audio.update('running', 0, 0, 1, false); assert.equal(gain.gain.value, 0);
    audio.setEnabled(true); audio.update('running', 0, 0, 1, false); assert.ok(gain.gain.value > 0);
    audio.setRainIntensity(null); assert.equal(gain.gain.value, 0);
    audio.dispose(); assert.equal(rain.stops.length, 1); assert.equal(ctx.state, 'closed');
  } finally { globalThis.AudioContext = original; }
});

test('cruise engine stays audible after boost release; collision drops pitch then recovers without restarting music', () => {
  const original = globalThis.AudioContext;
  globalThis.AudioContext = Context;
  try {
    const audio = createRaceAudio(); audio.activate();
    const ctx = Context.instances.at(-1);
    audio.update('running', 0, 0, 1, false);
    const cruise = ctx.oscillators[0].frequency.value;
    const scheduledMusic = ctx.oscillators.slice(3);
    assert.ok(ctx.oscillators[0].connections[0].connections[0].gain.value > 0, 'engine gain is audible without boost');
    audio.update('running', 2, 1, 1, false);
    audio.update('running', 0, 0, 1, false);
    assert.ok(ctx.oscillators[0].connections[0].connections[0].gain.value > 0, 'release leaves cruise engine audible');
    audio.play('electric-impact'); audio.update('running', 0, 0, 1, false);
    assert.ok(ctx.oscillators[0].frequency.value < cruise / 2);
    assert.ok(scheduledMusic.every(node => node.stops.length === 1), 'collision does not cancel scheduled score');
    ctx.currentTime = 0.8; audio.update('running', 0, 0, 1, false);
    assert.equal(ctx.oscillators[0].frequency.value, cruise);
    const count = Context.instances.length;
    audio.activate(); assert.equal(Context.instances.length, count, 'all interactions reuse one context');
    audio.dispose(); assert.equal(ctx.state, 'closed');
    assert.ok(ctx.oscillators.every(node => node.starts.length === 1));
  } finally { globalThis.AudioContext = original; }
});

test('music and sound effects have independent mute controls, and pause clears scheduled voices', () => {
  const original = globalThis.AudioContext;
  globalThis.AudioContext = Context;
  try {
    const audio = createRaceAudio(); audio.activate();
    const ctx = Context.instances.at(-1);
    audio.update('running', 0, 0, 1, false);
    audio.setEnabled(false);
    audio.update('running', 0, 0, 1, false);
    assert.equal(ctx.gains[1].gain.value, 0);
    assert.ok(ctx.gains[2].gain.value > 0);
    audio.setMusicEnabled(false); audio.setEnabled(true);
    audio.update('running', 0, 0, 1, false);
    assert.ok(ctx.gains[1].gain.value > 0);
    assert.equal(ctx.gains[2].gain.value, 0);
    audio.pause();
    assert.equal(ctx.gains[1].gain.value, 0);
    assert.equal(ctx.gains[2].gain.value, 0);
    audio.update('paused', 0, 0, 1, false);
    assert.equal(ctx.oscillators[0].connections[0].connections[0].gain.value, 0);
    audio.dispose();
  } finally { globalThis.AudioContext = original; }
});

test('missing or blocked Web Audio cannot prevent a race', () => {
  const original = globalThis.AudioContext;
  delete globalThis.AudioContext;
  const audio = createRaceAudio();
  assert.doesNotThrow(() => { audio.activate(); audio.update('running', 2, 1, 1, false); audio.play('impact'); audio.pause(); audio.dispose(); });
  globalThis.AudioContext = class { constructor() { throw new Error('Audio unavailable'); } };
  const unavailable = createRaceAudio();
  assert.doesNotThrow(() => { unavailable.activate(); unavailable.update('running', 0, 0, 1, false); unavailable.dispose(); });
  globalThis.AudioContext = original;
});

test('altitude warning repeats gently, cancels immediately on match, and obeys pause/mute', () => {
  const original = globalThis.AudioContext;
  globalThis.AudioContext = Context;
  try {
    const audio = createRaceAudio(); audio.activate();
    const ctx = Context.instances.at(-1);
    audio.update('running', 0, 0, 1, false);
    let count = ctx.oscillators.length;
    audio.setAltitudeWarning('down');
    const warning = ctx.oscillators.at(-1);
    assert.equal(warning.frequency.values[0], 330);
    assert.equal(ctx.oscillators.length, count + 2);
    ctx.currentTime = .3; audio.setAltitudeWarning('down');
    assert.equal(ctx.oscillators.length, count + 2);
    ctx.currentTime = .9; audio.setAltitudeWarning('down');
    assert.equal(ctx.oscillators.length, count + 4);
    const repeated = ctx.oscillators.at(-1);
    audio.setAltitudeWarning(null);
    assert.equal(repeated.connections.length, 0);
    assert.equal(repeated.stops.at(-1), 0);
    ctx.currentTime = 1.3; audio.setAltitudeWarning('down'); const resumed = ctx.oscillators.at(-1);
    audio.pause(); assert.equal(resumed.connections.length, 0);
    count = ctx.oscillators.length;
    audio.setAltitudeWarning('down'); assert.equal(ctx.oscillators.length, count);
    audio.update('running', 0, 0, 1, false); audio.setEnabled(false);
    audio.setAltitudeWarning('down'); assert.equal(ctx.oscillators.length, count);
    audio.dispose();
  } finally { globalThis.AudioContext = original; }
});

test('boost notifications and thunder schedule finite voices and respect effects mute', () => {
  const original = globalThis.AudioContext;
  globalThis.AudioContext = Context;
  try {
    const audio = createRaceAudio(); audio.activate();
    const ctx = Context.instances.at(-1);
    audio.update('running', 0, 0, 1, false);
    let count = ctx.oscillators.length;
    audio.play('boost-full'); assert.equal(ctx.oscillators.length, count + 3);
    audio.play('boost-complete'); assert.equal(ctx.oscillators.length, count + 3, 'notifications are serialized');
    ctx.currentTime = .7; audio.update('running', 0, 0, 1, false);
    assert.equal(ctx.oscillators.length, count + 9);
    const sources = ctx.sources.length;
    audio.play('thunder'); assert.equal(ctx.sources.length, sources + 2);
    assert.equal(ctx.oscillators.at(-1).frequency.values[0], 48);
    count = ctx.oscillators.length;
    audio.setEnabled(false);
    for (const cue of ['boost-full', 'boost-complete', 'thunder']) audio.play(cue);
    assert.equal(ctx.oscillators.length, count);
    audio.dispose();
  } finally { globalThis.AudioContext = original; }
});


test('warnings duck engine/weather, use distinct directions, and defer boost chimes', () => {
  const original = globalThis.AudioContext; globalThis.AudioContext = Context;
  try {
    const audio = createRaceAudio(); audio.activate(); const ctx = Context.instances.at(-1);
    audio.update('running', 0, 0, 1, false);
    const engineBus = ctx.oscillators[0].connections[0].connections[0].connections[0];
    assert.equal(engineBus.gain.value, 1);
    audio.setAltitudeWarning('up');
    const up = ctx.oscillators.slice(-2);
    assert.deepEqual(up.map(n => n.frequency.values[0]), [660, 990]);
    assert.ok(up.every(n => n.type === 'triangle'));
    assert.equal(engineBus.gain.value, .28);
    let count = ctx.oscillators.length;
    audio.play('boost-full'); assert.equal(ctx.oscillators.length, count);
    ctx.currentTime = .4; audio.setAltitudeWarning('down');
    assert.ok(up.every(n => n.connections.length === 0));
    assert.deepEqual(ctx.oscillators.slice(-2).map(n => n.frequency.values[0]), [440, 330]);
    assert.ok(ctx.oscillators.slice(-2).every(n => n.type === 'sine'));
    ctx.currentTime = .8; audio.setAltitudeWarning(null);
    assert.equal(ctx.oscillators.at(-3).frequency.values[0], 1568, 'queued recharge plays once warning stops');
    ctx.currentTime = 1.6; audio.update('running', 0, 0, 1, false);
    assert.equal(engineBus.gain.value, 1, 'background returns to normal');
    audio.setAltitudeWarning('up'); audio.play('electric-impact');
    assert.equal(ctx.oscillators.at(-1).type, 'sawtooth');
    count = ctx.oscillators.length; audio.setAltitudeWarning('up');
    assert.equal(ctx.oscillators.length, count, 'impact has a short protected interval');
    audio.pause(); assert.equal(engineBus.gain.value, 1);
    audio.dispose();
  } finally { globalThis.AudioContext = original; }
});


test('offtrack and electric impacts keep the engine alive and foreground their distinct voices', () => {
  const original = globalThis.AudioContext; globalThis.AudioContext = Context;
  try {
    const audio = createRaceAudio(); audio.activate(); const ctx = Context.instances.at(-1);
    audio.update('running',0,0,1,false);
    const engine = ctx.oscillators.slice(0,3);
    let before=ctx.oscillators.length; audio.play('off-track');
    const departure=ctx.oscillators.slice(before);
    assert.deepEqual(departure.map(n=>n.frequency.values[0]),[520,72]);
    assert.deepEqual(departure.map(n=>n.type),['triangle','sine']);
    ctx.currentTime=1; before=ctx.oscillators.length; audio.play('electric-impact');
    assert.equal(ctx.oscillators.slice(before).filter(n=>n.type==='sawtooth').length,4);
    assert.ok(engine.every(n=>n.connections.length>0));
    audio.setEnabled(false); before=ctx.oscillators.length; audio.play('off-track');
    assert.equal(ctx.oscillators.length,before); audio.dispose();
  } finally { globalThis.AudioContext=original; }
});
