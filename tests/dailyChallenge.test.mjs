import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyDateKey, dailyChallengeFor, dailyObstacleRandom, dailySnapshot, dailyGoalCurrent, settleDailyResult, emptyDailyProgress, DAILY_TRACK_IDS, DAILY_CRAFT_IDS, validateDailyProgress } from '../output/test/game/progression/dailyChallenge.js';
import { initialProgress, validateProgress, applyCommand } from '../output/test/game/progression/progress.js';
import { createProgressStore } from '../output/test/game/progression/progressStore.js';
import { createDailyRun } from '../output/test/game/driving/dailyRun.js';
import { createRaceSession, aiDrivingInput } from '../output/test/game/driving/createRaceSession.js';
import { createRaceRecords } from '../output/test/game/driving/raceRecords.js';
import { createTrack } from '../output/test/game/track/createTrack.js';
import { DRONE_CATALOG } from '../output/test/game/drone/droneCatalog.js';
import { trackDefinition } from '../output/test/game/track/trackCatalog.js';
import { challengeLapLimit } from '../output/test/game/track/raceChallenge.js';
import { createCatalogTrack } from '../output/test/game/track/trackRuntime.js';
import { raceEnvironmentsForDistrict } from '../output/test/game/environment/raceEnvironment.js';
const date = '2026-10-11';
const input = (key = date, overrides = {}) => {
  const challenge = dailyChallengeFor(key);
  return { challenge, raceId: `attempt:${key}`, laps: Array(challenge.laps).fill(30), counters: { boost: 3, safePass: 3, drift: 1 }, disqualified: false, recordedAt: `${key}T10:00:00Z`, controlMode: 'keyboard', ...overrides };
};
const settle = (daily, overrides = {}) => settleDailyResult(daily, input(date, overrides));

test('KST midnight is stable across month/year boundaries and rejects invalid dates', () => {
  assert.equal(dailyDateKey(Date.parse('2026-10-10T14:59:59.999Z')), '2026-10-10');
  assert.equal(dailyDateKey(Date.parse('2026-10-10T15:00:00Z')), date);
  assert.equal(dailyDateKey(Date.parse('2026-12-31T15:00:00Z')), '2027-01-01');
  assert.equal(dailyDateKey(Date.parse('2028-02-28T15:00:00Z')), '2028-02-29');
  for (const bad of [NaN, Infinity]) assert.throws(() => dailyDateKey(bad));
  for (const bad of ['2026-02-30', '2026-1-01', 'bad', '2026-13-01']) assert.throws(() => dailyChallengeFor(bad));
});

test('a year of daily choices stays within approved loaners/courses/environments and rotates all three goals', () => {
  const goals = new Set(), tracks = new Set(), craft = new Set(), difficulties = new Set();
  let previous;
  for (let i = 0; i < 366; i++) {
    const key = new Date(Date.parse('2026-01-01') + i * 86400000).toISOString().slice(0, 10);
    const c = dailyChallengeFor(key), track = trackDefinition(c.trackId);
    assert.deepEqual(c, dailyChallengeFor(key)); assert.ok(DAILY_TRACK_IDS.includes(c.trackId)); assert.ok(DAILY_CRAFT_IDS.includes(c.craftId));
    assert.ok(raceEnvironmentsForDistrict(track.district).some(e => e.id === c.environmentId));
    assert.equal(c.trackRevision, track.revision); assert.equal(c.laps, track.laps); assert.equal(c.rewardPoints, 150); assert.equal(c.mode, 'time-attack');
    assert.ok(c.challenge === 'easy' || c.challenge === 'normal'); assert.notEqual(c.goal.id, previous); previous = c.goal.id;
    goals.add(c.goal.id); tracks.add(c.trackId); craft.add(c.craftId); difficulties.add(c.challenge);
  }
  assert.equal(goals.size, 3); assert.equal(tracks.size, 6); assert.equal(craft.size, 5); assert.equal(difficulties.size, 2);
});

test('obstacle streams restart identically, never use global randomness, and differ on different days', () => {
  const a = dailyObstacleRandom(dailyChallengeFor(date)), b = dailyObstacleRandom(dailyChallengeFor(date)), c = dailyObstacleRandom(dailyChallengeFor('2026-10-12'));
  const seq = r => Array.from({ length: 100 }, r), values = seq(a);
  assert.deepEqual(values, seq(b)); assert.notDeepEqual(values, seq(c)); assert.ok(values.every(n => n >= 0 && n < 1));
});

test('all goals require both their target and qualified full-lap completion', () => {
  for (let i = 11; i <= 13; i++) {
    const run = input(`2026-10-${i}`), targetKey = { boost: 'boost', 'safe-pass': 'safePass', drift: 'drift' }[run.challenge.goal.id];
    assert.equal(settleDailyResult(emptyDailyProgress(), run).settlement.awarded, 150);
    for (const change of [{ counters: { ...run.counters, [targetKey]: run.challenge.goal.target - 1 } }, { laps: run.laps.slice(1) }, { disqualified: true }, { laps: Array(run.challenge.laps).fill(challengeLapLimit(trackDefinition(run.challenge.trackId), run.challenge.challenge) + .01) }]) {
      const result = settleDailyResult(emptyDailyProgress(), { ...run, ...change });
      assert.equal(result.settlement.success, false); assert.equal(result.settlement.awarded, 0); assert.deepEqual(result.daily, emptyDailyProgress());
    }
  }
});

test('first success awards 150, retries improve one record, tie/worse/failure cannot replace it', () => {
  const first = settle(emptyDailyProgress()); assert.equal(first.settlement.awarded, 150);
  const retry = settle(first.daily, { raceId: 'retry', laps: Array(input().challenge.laps).fill(25), controlMode: 'touch' });
  assert.equal(retry.settlement.awarded, 0); assert.equal(retry.settlement.isNewBest, true); assert.equal(retry.settlement.best.raceId, 'retry');
  for (const laps of [retry.settlement.best.laps, input().laps]) {
    const result = settle(retry.daily, { raceId: 'worse-or-tie', laps }); assert.equal(result.settlement.isNewBest, false); assert.deepEqual(result.daily, retry.daily);
  }
  const failed = settle(retry.daily, { disqualified: true, laps: Array(input().challenge.laps).fill(10) });
  assert.deepEqual(failed.daily, retry.daily); assert.equal(failed.settlement.rewardClaimed, true);
  assert.equal(first.daily.bests[date].raceId, `attempt:${date}`); // Pure, no mutation.
});

test('30 best-detail days are retained but every date receipt survives pruning and spec replacement', () => {
  let daily = emptyDailyProgress();
  for (let i = 0; i < 35; i++) daily = settleDailyResult(daily, input(new Date(Date.parse('2026-09-01') + i * 86400000).toISOString().slice(0,10))).daily;
  assert.equal(Object.keys(daily.bests).length, 30); assert.equal(Object.keys(daily.receipts).length, 35);
  assert.equal(settleDailyResult(daily, input('2026-09-01')).settlement.awarded, 0);
  const old = settle(emptyDailyProgress()).daily; old.bests[date].challengeId = 'old-rules';
  assert.equal(dailySnapshot({ daily: old }, input().challenge).best, null);
  const replacement = settle(old); assert.equal(replacement.settlement.isNewBest, true); assert.equal(replacement.settlement.awarded, 0);
});

test('old profiles migrate without altering wallet/campaign and daily awards do not write ordinary progress', () => {
  const old = initialProgress(); delete old.daily; const migrated = validateProgress(old);
  assert.deepEqual(migrated.daily, emptyDailyProgress()); assert.equal(migrated.balance, old.balance);
  const changed = applyCommand(migrated, { kind: 'daily-result', input: input() });
  assert.equal(changed.balance, migrated.balance + 150); assert.equal(changed.revision, migrated.revision + 1);
  for (const key of ['campaign', 'owned', 'equipped', 'upgrades', 'focus', 'rivalInventory', 'rewards']) assert.deepEqual(changed[key], migrated[key]);
  assert.equal(applyCommand(changed, { kind: 'daily-result', input: input() }).balance, changed.balance);
});

test('invalid/tampered results and persisted records are rejected before awarding', () => {
  for (const overrides of [{ challenge: { ...input().challenge, rewardPoints: 999 } }, { raceId: '' }, { laps: [NaN] }, { counters: { boost: -1, safePass: 3, drift: 1 } }, { recordedAt: 'bad' }, { controlMode: 'invalid' }]) assert.throws(() => settle(emptyDailyProgress(), overrides));
  assert.throws(() => validateDailyProgress({ bests: {}, receipts: { '2026-02-30': 'x' } }));
  const corrupted = settle(emptyDailyProgress()).daily; corrupted.bests[date].total = 1; assert.throws(() => validateDailyProgress(corrupted));
  const reordered = Object.fromEntries(Object.entries(input().challenge).reverse()); assert.equal(settle(emptyDailyProgress(), { challenge: reordered }).settlement.awarded, 150);
});

test('snapshot counts down to KST midnight and exposes immutable same-spec best/claim data', () => {
  const daily = settle(emptyDailyProgress()).daily, c = input().challenge;
  const snapshot = dailySnapshot({daily}, c, Date.parse('2026-10-11T14:59:59Z'));
  assert.equal(snapshot.nextDayInSeconds, 1); assert.equal(snapshot.rewardClaimed, true); snapshot.best.total = 5;
  assert.notEqual(daily.bests[date].total, 5); assert.equal(dailySnapshot({daily}, c, Date.parse('2026-10-11T15:00:01Z')).nextDayInSeconds, 0);
  assert.equal(dailyGoalCurrent(c, { boost: 3, safePass: 3, drift: 1 }), c.goal.target);
});

test('two stores serialize a single reward; failed commit is retryable without changing wallet', async () => {
  let saved = initialProgress(), chain = Promise.resolve(), fail = false;
  const repository = { read: async () => structuredClone(saved), close() {}, transact(change) {
    const operation = chain.then(() => { if (fail) throw Error('quota'); saved = change(saved); return structuredClone(saved); }); chain = operation.catch(() => {}); return operation;
  }};
  const a = createProgressStore(repository), b = createProgressStore(repository);
  try {
    await Promise.all([a.refresh(), b.refresh()]); const balance = saved.balance; fail = true;
    await assert.rejects(a.settleDaily(input()), /quota/); assert.equal(a.snapshot().balance, balance); assert.deepEqual(saved.daily, emptyDailyProgress()); fail = false;
    const results = await Promise.all([a.settleDaily(input()), b.settleDaily(input(date, { raceId: 'other-tab' }))]);
    assert.equal(results.reduce((sum, r) => sum + r.awarded, 0), 150); assert.equal(saved.balance, balance + 150);
    await b.refresh(); assert.equal(b.snapshot().balance, saved.balance);
  } finally { a.close(); b.close(); }
});

test('drift observation banks unique completed rewards even at full gauge; cancellations/zero stage never count', () => {
  const run = createDailyRun(), state = { drift: { lastReward: null }, boostUses: 2, obstaclesPassed: 4 };
  const observe = reward => { state.drift.lastReward = reward; run.observe(state); };
  observe({ id: 1, stage: 1, earnedCharge: .05, addedCharge: 0, cancelled: false }); run.observe(state);
  observe({ id: 2, stage: 2, earnedCharge: .1, addedCharge: 0, cancelled: true });
  observe({ id: 3, stage: 0, earnedCharge: 0, addedCharge: 0, cancelled: false });
  assert.deepEqual(run.snapshot(state), { boost: 2, safePass: 4, drift: 1 }); run.reset(); assert.equal(run.snapshot(state).drift, 0);
  observe({ id: 1, stage: 3, earnedCharge: .15, addedCharge: .15, cancelled: false }); assert.equal(run.snapshot(state).drift, 1);
});

test('real race lifecycle resets the same obstacle seed on fresh starts and retries and preserves daily counters on pause', () => {
  const c = input().challenge, draws = [], track = createTrack(); track.randomizeObstacles = random => draws.push(Array.from({ length: 10 }, random));
  const records = createRaceRecords({ trackId: c.trackId, configurationId: 'daily' });
  const race = createRaceSession(track, DRONE_CATALOG.find(x => x.configuration.id === c.craftId).configuration, records, 0, 'time-attack', () => { throw Error('unseeded random'); }, 'desktop', { daily: c, laps: c.laps });
  race.start(); race.restart(); assert.deepEqual(draws[0], draws[1]); assert.equal(race.snapshot().daily.challenge.challengeId, c.challengeId);
  race.model.state.boostUses = 3; race.model.state.obstaclesPassed = 4;
  race.pause(); assert.deepEqual(race.snapshot().daily.counters, { boost: 3, safePass: 4, drift: 0 }); race.restart();
  assert.deepEqual(race.snapshot().daily.counters, { boost: 0, safePass: 0, drift: 0 }); assert.deepEqual(draws[0], draws[2]);
});

test('stock daily course completes on desktop and touch with real physics, counters and a single reward', () => {
  const challenge = dailyChallengeFor(date), definition = trackDefinition(challenge.trackId);
  const configuration = DRONE_CATALOG.find(c => c.configuration.id === challenge.craftId).configuration;
  const limit = challengeLapLimit(definition, challenge.challenge);
  let saved = emptyDailyProgress();
  for (const device of ['desktop', 'touch']) {
    const track = createCatalogTrack(definition, challenge.challenge);
    const records = createRaceRecords({ trackId: challenge.trackId, configurationId: 'daily' });
    const race = createRaceSession(track, configuration, records, 0, 'time-attack', () => .5, device,
      { daily: challenge, laps: challenge.laps, lapLimit: limit }, definition.rating, [], challenge.challenge);
    race.start();
    for (let tick = 0; tick < (limit * challenge.laps + 5) * 30 && race.phase !== 'finished'; tick++) {
      race.step(1 / 30, aiDrivingInput(track, configuration, race.model.state, 1, []));
    }
    const snapshot = race.snapshot();
    assert.equal(race.phase, 'finished', device);
    assert.equal(snapshot.disqualified, false, device);
    const settled = settleDailyResult(saved, input(date, {
      raceId: device, laps: snapshot.lapTimes, counters: snapshot.daily.counters,
      disqualified: snapshot.disqualified, controlMode: device === 'touch' ? 'touch' : 'keyboard',
    }));
    assert.equal(settled.settlement.success, true, device);
    assert.equal(settled.settlement.awarded, device === 'desktop' ? 150 : 0);
    saved = settled.daily;
  }
});
