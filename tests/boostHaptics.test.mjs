import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoostHaptics } from '../output/test/game/driving/createBoostHaptics.js';

test('boost stages have distinct cues and spaced maintenance pulses', () => {
  const calls = [];
  const haptics = createBoostHaptics(pattern => { calls.push(pattern); return true; });
  haptics.update(0.016, 1, true);
  haptics.update(0.6, 1, true);
  assert.deepEqual(calls, [18]);
  haptics.update(0.11, 1, true);
  haptics.update(0.016, 2, true);
  haptics.update(0.44, 2, true);
  assert.deepEqual(calls, [18, 6, [28, 35, 18]]);
  haptics.update(0.02, 2, true);
  assert.equal(calls.at(-1), 10);
});

test('release, pause, disabling and disposal cancel vibration without repeated calls', () => {
  for (const end of [h => h.update(0.016, 0, true), h => h.update(0.016, 1, false), h => h.setEnabled(false), h => h.dispose()]) {
    const calls = [];
    const haptics = createBoostHaptics(pattern => { calls.push(pattern); return true; });
    haptics.update(0.016, 1, true); end(haptics); end(haptics);
    assert.deepEqual(calls, [18, 0]);
  }
});

test('disabled, unsupported or denied vibration does not affect racing', () => {
  const calls = [];
  const haptics = createBoostHaptics(pattern => { calls.push(pattern); return true; });
  haptics.setEnabled(false); haptics.update(2, 2, true);
  assert.deepEqual(calls, []);
  haptics.setEnabled(true); haptics.update(0.016, 1, true);
  assert.deepEqual(calls, [18]);
  assert.doesNotThrow(() => createBoostHaptics().update(1, 2, true));
  assert.doesNotThrow(() => createBoostHaptics(() => { throw new Error('Denied'); }).update(1, 2, true));
});

test('altitude cue is lighter than boost, respects settings and is cancelled when paused', () => {
  const calls = [];
  const haptics = createBoostHaptics(pattern => { calls.push(pattern); return true; });
  haptics.altitudeStep(); haptics.stop(); haptics.stop();
  assert.deepEqual(calls, [8, 0]);
  haptics.setEnabled(false); haptics.altitudeStep();
  assert.deepEqual(calls, [8, 0]);
  haptics.setEnabled(true); haptics.update(.016, 1, true); haptics.altitudeStep();
  assert.deepEqual(calls.slice(-2), [18, 8]);
  haptics.setEnabled(false);
  assert.equal(calls.at(-1), 0);
  assert.doesNotThrow(() => createBoostHaptics().altitudeStep());
  assert.doesNotThrow(() => createBoostHaptics(() => { throw new Error('Denied'); }).altitudeStep());
});

test('race cues survive non-boosting frames and collision takes priority over near misses', () => {
  const calls = [];
  const haptics = createBoostHaptics(pattern => { calls.push(pattern); return true; });
  haptics.nearMiss(); haptics.update(.016, 0, true);
  assert.deepEqual(calls, [10]);
  haptics.collision(); haptics.nearMiss(); haptics.altitudeStep();
  haptics.update(.016, 2, true);
  assert.deepEqual(calls, [10, [18, 25, 12]]);
  haptics.update(.1, 2, true);
  assert.deepEqual(calls.at(-1), [28, 35, 18]);
});

test('rapid repeated contacts are throttled even without boost and pause cancels race cues', () => {
  const calls = [];
  const haptics = createBoostHaptics(pattern => { calls.push(pattern); return true; });
  haptics.collision(); haptics.collision();
  haptics.update(.2, 0, true); haptics.collision();
  assert.equal(calls.length, 1);
  haptics.update(.2, 0, true); haptics.collision();
  assert.equal(calls.length, 2);
  haptics.update(.016, 0, false); haptics.update(.016, 0, false);
  assert.equal(calls.at(-1), 0);
  assert.equal(calls.length, 3);
  haptics.setEnabled(false); haptics.collision(); haptics.nearMiss();
  assert.equal(calls.length, 3);
  assert.doesNotThrow(() => { const h = createBoostHaptics(); h.collision(); h.nearMiss(); });
  assert.doesNotThrow(() => { const h = createBoostHaptics(() => { throw Error('Denied'); }); h.collision(); h.nearMiss(); });
});
