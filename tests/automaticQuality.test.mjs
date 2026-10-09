import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutomaticQuality, createQualityPreferenceStore } from '../output/test/platform/automaticQuality.js';

const nextReport = (quality, frameMs) => {
  for (let i = 0; i < 10000; i++) {
    const report = quality.sample(frameMs);
    if (report) return report;
  }
  throw new Error('No frame report');
};

test('first active seconds choose high, balanced or low from real frame intervals', () => {
  for (const [frameMs, expected] of [[1000 / 60, 'high'], [1000 / 45, 'balanced'], [1000 / 30, 'low']]) {
    const quality = createAutomaticQuality();
    assert.equal(quality.snapshot().preference, 'auto');
    assert.equal(quality.snapshot().phase, 'warming');
    for (let i = 0; i < 30; i++) assert.equal(quality.sample(frameMs), null);
    const report = nextReport(quality, frameMs);
    assert.equal(report.quality, expected);
    assert.equal(report.phase, 'monitoring');
    assert.equal(report.reason, 'startup');
    assert.equal(report.metrics.measuredQuality, 'high');
    assert.ok(Math.abs(report.metrics.averageMs - frameMs) < 1e-8);
    assert.ok(Math.abs(report.metrics.fps - 1000 / frameMs) < 1e-8);
  }
});

test('p95 catches recurring expensive frames even with an acceptable average', () => {
  const quality = createAutomaticQuality();
  let report;
  for (let i = 0; i < 1000 && !report; i++) report = quality.sample(i % 10 === 0 ? 45 : 14);
  assert.ok(report.metrics.averageMs < 19);
  assert.equal(report.metrics.p95Ms, 45);
  assert.equal(report.quality, 'low');
});

test('sustained slowdown lowers one level at a time and never automatically bounces upward', () => {
  const quality = createAutomaticQuality();
  const changes = [];
  quality.onChange(status => changes.push(status.quality));
  nextReport(quality, 1000 / 60);
  // Startup cooldown and two complete slow windows are required.
  for (let i = 0; i < 3; i++) nextReport(quality, 40);
  assert.equal(quality.snapshot().quality, 'high');
  nextReport(quality, 40);
  assert.equal(quality.snapshot().quality, 'balanced');
  assert.equal(quality.snapshot().reason, 'sustained');
  for (let i = 0; i < 4; i++) nextReport(quality, 40);
  assert.equal(quality.snapshot().quality, 'low');
  for (let i = 0; i < 8; i++) nextReport(quality, 10);
  assert.deepEqual(changes, ['high', 'balanced', 'low']);
});

test('isolated slow windows do not lower quality after the cooldown', () => {
  const quality = createAutomaticQuality();
  nextReport(quality, 16);
  for (let i = 0; i < 3; i++) nextReport(quality, 16);
  for (let i = 0; i < 5; i++) {
    nextReport(quality, 40);
    nextReport(quality, 16);
  }
  assert.equal(quality.snapshot().quality, 'high');
});

test('pause, hidden-tab gaps and invalid frames discard partial measurements', () => {
  for (const gap of [q => q.sample(16, false), q => q.sample(1500), q => q.sample(NaN), q => q.sample(0)]) {
    const quality = createAutomaticQuality();
    for (let i = 0; i < 190; i++) quality.sample(16);
    gap(quality);
    assert.equal(quality.snapshot().phase, 'warming');
    for (let i = 0; i < 190; i++) assert.equal(quality.sample(16), null);
    const report = nextReport(quality, 16);
    assert.equal(report.quality, 'high');
    assert.equal(report.metrics.p95Ms, 16);
  }
});

test('manual preference is stable under poor performance and auto can be re-enabled', () => {
  const quality = createAutomaticQuality('high');
  const changes = [];
  const unsubscribe = quality.onChange(status => changes.push(status));
  for (let i = 0; i < 8; i++) nextReport(quality, 100);
  assert.equal(quality.snapshot().quality, 'high');
  assert.equal(quality.snapshot().phase, 'manual');
  assert.equal(changes.length, 1);
  quality.setPreference('balanced');
  assert.equal(changes.at(-1).reason, 'manual');
  quality.setPreference('auto');
  nextReport(quality, 100);
  assert.equal(quality.snapshot().quality, 'low');
  assert.equal(changes.at(-1).reason, 'startup');
  const count = changes.length;
  unsubscribe(); quality.setPreference('high');
  assert.equal(changes.length, count);
});

test('bounded measurements and copied snapshots cannot be changed by subscribers', () => {
  const quality = createAutomaticQuality();
  quality.onChange(status => { status.quality = 'low'; if (status.metrics) status.metrics.fps = 0; });
  const seen = [];
  quality.onChange(status => seen.push(status.quality));
  const report = nextReport(quality, 2);
  assert.equal(report.metrics.samples, 1000);
  report.metrics.fps = 0;
  assert.equal(quality.snapshot().metrics.fps, 500);
  quality.setPreference('balanced');
  assert.deepEqual(seen, ['high', 'balanced']);
});

test('preference defaults to auto and survives reload or denied storage', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const store = createQualityPreferenceStore(storage);
  assert.equal(store.read(), 'auto');
  store.save('balanced');
  assert.equal(createQualityPreferenceStore(storage).read(), 'balanced');
  store.save('auto');
  assert.equal(createQualityPreferenceStore(storage).read(), 'auto');
  storage.setItem('speedracer:quality', 'unknown');
  assert.equal(createQualityPreferenceStore(storage).read(), 'auto');
  const denied = createQualityPreferenceStore({ getItem() { throw Error('Denied'); }, setItem() { throw Error('Denied'); } });
  assert.equal(denied.read(), 'auto');
  denied.save('low');
  assert.equal(denied.read(), 'low');
});
