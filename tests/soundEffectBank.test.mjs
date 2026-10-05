import test from 'node:test';
import assert from 'node:assert/strict';
import { createSoundEffectBank } from '../output/test/game/audio/soundEffectBank.js';

test('prefetch shares bytes across restarts and decodes a fresh copy for each audio context', async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async url => { requests.push(url); return new Response(new Uint8Array([1, 2, 3])); };
  const files = { impact: { url: '/test-shared.mp3', level: .6 } };
  const copies = [];
  const context = { state: 'running', decodeAudioData: async bytes => {
    copies.push(bytes); const marker = new Uint8Array(bytes)[0];
    structuredClone(bytes, { transfer: [bytes] });
    return { duration: .5, marker };
  } };
  try {
    const first = createSoundEffectBank(files);
    assert.deepEqual(requests, ['/test-shared.mp3']);
    assert.equal(first.get('impact'), undefined);
    await Promise.all([first.prepare(context), first.prepare(context)]);
    assert.equal(copies.length, 1);
    assert.equal(first.get('impact').buffer.marker, 1);
    first.dispose();
    const second = createSoundEffectBank(files); await second.prepare(context);
    assert.equal(requests.length, 1);
    assert.equal(copies.length, 2);
    assert.notEqual(copies[0], copies[1]);
    assert.equal(second.get('impact').buffer.marker, 1);
    second.dispose();
  } finally { globalThis.fetch = original; }
});

test('failed downloads can retry; a failed cue does not block another sound', async () => {
  const original = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async url => url.endsWith('retry.mp3') && ++attempts === 1
    ? new Response('', { status: 503 }) : new Response(new Uint8Array([7]));
  const context = { state: 'running', decodeAudioData: async () => ({ duration: .9 }) };
  try {
    const bank = createSoundEffectBank({
      impact: { url: '/test-retry.mp3', level: .6 },
      'off-track': { url: '/test-independent.mp3', level: .5 },
    });
    await bank.prepare(context);
    assert.equal(bank.get('impact'), undefined);
    assert.equal(bank.get('off-track').buffer.duration, .9);
    await bank.prepare(context);
    assert.equal(attempts, 2);
    assert.ok(bank.get('impact'));
    bank.dispose();
  } finally { globalThis.fetch = original; }
});

test('decoder failure remains optional and can retry on later activation', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(new Uint8Array([9]));
  let attempts = 0;
  const context = { state: 'running', decodeAudioData: async () => {
    if (++attempts === 1) throw new Error('Unsupported data');
    return { duration: .4 };
  } };
  try {
    const bank = createSoundEffectBank({ impact: { url: '/test-decode.mp3', level: .6 } });
    await bank.prepare(context); assert.equal(bank.get('impact'), undefined);
    await bank.prepare(context); assert.ok(bank.get('impact'));
    bank.dispose();
  } finally { globalThis.fetch = original; }
});

test('late decoding after leaving the race cannot retain or expose a sound', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(new Uint8Array([4]));
  let finish;
  const context = { state: 'running', decodeAudioData: () => new Promise(resolve => { finish = resolve; }) };
  try {
    const bank = createSoundEffectBank({ impact: { url: '/test-dispose.mp3', level: .6 } });
    const preparing = bank.prepare(context);
    await new Promise(resolve => setImmediate(resolve));
    bank.dispose(); context.state = 'closed'; finish({ duration: .5 });
    await preparing;
    assert.equal(bank.get('impact'), undefined);
    await bank.prepare(context);
  } finally { globalThis.fetch = original; }
});
