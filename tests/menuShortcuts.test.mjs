import test from 'node:test';
import assert from 'node:assert/strict';
import { menuShortcut } from '../output/test/platform/menuShortcuts.js';

const ctx = (screen, extra = {}) => ({ screen, dev: true, difficultyVisible: false, ...extra });

test('digits navigate menu screens, skipping the current one and the race', () => {
  assert.deepEqual(menuShortcut('Digit2', ctx('hangar')), { kind: 'go', hash: 'campaign' });
  assert.deepEqual(menuShortcut('Digit3', ctx('campaign')), { kind: 'go', hash: 'shop' });
  assert.deepEqual(menuShortcut('Digit1', ctx('shop')), { kind: 'go', hash: '' });
  assert.equal(menuShortcut('Digit2', ctx('campaign')), null);
  assert.equal(menuShortcut('Digit1', ctx('hangar')), null);
  assert.equal(menuShortcut('Digit2', ctx('drive')), null);
});

test('Digit4 opens sound lab only in dev and not from itself', () => {
  assert.deepEqual(menuShortcut('Digit4', ctx('hangar')), { kind: 'go', hash: 'sound-lab' });
  assert.equal(menuShortcut('Digit4', ctx('hangar', { dev: false })), null);
  assert.equal(menuShortcut('Digit4', ctx('sound-lab')), null);
});

test('KeyM toggles music everywhere, including the race', () => {
  for (const screen of ['hangar', 'campaign', 'shop', 'sound-lab', 'drive']) assert.deepEqual(menuShortcut('KeyM', ctx(screen)), { kind: 'music' });
});

test('campaign T/R pick the mode only on campaign', () => {
  assert.deepEqual(menuShortcut('KeyT', ctx('campaign')), { kind: 'mode', mode: 'time-attack' });
  assert.deepEqual(menuShortcut('KeyR', ctx('campaign')), { kind: 'mode', mode: 'competition' });
  assert.equal(menuShortcut('KeyT', ctx('hangar')), null);
  assert.equal(menuShortcut('KeyR', ctx('drive')), null);
});

test('visible difficulty group: E/M/D choose it and M no longer toggles music', () => {
  const c = ctx('campaign', { difficultyVisible: true });
  assert.deepEqual(menuShortcut('KeyE', c), { kind: 'challenge', challenge: 'easy' });
  assert.deepEqual(menuShortcut('KeyM', c), { kind: 'challenge', challenge: 'normal' });
  assert.deepEqual(menuShortcut('KeyD', c), { kind: 'challenge', challenge: 'hard' });
  assert.deepEqual(menuShortcut('KeyM', ctx('campaign')), { kind: 'music' });
  assert.equal(menuShortcut('KeyE', ctx('campaign')), null);
  assert.equal(menuShortcut('KeyD', ctx('hangar', { difficultyVisible: true })), null);
});
