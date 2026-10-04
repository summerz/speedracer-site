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
