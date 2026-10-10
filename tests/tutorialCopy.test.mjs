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

test('await prompts exist for every listed check on both devices', async () => {
  const { tutorialPrompt } = await import('../output/test/game/driving/tutorialCopy.js');
  const listed = { steer: ['left', 'right'], altitude: ['up', 'down'], boost: ['on', 'alt-change'], brake: ['on'], hazard: ['pass'] };
  for (const [step, ids] of Object.entries(listed)) for (const id of ids) for (const device of ['touch', 'keys']) {
    const p = tutorialPrompt(step, id, device);
    assert.ok(p && p.title && p.prompt, `${step}/${id}/${device}`);
  }
  assert.equal(tutorialPrompt('throttle', 'auto', 'keys'), null);
});
