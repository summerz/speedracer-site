import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnalytics, createRaceAnalytics } from '../output/test/platform/analytics.js';

function fixture(overrides = {}) {
  const events = [], permissions = [];
  let loads = 0;
  const analytics = createAnalytics({ enabled: true, measurementId: 'G-TEST123', version: 'test-version',
    origin: 'https://speedracer.summerz.net', consent: null, standalone: false,
    transport: () => { loads++; return { send: (event, params) => events.push({ event, params }), setAllowed: value => permissions.push(value) }; }, ...overrides });
  return { analytics, events, permissions, loads: () => loads };
}
test('no tag load or backlog before consent; granting measures only the current screen', () => {
  const f = fixture();
  f.analytics.screen('hangar'); f.analytics.screen('campaign'); f.analytics.send('level_start', { level_name: 'old' });
  assert.equal(f.loads(), 0); assert.equal(f.events.length, 0);
  f.analytics.setConsent(true);
  assert.equal(f.loads(), 1); assert.equal(f.events.length, 1);
  assert.deepEqual(f.events[0], { event: 'page_view', params: { page_title: 'Speedracer / campaign',
    page_location: 'https://speedracer.summerz.net/#campaign', screen_name: 'campaign', app_version: 'test-version', app_mode: 'browser' } });
  f.analytics.screen('campaign'); f.analytics.setConsent(true);
  assert.equal(f.events.length, 1);
});
test('disabled environment, missing or invalid ID never loads, including after consent', () => {
  for (const overrides of [{ enabled: false }, { measurementId: '' }, { measurementId: 'not-ga' }]) {
    const f = fixture(overrides); f.analytics.setConsent(true); f.analytics.screen('race'); f.analytics.send('level_start', {});
    assert.equal(f.analytics.available, false); assert.equal(f.loads(), 0);
  }
});
test('withdrawal stops events and reinstating consent does not replay missed events', () => {
  const f = fixture({ consent: true, standalone: true });
  f.analytics.screen('hangar'); f.analytics.setConsent(false); f.analytics.screen('shop'); f.analytics.send('level_start', {});
  assert.equal(f.events.length, 1); assert.deepEqual(f.permissions, [false]);
  f.analytics.setConsent(true);
  assert.equal(f.loads(), 1); assert.equal(f.events.length, 2); assert.equal(f.events[1].params.screen_name, 'shop');
  assert.equal(f.events[1].params.app_mode, 'installed'); assert.deepEqual(f.permissions, [false, true]);
});
test('transport failures never interrupt screens, consent or gameplay events', () => {
  for (const transport of [() => { throw Error('blocked'); }, () => ({ send() { throw Error('offline'); }, setAllowed() { throw Error('blocked'); } })]) {
    const { analytics } = fixture({ consent: true, transport });
    assert.doesNotThrow(() => { analytics.screen('race'); analytics.send('level_start', {}); analytics.setConsent(false); analytics.setConsent(true); });
  }
});

const context = { track_id: 'window-run', race_mode: 'time-attack', difficulty: 'normal', ship_id: 'halo', control_type: 'touch' };
const state = (changes = {}) => ({ id: 'one', phase: 'running', seconds: 12, laps: 0, collisions: 0, exits: 0,
  obstacles: 3, success: false, disqualified: false, rank: 1, stars: 0, ...changes });
function raceFixture() {
  const events = [];
  return { events, race: createRaceAnalytics((event, params) => events.push({ event, params })) };
}
test('ready is not a start; countdown, pauses and resumes belong to the same attempt', () => {
  const { events, race } = raceFixture();
  race.observe(state({ phase: 'ready', id: '' }), context); race.quit('navigation'); assert.equal(events.length, 0);
  for (const phase of ['countdown', 'running', 'paused', 'running']) race.observe(state({ phase }), context);
  assert.equal(events.length, 1); assert.equal(events[0].event, 'level_start'); assert.equal(events[0].params.is_retry, false);
  assert.equal('id' in events[0].params, false);
});
test('finish emits a single summary, regardless of repeated result snapshots and disposal', () => {
  const { events, race } = raceFixture(); race.observe(state(), context);
  const result = state({ phase: 'finished', seconds: 93.876, laps: 3, collisions: 4, exits: 2, obstacles: 17, success: true, stars: 2 });
  race.observe(result, context); race.observe(result, context); race.quit('navigation'); race.quit('page_exit');
  assert.deepEqual(events.map(e => e.event), ['level_start', 'level_end']);
  assert.equal(events[1].params.elapsed_seconds, 93.88); assert.equal(events[1].params.collisions, 4);
  assert.equal(events[1].params.off_track_exits, 2); assert.equal(events[1].params.stars, 2);
  assert.equal(events[1].params.success, true); assert.equal(events[1].params.result, 'passed');
});
test('disqualification and rank failure are distinguished from quitting', () => {
  for (const [changes, expected] of [[{ disqualified: true }, 'time_limit'], [{ rank: 6 }, 'rank_cutoff']]) {
    const { events, race } = raceFixture(); race.observe(state(), context);
    race.observe(state({ phase: 'finished', ...changes }), context);
    assert.equal(events[1].event, 'level_end'); assert.equal(events[1].params.result, expected); assert.equal(events[1].params.success, false);
  }
});
test('restart closes the previous attempt with latest summary and marks the new one as retry', () => {
  const { events, race } = raceFixture(); race.observe(state(), context);
  race.observe(state({ phase: 'paused', seconds: 21, collisions: 2 }), context);
  race.observe(state({ id: 'two', phase: 'countdown', seconds: 0 }), { ...context, ship_id: 'hammerhead' });
  assert.deepEqual(events.map(e => e.event), ['level_start', 'race_quit', 'level_start']);
  assert.equal(events[1].params.quit_reason, 'restart'); assert.equal(events[1].params.elapsed_seconds, 21);
  assert.equal(events[1].params.ship_id, 'halo'); assert.equal(events[2].params.ship_id, 'hammerhead'); assert.equal(events[2].params.is_retry, true);
});
test('quit is emitted once; no failure in analytics can break observation', () => {
  const { events, race } = raceFixture(); race.observe(state(), context); race.quit('page_exit'); race.quit('navigation');
  assert.equal(events.length, 2); assert.equal(events[1].params.quit_reason, 'page_exit');
  const broken = createRaceAnalytics(() => { throw Error('blocked'); });
  assert.doesNotThrow(() => { broken.observe(state(), context); broken.quit('navigation'); });
});
