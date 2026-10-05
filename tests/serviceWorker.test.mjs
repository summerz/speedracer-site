import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';

// Run the real worker against a small release, including the partial-deploy failure path.
const source = readFileSync(new URL('../scripts/service-worker.js', import.meta.url), 'utf8');
const fixture = (options = {}) => {
  if (typeof options === 'boolean') options = { broken: options };
  const payloads = { '/index.html': 'release B', '/assets/game.js': 'game B', ...options.payloads };
  const SHELL = { version: '0.2.0', generation: options.generation ?? 'B', assets: Object.entries(payloads).map(([url, value]) => ({ url, sha256: createHash('sha256').update(value).digest('hex') })) };
  const handlers = {}, stores = new Map([['speedracer-shell-A', new Map(Object.entries(options.previous ?? { '/index.html': 'release A' }).map(([url, value]) => [url, new Response(value)]))]]);
  const requests = [];
  let activated = 0;
  const caches = {
    async open(name) { if (!stores.has(name)) stores.set(name, new Map()); const store = stores.get(name); return { put: async (key, response) => store.set(key, response), match: async key => store.get(typeof key === 'string' ? key : new URL(key.url).pathname)?.clone() }; },
    async delete(name) { return stores.delete(name); },
    async keys() { return [...stores.keys()]; },
  };
  runInNewContext(source, { SHELL, URL, Uint8Array, Response, Headers, crypto: webcrypto, caches,
    fetch: async url => {
      requests.push(url);
      if (options.offline) throw new Error('offline');
      return new Response(options.broken && url === '/assets/game.js' ? 'wrong generation' : payloads[url]);
    },
    self: { location: { origin: 'https://example.test' }, addEventListener: (name, handler) => { handlers[name] = handler; }, skipWaiting: async () => { activated++; } },
  });
  const install = () => { let pending; handlers.install({ waitUntil: promise => { pending = promise; } }); return pending; };
  return { handlers, stores, requests, install, get activated() { return activated; } };
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

test('an update reuses unchanged resources and downloads only changed or new contents', async () => {
  const f = fixture({
    previous: { '/index.html': 'release A', '/assets/game.js': 'game B', '/audio/impact.mp3': 'sound unchanged', '/track.json': 'old track' },
    payloads: { '/audio/impact.mp3': 'sound unchanged', '/track.json': 'new track', '/audio/new.mp3': 'new sound' },
  });
  await f.install();
  assert.deepEqual(f.requests, ['/index.html', '/track.json', '/audio/new.mp3']);
  assert.equal(await f.stores.get('speedracer-shell-B').get('/audio/impact.mp3').text(), 'sound unchanged');
  assert.equal(await f.stores.get('speedracer-shell-A').get('/track.json').text(), 'old track');
});

test('a corrupted cached resource is fetched and verified rather than reused', async () => {
  const f = fixture({ previous: { '/index.html': 'release B', '/assets/game.js': 'corrupt bytes' } });
  await f.install();
  assert.deepEqual(f.requests, ['/assets/game.js']);
  assert.equal(await f.stores.get('speedracer-shell-B').get('/assets/game.js').text(), 'game B');
});

test('a worker-only upgrade can reuse the same generation entirely offline', async () => {
  const f = fixture({ generation: 'A', offline: true, previous: { '/index.html': 'release B', '/assets/game.js': 'game B' } });
  await f.install(); assert.deepEqual(f.requests, []);
  assert.equal(f.activated, 0);
});

test('a failed worker-only upgrade never deletes the active generation cache', async () => {
  const f = fixture({ generation: 'A', offline: true });
  await assert.rejects(f.install(), /offline/);
  assert.equal(await f.stores.get('speedracer-shell-A').get('/index.html').text(), 'release A');
});

test('cached music serves byte ranges offline without altering the complete resource', async () => {
  const f = fixture({ payloads: { '/music/ost/race.mp3': '0123456789' } });
  await f.install();
  const fetched = f.requests.length;
  const read = async range => {
    let pending;
    f.handlers.fetch({ request: { method:'GET', url:'https://example.test/music/ost/race.mp3', headers:new Headers({Range:range}) }, respondWith:p => {pending=p;} });
    return pending;
  };
  for (const [range, body, contentRange] of [
    ['bytes=2-5','2345','bytes 2-5/10'], ['bytes=7-','789','bytes 7-9/10'],
    ['bytes=-3','789','bytes 7-9/10'], ['bytes=0-99','0123456789','bytes 0-9/10'],
  ]) {
    const r=await read(range); assert.equal(r.status,206); assert.equal(await r.text(),body);
    assert.equal(r.headers.get('Content-Range'),contentRange); assert.equal(Number(r.headers.get('Content-Length')),body.length);
  }
  for (const range of ['bytes=10-','bytes=8-2','bytes=-0']) {
    const r=await read(range); assert.equal(r.status,416); assert.equal(r.headers.get('Content-Range'),'bytes */10');
  }
  assert.equal((await read('bytes=0-1,4-5')).status,200);
  assert.equal(f.requests.length,fetched,'all ranges use local cache');
  assert.equal(await f.stores.get('speedracer-shell-B').get('/music/ost/race.mp3').text(),'0123456789');
});
