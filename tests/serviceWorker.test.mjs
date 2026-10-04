import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';

// Run the real worker against a small release, including the partial-deploy failure path.
const source = readFileSync(new URL('../scripts/service-worker.js', import.meta.url), 'utf8');
const fixture = (broken = false) => {
  const payloads = { '/index.html': 'release B', '/assets/game.js': 'game B' };
  const SHELL = { version: '0.2.0', generation: 'B', assets: Object.entries(payloads).map(([url, value]) => ({ url, sha256: createHash('sha256').update(value).digest('hex') })) };
  const handlers = {}, stores = new Map([['speedracer-shell-A', new Map([['/index.html', new Response('release A')]])]]);
  let activated = 0;
  const caches = {
    async open(name) { if (!stores.has(name)) stores.set(name, new Map()); const store = stores.get(name); return { put: async (key, response) => store.set(key, response), match: async key => store.get(typeof key === 'string' ? key : new URL(key.url).pathname)?.clone() }; },
    async delete(name) { return stores.delete(name); },
    async keys() { return [...stores.keys()]; },
  };
  runInNewContext(source, { SHELL, URL, Uint8Array, crypto: webcrypto, caches,
    fetch: async url => new Response(broken && url === '/assets/game.js' ? 'wrong generation' : payloads[url]),
    self: { location: { origin: 'https://example.test' }, addEventListener: (name, handler) => { handlers[name] = handler; }, skipWaiting: async () => { activated++; } },
  });
  const install = () => { let pending; handlers.install({ waitUntil: promise => { pending = promise; } }); return pending; };
  return { handlers, stores, install, get activated() { return activated; } };
};
test('a mismatched asset rejects the new shell and preserves the current offline release', async () => {
  const f = fixture(true);
  await assert.rejects(f.install(), /Incomplete app shell/);
  assert.equal(f.stores.has('speedracer-shell-B'), false);
  assert.equal(await f.stores.get('speedracer-shell-A').get('/index.html').text(), 'release A');
  assert.equal(f.activated, 0);
});
test('a complete release stays waiting until explicit apply and serves its own navigation shell', async () => {
  const f = fixture(); await f.install(); assert.equal(f.activated, 0);
  let navigation;
  f.handlers.fetch({ request: { url:'https://example.test/#drive', method:'GET', mode:'navigate' }, respondWith: response => { navigation = response; } });
  assert.equal(await (await navigation).text(), 'release B');
  let activation;
  f.handlers.message({ data: { type:'APPLY_UPDATE' }, waitUntil: promise => { activation = promise; } });
  await activation; assert.equal(f.activated, 1);
});
