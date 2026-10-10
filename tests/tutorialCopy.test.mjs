import test from 'node:test';
import assert from 'node:assert/strict';
import { tutorialCopy } from '../output/test/game/driving/tutorialCopy.js';

const steps = ['throttle', 'steer', 'altitude', 'boost', 'brake', 'hazard', 'near-miss'];
test('every step and device has copy and at least one check', () => {
  for (const step of steps) for (const device of ['touch', 'keys']) {
    const c = tutorialCopy(step, device);
    assert.ok(c.name && c.title && c.body, `${step}/${device}`);
    assert.ok(Object.keys(c.checks).length >= 1, `${step}/${device} checks`);
    assert.ok(Array.isArray(c.targets));
  }
});
