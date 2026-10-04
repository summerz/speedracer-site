import test from 'node:test';
import assert from 'node:assert/strict';
import { applyWaitingUpdate } from '../output/test/platform/appUpdate.js';

const fixture = () => {
  const container = new EventTarget(); container.controller = {};
  let sent = 0, reloads = 0;
  const waiting = { postMessage(message) { assert.equal(message.type, 'APPLY_UPDATE'); sent++; } };
  return { container, waiting, registration: { waiting }, reload: () => reloads++, get sent() { return sent; }, get reloads() { return reloads; } };
};
test('explicit update waits for the intended controller, then reloads exactly once', async () => {
  const f = fixture(); const done = applyWaitingUpdate(f.registration, f.container, f.reload, 200);
  assert.equal(f.sent, 1); assert.equal(f.reloads, 0);
  f.container.dispatchEvent(new Event('controllerchange')); assert.equal(f.reloads, 0);
  f.container.controller = f.waiting; f.container.dispatchEvent(new Event('controllerchange'));
  assert.equal(await done, true); assert.equal(f.reloads, 1);
  f.container.dispatchEvent(new Event('controllerchange')); assert.equal(f.reloads, 1);
});
test('activation failure leaves current page running and permits retry', async () => {
  const f = fixture(); await assert.rejects(applyWaitingUpdate(f.registration, f.container, f.reload, 5));
  assert.equal(f.reloads, 0);
  const retry = applyWaitingUpdate(f.registration, f.container, f.reload, 200);
  f.container.controller = f.waiting; f.container.dispatchEvent(new Event('controllerchange'));
  assert.equal(await retry, true); assert.equal(f.reloads, 1);
});
test('no waiting version only checks for updates, without reloading', async () => {
  const f = fixture(); let checks = 0;
  assert.equal(await applyWaitingUpdate({ waiting:null, update:async () => { checks++; } }, f.container, f.reload), false);
  assert.equal(checks, 1); assert.equal(f.reloads, 0); assert.equal(f.sent, 0);
});
