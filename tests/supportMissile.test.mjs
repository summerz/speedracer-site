import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { createSupportMissile } from '../output/test/game/driving/supportMissile.js';
import { reserveSupportMissile } from '../output/test/game/progression/supportMissileUse.js';
import { createRaceSession } from '../output/test/game/driving/createRaceSession.js';
import { createRaceRecords } from '../output/test/game/driving/raceRecords.js';
import { createTrack } from '../output/test/game/track/createTrack.js';
import { DEFAULT_DRONE_CONFIGURATION as config } from '../output/test/game/drone/droneConfiguration.js';
import { initialProgress, applyCommand, validateProgress } from '../output/test/game/progression/progress.js';

const pose = (id, distance, extra = {}) => ({ id, distance, active: true, offset: 0, altitude: 0,
  routeId: null, position: { x: 0, y: 0, z: distance }, ...extra });
const player = pose('player', 100);
const crossing = (missile, extra = {}) => {
  missile.step(.01, player, [pose('target', 96, extra)]);
  missile.step(.01, player, [pose('target', 103, extra)]);
  return missile.snapshot(player, [pose('target', 103, extra)], 0);
};
const launch = missile => {
  const s = crossing(missile);
  assert.equal(s.canLaunch, true);
  assert.equal(missile.launch(s.requestId, player, [pose('target', 103)], 0), true);
};
const approx = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);

test('missile waits for an actual overtake and ignores grid leaders and small rank jitter', () => {
  const m = createSupportMissile();
  m.step(.01, player, [pose('target', 103)]);
  assert.equal(m.snapshot(player, [], 0).phase, 'armed');
  for (const d of [99, 101, 99.5, 102.5]) m.step(.01, player, [pose('target', d)]);
  assert.equal(m.snapshot(player, [], 0).phase, 'armed');
  const s = crossing(m);
  assert.equal(s.phase, 'waiting'); assert.equal(s.targetId, 'target');
  assert.equal(m.launch(s.requestId + 1, player, [pose('target', 103)], 0), false);
});

test('separate branches, altitude, lateral distance, distant world positions and lapped racers are not targets', () => {
  for (const extra of [{ routeId: 'other' }, { altitude: 2 }, { offset: 11 }, { active: false }, { position: { x: 0, y: 0, z: 500 } }]) {
    assert.equal(crossing(createSupportMissile(), extra).phase, 'armed');
  }
  const m = createSupportMissile();
  m.step(.01, player, [pose('lapped', -4900)]);
  m.step(.01, player, [pose('lapped', -4897)]);
  assert.equal(m.snapshot(player, [], 0).phase, 'armed');
});

test('multiple simultaneous overtakers yield only one request; shared cooldown and request expiry are respected', () => {
  const m = createSupportMissile();
  m.step(.01, player, [pose('first', 96), pose('second', 96)]);
  const rivals = [pose('first', 103), pose('second', 104)];
  m.step(.01, player, rivals);
  const s = m.snapshot(player, rivals, 3);
  assert.equal(s.targetId, 'first'); assert.equal(s.canLaunch, false);
  assert.equal(m.launch(s.requestId, player, rivals, 3), false);
  assert.equal(m.snapshot(player, rivals, 0).canLaunch, true);
  m.step(4.01, player, rivals);
  assert.equal(m.snapshot(player, rivals, 0).phase, 'armed');
  assert.equal(m.launch(s.requestId, player, rivals, 0), false);
});

test('pending launch is revalidated if target finishes, changes route, falls behind or exceeds range', () => {
  for (const target of [pose('target', 103, { active: false }), pose('target', 103, { routeId: 'fork' }), pose('target', 99), pose('target', 281)]) {
    const m = createSupportMissile(), s = crossing(m);
    assert.equal(m.launch(s.requestId, player, [target], 0), false);
    m.step(.01, player, [target]);
    assert.equal(m.snapshot(player, [target], 0).phase, 'armed');
  }
});

test('0.4 second homing flight exposes copied world positions, then exactly 5 seconds of stop and one retained hit ID', () => {
  const m = createSupportMissile(); launch(m);
  m.step(.2, player, [pose('target', 113)]);
  const s = m.snapshot(player, [pose('target', 113)], 0);
  assert.equal(s.phase, 'flying'); approx(s.progress, .5); approx(s.position.z, 106.5);
  s.position.z = -1; assert.notEqual(m.snapshot(player, [], 0).position.z, -1);
  m.step(.2, player, [pose('target', 123, { routeId: 'new-fork' })]);
  const hit = m.snapshot(player, [], 0);
  assert.equal(hit.phase, 'hit'); assert.equal(hit.hitEventId, 1); approx(hit.stopRemaining, 5);
  assert.equal(hit.position.z, 123); assert.equal(m.stopped('target'), true);
  m.step(4.999, player, []); assert.equal(m.stopped('target'), true);
  m.step(.001, player, []); assert.equal(m.stopped('target'), false);
  assert.equal(m.snapshot(player, [], 0).phase, 'spent');
  assert.equal(m.snapshot(player, [], 0).hitEventId, 1);
  assert.equal(crossing(m).canLaunch, false);
});

test('finish during flight cancels the hit without restoring a spent missile', () => {
  for (const who of ['player', 'target']) {
    const m = createSupportMissile(); launch(m);
    m.step(.1, { ...player, active: who !== 'player' }, [pose('target', 110, { active: who !== 'target' })]);
    const s = m.snapshot(player, [], 0);
    assert.equal(s.phase, 'spent'); assert.equal(s.position, null); assert.equal(s.hitEventId, 0);
  }
});

const straight = () => ({ ...createTrack(), length: 5000, halfWidth: 14, checkpointSpacing: 25,
  branches: [], jumps: [], heightObstacles: [], corridors: [], mineFields: [], boostPads: [], arcRails: [], boostRings: [],
  sample: distance => ({ curvature: 0, position: new Vector3(0, 0, distance), right: new Vector3(1, 0, 0), up: new Vector3(0, 1, 0), tangent: new Vector3(0, 0, 1) }) });
const input = { throttle: false, brake: true, steer: 0, lift: 0, boost: false };
const advance = (race, seconds, fps = 120) => { for (let i = 0; i < Math.round(seconds * fps); i++) race.step(1 / fps, input); };
const session = (challenge = 'normal', mode = 'desktop', slots = ['support-missile'], focus = 0) => {
  const race = createRaceSession(straight(), config, createRaceRecords({ trackId: 'missile', configurationId: 'test' }), focus,
    'competition', () => .999, mode, {}, undefined, slots, challenge);
  race.start(); advance(race, 3);
  // Cross every ordered checkpoint to enter lap two before arranging the overtake.
  for (let d = 25; d <= 5000; d += 25) {
    race.model.state.distance = d - .1; race.model.state.speed = 50;
    race.step(1 / 120, { ...input, brake: false, throttle: true });
  }
  assert.equal(race.snapshot().completedLaps, 1);
  race.model.state.distance = 5100; race.model.state.offset = 0; race.model.state.speed = 0;
  race.rivals.forEach((r, i) => { Object.assign(r.controller.model.state, { distance: 5300 + i * 100, offset: 8, speed: 0, altitude: race.model.state.altitude }); });
  const target = race.rivals[0];
  Object.assign(target.controller.model.state, { distance: 5096, offset: 4 }); race.step(1 / 120, input);
  target.controller.model.state.distance = 5103; race.step(1 / 120, input);
  assert.equal(race.snapshot().supportMissile.canLaunch, true);
  return { race, target, requestId: race.snapshot().supportMissile.requestId };
};

for (const challenge of ['easy', 'normal', 'hard']) for (const controlMode of ['desktop', 'touch']) {
  test(`session missile uses identical real flight/stop time on ${challenge}/${controlMode}`, () => {
    const { race, target, requestId } = session(challenge, controlMode);
    assert.equal(race.useRivalItem('support-missile'), false);
    assert.equal(race.launchSupportMissile(requestId), true);
    advance(race, .3); assert.equal(race.snapshot().supportMissile.phase, 'flying');
    advance(race, .1); approx(race.snapshot().supportMissile.stopRemaining, 5);
    const frozen = { ...target.controller.model.state };
    advance(race, 4.9);
    for (const key of ['distance', 'offset', 'altitude', 'speed', 'charge']) assert.equal(target.controller.model.state[key], frozen[key]);
    approx(target.controller.model.state.elapsed - frozen.elapsed, 4.9);
    assert.equal(race.snapshot().competition.standings.find(s => s.id === target.id).effect, 'support-missile');
    advance(race, .1); approx(race.snapshot().supportMissile.stopRemaining, 0);
    advance(race, .1); assert.ok(target.controller.model.state.distance > frozen.distance);
    assert.equal(race.snapshot().assisted, true);
    assert.equal(race.snapshot().items.find(s => s.id === 'support-missile').remaining, 0);
  });
}

test('pause preserves flight and stop, restart clears requests and hit events', () => {
  const { race, requestId } = session(); race.launchSupportMissile(requestId);
  advance(race, .2); race.pause(); const flight = race.snapshot().supportMissile;
  advance(race, 5); assert.deepEqual(race.snapshot().supportMissile, flight);
  race.start(); advance(race, .2); race.pause(); const hit = race.snapshot().supportMissile;
  advance(race, 5); assert.deepEqual(race.snapshot().supportMissile, hit);
  race.restart(); assert.equal(race.snapshot().supportMissile.phase, 'armed');
  assert.equal(race.snapshot().supportMissile.hitEventId, 0); assert.equal(race.launchSupportMissile(requestId), false);
});

test('a missile-stopped rival is transparent to player contacts', () => {
  const { race, target, requestId } = session(); race.launchSupportMissile(requestId); advance(race, .4);
  Object.assign(race.model.state, { distance: target.controller.model.state.distance - 1, offset: target.controller.model.state.offset,
    altitude: target.controller.model.state.altitude, speed: 40 });
  const collisions = race.model.state.collisions;
  const nearMisses = race.model.state.nearMisses;
  advance(race, .1);
  assert.equal(race.model.state.collisions, collisions);
  assert.equal(race.model.state.nearMisses, nearMisses);
});

test('focus shares the cooldown; overlapping time-stop timers are not added', () => {
  const { race, requestId } = session('normal', 'desktop', ['support-missile'], 1);
  assert.equal(race.useFocus(), true);
  assert.equal(race.launchSupportMissile(requestId), false);
  // Stay close until the shared three-second cooldown expires.
  advance(race, 3);
  if (race.snapshot().supportMissile.canLaunch) {
    assert.equal(race.launchSupportMissile(requestId), true);
    advance(race, .4); approx(race.snapshot().supportMissile.stopRemaining, 5);
  } else assert.fail('nearby overtaker should remain eligible through focus cooldown');
  const other = session('normal', 'desktop', ['support-missile', 'time-stop']);
  other.race.launchSupportMissile(other.requestId); advance(other.race, .4);
  other.target.effects.freeze = 1;
  const d = other.target.controller.model.state.distance;
  advance(other.race, 5); approx(other.race.snapshot().supportMissile.stopRemaining, 0);
  advance(other.race, .1); assert.ok(other.target.controller.model.state.distance > d);
});

test('flight, stop expiry and resumption are stable at 30/60/120fps', () => {
  const results = [30, 60, 120].map(fps => {
    const { race, target, requestId } = session();
    race.launchSupportMissile(requestId);
    advance(race, .4, fps);
    const hitDistance = target.controller.model.state.distance;
    advance(race, 5, fps);
    assert.equal(target.controller.model.state.distance, hitDistance);
    assert.equal(race.snapshot().supportMissile.phase, 'spent');
    advance(race, .2, fps);
    return { distance: target.controller.model.state.distance, elapsed: target.controller.model.state.elapsed };
  });
  for (const result of results.slice(1)) {
    approx(result.distance, results[0].distance); approx(result.elapsed, results[0].elapsed);
  }
});

test('missile costs 100P, accepts complete legacy inventories, and allows five shots in each of two type slots', () => {
  let p = { ...initialProgress(), balance: 1000 };
  p.rivalInventory = { 'time-stop': 2, interference: 0 };
  p = validateProgress(p); assert.equal(p.rivalInventory['support-missile'], 0); assert.equal(p.rivalInventory['time-stop'], 2);
  for (let i = 0; i < 2; i++) p = applyCommand(p, { kind: 'rival-buy', item: 'support-missile', mode: 'competition' });
  assert.equal(p.balance, 800);
  assert.throws(() => applyCommand(p, { kind: 'rival-buy', item: 'support-missile', mode: 'time-attack' }));
  p = applyCommand(p, { kind: 'rival-slots', slots: ['support-missile', 'support-missile'], mode: 'competition' });
  p = applyCommand(p, { kind: 'rival-slots', slots: ['support-missile', 'time-stop'], mode: 'competition' });
  assert.equal(p.rivalSlots.length, 2);
  assert.throws(() => validateProgress({ ...p, focusSlots: 1 }));
  assert.throws(() => validateProgress({ ...p, rivalInventory: { 'time-stop': 2 } }));
});

const inventory = () => {
  let p = initialProgress(); p.rivalInventory['support-missile'] = 1;
  return { get profile() { return p; }, command: async c => { p = applyCommand(p, c); } };
};
test('persisted automatic launch consumes and confirms once', async () => {
  const store = inventory(); let launches = 0;
  const result = await reserveSupportMissile({ store, receipt: 'race:1', requestId: 1, valid: () => true,
    launch: () => { assert.equal(store.profile.rivalInventory['support-missile'], 0); launches++; return true; }, reject: () => assert.fail('unexpected reject') });
  assert.equal(result, true); assert.equal(launches, 1); assert.equal(store.profile.rivalUses['race:1'].state, 'used');
  await store.command({ kind: 'refund-rival', id: 'race:1' }); assert.equal(store.profile.rivalInventory['support-missile'], 0);
});

for (const reason of ['pause', 'restart', 'dispose', 'target-invalid']) test(`reservation refunds before launch on ${reason}`, async () => {
  const store = inventory(); let release; let valid = true; let launched = 0; let rejected = 0;
  const delayed = { command: async c => { await store.command(c); if (c.kind === 'consume-rival') await new Promise(resolve => { release = resolve; }); } };
  const task = reserveSupportMissile({ store: delayed, receipt: reason, requestId: 1, valid: () => valid,
    launch: () => { launched++; return reason !== 'target-invalid'; }, reject: () => rejected++ });
  await new Promise(resolve => setImmediate(resolve));
  if (reason !== 'target-invalid') valid = false;
  release(); assert.equal(await task, false); assert.equal(rejected, 1);
  assert.equal(launched, reason === 'target-invalid' ? 1 : 0);
  assert.equal(store.profile.rivalInventory['support-missile'], 1); assert.equal(store.profile.rivalUses[reason].state, 'refunded');
});

test('failed reservation cannot launch; failed confirmation after launch cannot refund', async () => {
  let launched = 0, rejected = 0;
  await assert.rejects(reserveSupportMissile({ store: { command: async () => { throw Error('disk'); } }, receipt: 'failed', requestId: 1,
    valid: () => true, launch: () => { launched++; return true; }, reject: () => rejected++ }));
  assert.equal(launched, 0); assert.equal(rejected, 1);
  const ledger = inventory();
  await assert.rejects(reserveSupportMissile({ store: { command: async c => { if (c.kind === 'confirm-rival') throw Error('disk'); await ledger.command(c); } },
    receipt: 'launched', requestId: 2, valid: () => true, launch: () => { launched++; return true; }, reject: () => rejected++ }));
  assert.equal(launched, 1); assert.equal(ledger.profile.rivalInventory['support-missile'], 0);
  assert.equal(ledger.profile.rivalUses.launched.state, 'pending');
});


test('first-lap crossings are discarded and lap two requires a fresh overtake', () => {
  const m=createSupportMissile(5), rivals=[pose('target',103)];
  m.step(.01,player,[pose('target',96)],false);m.step(.01,player,rivals,false);
  assert.equal(m.snapshot(player,rivals,0).canLaunch,false);
  m.step(.01,player,rivals,true);assert.equal(m.snapshot(player,rivals,0).phase,'armed');
  launch(m);
});
test('five missiles rearm only after the full stop and each needs a new overtake', () => {
  const m=createSupportMissile(5), rivals=[pose('target',103)];
  for(let n=1;n<=5;n++) {
    launch(m);m.step(.4,player,rivals);assert.equal(m.snapshot(player,rivals,0).hitEventId,n);
    m.step(4.99,player,rivals);assert.equal(m.stopped('target'),true);
    assert.equal(m.snapshot(player,rivals,0).canLaunch,false);m.step(.01,player,rivals);
    assert.equal(m.stopped('target'),false);assert.equal(m.snapshot(player,rivals,0).phase,n<5?'armed':'spent');
    assert.equal(m.snapshot(player,rivals,0).canLaunch,false);
  }
  crossing(m);assert.equal(m.snapshot(player,rivals,0).canLaunch,false);
});
