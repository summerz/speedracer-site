import test from 'node:test';
import assert from 'node:assert/strict';
import { applyWaitingUpdate, applyAvailableUpdate, readAppUpdate } from '../output/test/platform/appUpdate.js';

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

const versionedWorker = version => ({
  postMessage(message, ports) {
    assert.equal(message.type, 'GET_UPDATE_INFO');
    ports[0].postMessage({ version });
  },
});

test('resumed old page offers an update even when the new worker is already active', async () => {
  const active = versionedWorker('0.16.6');
  const registration = { waiting: null, installing: null, active };
  assert.deepEqual(await readAppUpdate(registration, '0.16.5'), { kind: 'reload', version: '0.16.6' });
  let reloads = 0;
  assert.equal(await applyAvailableUpdate(registration, {}, '0.16.5', () => reloads++), true);
  assert.equal(reloads, 1);
});

test('a current page or older active worker never prompts or reloads', async () => {
  for (const version of ['0.16.6', '0.16.5', '0.9.99', 'unknown']) {
    const registration = { active: versionedWorker(version) };
    assert.deepEqual(await readAppUpdate(registration, '0.16.6'), { kind: 'current', version: null });
    assert.equal(await applyAvailableUpdate(registration, {}, '0.16.6', () => assert.fail('unexpected reload')), false);
  }
});

test('version ordering compares numeric components rather than text', async () => {
  assert.deepEqual(await readAppUpdate({ active: versionedWorker('0.16.10') }, '0.16.9'), { kind: 'reload', version: '0.16.10' });
});

test('downloading and fully prepared updates are distinguished', async () => {
  const worker = versionedWorker('0.16.7');
  const registration = { installing: worker, active: versionedWorker('0.16.6') };
  assert.deepEqual(await readAppUpdate(registration, '0.16.6'), { kind: 'preparing', version: '0.16.7' });
  registration.waiting = worker; registration.installing = null;
  assert.deepEqual(await readAppUpdate(registration, '0.16.6'), { kind: 'ready', version: '0.16.7' });
});

test('worker becoming active while its version is queried still offers a reload', async () => {
  const registration = {};
  const worker = {
    postMessage(message, ports) {
      registration.active = worker; registration.installing = null;
      ports[0].postMessage({ version: '0.16.7' });
    },
  };
  registration.installing = worker;
  assert.deepEqual(await readAppUpdate(registration, '0.16.6'), { kind: 'reload', version: '0.16.7' });
});

test('a failed or superseded install cannot become an available update', async () => {
  const registration = {};
  const worker = {
    postMessage(message, ports) {
      registration.installing = null;
      ports[0].postMessage({ version: '0.16.7' });
    },
  };
  registration.installing = worker;
  assert.deepEqual(await readAppUpdate(registration, '0.16.6'), { kind: 'current', version: null });
});
