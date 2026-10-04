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
  gains = []; oscillators = []; sources = [];
  constructor() { Context.instances.push(this); }
  createGain() { const node = new Node(); this.gains.push(node); return node; }
  createOscillator() { const node = new Node(); this.oscillators.push(node); return node; }
  createBufferSource() { const node = new Node(); this.sources.push(node); return node; }
  createBiquadFilter() { return new Node(); }
  createDynamicsCompressor() { return new Node(); }
  createDelay() { return new Node(); }
  createBuffer(_, frames) { return { getChannelData: () => new Float32Array(frames) }; }
  resume() { this.state = 'running'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
}

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
