import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createParryController, PARRY_TUNING } from '../output/test/game/driving/parry.js';
import { parryWorldPosition, predictParryThreat, predictCraftParryThreat } from '../output/test/game/driving/parryThreat.js';
import { createDrivingModel, NEUTRAL_INPUT, DRIVING_TUNING } from '../output/test/game/driving/createDrivingModel.js';
import { createTimeAttack } from '../output/test/game/driving/createTimeAttack.js';
import { createRaceSession } from '../output/test/game/driving/createRaceSession.js';
import { createTrack } from '../output/test/game/track/createTrack.js';
import { createRaceRecords } from '../output/test/game/driving/raceRecords.js';
import { DEFAULT_DRONE_CONFIGURATION as config } from '../output/test/game/drone/droneConfiguration.js';
import { createPadReader } from '../output/test/platform/gamepadInput.js';
const dt = 1 / 120;
const input = { ...NEUTRAL_INPUT, throttle: true };
const track = overrides => ({ length: 10000, halfWidth: 11, checkpointSpacing: 100, heightObstacles: [], sample: () => ({ curvature: 0 }), ...overrides });
const hit = (id = 'wall:1', kind = 'wall') => ({ id, kind, worldPosition: { x: 1, y: 2, z: 3 }, secondsToImpact: 0 });
const advance = (m, seconds, controls = input, fps = 120) => { for (let i = 0; i < Math.round(seconds * fps); i++) m.step(1 / fps, controls); };
const records = () => createRaceRecords({ trackId: 'parry-test', configurationId: 'parry-test' });
const pose = overrides => ({ distance: 0, offset: 0, altitude: 2, targetAltitude: 2, speed: 60, heading: 0, ...overrides });
const electric = { distance: 50, depth: 4, kind: 'rise', visual: 'discharge-arcs', speedRetention: .35, minAltitude: 5.2, maxAltitude: DRIVING_TUNING.maxAltitude };
const hazards = [
  ['height', { heightObstacles: [electric] }],
  ['mine', { mineFields: [{ distance: 50, length: 20, mines: [{ at: 0, offset: 0, radius: 1 }] }] }],
  ['corridor', { corridorObstacles: [{ distance: 50, depth: 4, safeCenter: 5, safeWidth: 4, speedRetention: .35 }] }],
];

test('one impact consumes a 0.30s window, with immutable event IDs and a 3s reuse clock', () => {
  const c = createParryController(); assert.equal(c.request(), true); assert.equal(c.request(), false);
  c.advance(.299); assert.equal(c.impact(hit()), true); assert.equal(c.impact(hit('mine:1', 'mine')), false);
  const event = c.snapshot().lastEvent; assert.equal(event.id, 1); assert.equal(event.outcome, 'success');
  c.advance(2.701); assert.equal(c.snapshot().phase, 'ready'); assert.equal(c.request(), true);
  c.setTarget(hit('mine:2', 'mine')); c.advance(.3); assert.equal(c.impact(hit('mine:2', 'mine')), false);
  assert.equal(c.snapshot().lastEvent.id, 2); assert.equal(c.snapshot().failureEventId, 2);
  assert.equal(c.snapshot().successEventId, 1); assert.equal(event.outcome, 'success');
  assert.deepEqual([c.snapshot().successes, c.snapshot().failures], [1, 1]);
  c.reset(); assert.equal(c.snapshot().lastEvent, null); assert.equal(c.snapshot().phase, 'ready');
  const disabled = createParryController(false); assert.equal(disabled.request(), false); assert.equal(disabled.impact(hit()), false);
});

test('ongoing contact cannot be parried late or repeatedly; a released episode can', () => {
  const c = createParryController(); assert.equal(c.impact(hit()), false);
  c.request(); assert.equal(c.impact(hit()), false); c.advance(3);
  c.releaseEpisode('wall:1'); c.request(); assert.equal(c.impact(hit()), true); c.advance(3);
  c.request(); assert.equal(c.impact(hit()), false); c.advance(3);
  c.releaseEpisode('wall:1'); c.request(); assert.equal(c.impact(hit()), true);
  assert.equal(c.snapshot().successes, 2);
});

for (const [kind, data] of hazards) test(`${kind} defense preserves speed, boost and clean streak without duplicate passage rewards`, () => {
  const protectedModel = createDrivingModel(track(data)), ordinary = createDrivingModel(track(data));
  for (const m of [protectedModel, ordinary]) Object.assign(m.state, { distance: 44, speed: 64, charge: .8, cleanStreak: 4 });
  protectedModel.useParry(); advance(protectedModel, .15); advance(ordinary, .15);
  assert.equal(protectedModel.state.parry.lastEvent.target.kind, kind);
  assert.equal(protectedModel.state.parry.successes, 1); assert.equal(protectedModel.state.collisions, 0);
  assert.equal(protectedModel.state.penaltyPoints, 0); assert.equal(protectedModel.state.cleanStreak, 4);
  assert.ok(protectedModel.state.speed > ordinary.state.speed); assert.ok(protectedModel.state.charge >= .8);
  assert.equal(ordinary.state.collisions, 1); assert.ok(ordinary.state.penaltyPoints > 0);
  if (kind === 'corridor') assert.ok(protectedModel.state.offset > 0, 'blocking corridor still pushes toward its opening');
  advance(protectedModel, .8); assert.equal(protectedModel.state.parry.successes, 1);
  assert.equal(protectedModel.state.obstaclesPassed, 0); assert.equal(protectedModel.state.nearMisses, 0);
});

test('one window cannot block two simultaneous mines, and late timing retains collision penalties', () => {
  const two = createDrivingModel(track({ mineFields: [{ distance: 50, length: 20, mines: [{ at: 0, offset: 0, radius: 1 }, { at: 0, offset: 0, radius: 1 }] }] }));
  Object.assign(two.state, { distance: 45, speed: 64 }); two.useParry(); advance(two, .12);
  assert.equal(two.state.parry.successes, 1); assert.equal(two.state.collisions, 1);
  const late = createDrivingModel(track({ heightObstacles: [electric] }));
  late.useParry(); advance(late, .3); Object.assign(late.state, { distance: 45, speed: 64 }); advance(late, .1);
  assert.equal(late.state.parry.failures, 1); assert.equal(late.state.parry.successes, 0); assert.equal(late.state.collisions, 1);
});

test('wall defense keeps the road boundary and bounce; sustained rubbing cannot farm defenses', () => {
  const m = createDrivingModel(track()); m.state.speed = 64; m.state.offset = 9.3; m.state.heading = 1;
  m.useParry(); m.step(dt, input); assert.equal(m.state.collisions, 0); assert.equal(m.state.parry.successes, 1);
  assert.ok(m.state.offset <= 11 - DRIVING_TUNING.craftHalfWidth); assert.ok(m.state.heading < 0);
  for (let i = 0; i < 400; i++) { m.state.offset = 9.3; m.state.heading = 1; m.state.speed = 64; m.step(dt, input); }
  assert.ok(m.state.collisions >= 5); assert.equal(m.useParry(), true);
  m.state.offset = 9.3; m.state.heading = 1; m.step(dt, input); assert.equal(m.state.parry.successes, 1);
  advance(m, 3); Object.assign(m.state, { offset: 0, heading: 0 }); advance(m, .3);
  m.useParry(); Object.assign(m.state, { offset: 9.3, heading: 1, speed: 64 }); m.step(dt, input);
  assert.equal(m.state.parry.successes, 2);
});

test('craft defense still pushes and clamps the craft, while repeated contact retains normal damage', () => {
  const m = createDrivingModel(track()); Object.assign(m.state, { offset: 0, speed: 64, charge: .8, cleanStreak: 3 });
  m.useParry(); m.contact('pair:1', hit('pair:1', 'craft'), 1);
  assert.equal(m.state.offset, PARRY_TUNING.contactPush); assert.equal(m.state.speed, 64);
  assert.equal(m.state.cleanStreak, 3); assert.equal(m.state.charge, .8);
  advance(m, 3); m.useParry(); m.contact('pair:1', hit('pair:1', 'craft'), 1);
  assert.equal(m.state.parry.successes, 1); assert.equal(m.state.collisions, 1);
  advance(m, 3); m.releaseParryContact('pair:1'); m.useParry(); m.state.offset = 100;
  m.contact('pair:1', hit('pair:1', 'craft'), 1); assert.equal(m.state.parry.successes, 2);
  assert.ok(m.state.offset <= 11 - DRIVING_TUNING.craftHalfWidth);
});

test('arc rails and leaving the road remain hazardous during the defense window', () => {
  const rail = createDrivingModel(track({ arcRails: [{ distance: 50, segments: [{ at: 0, length: 20, side: 1 }] }] }));
  Object.assign(rail.state, { distance: 49, offset: 3, speed: 64 }); rail.useParry(); advance(rail, .1);
  assert.equal(rail.state.collisions, 1); assert.equal(rail.state.parry.successes, 0);
  const exit = createDrivingModel(track()); Object.assign(exit.state, { offset: 13, altitude: 8, targetAltitude: 8, speed: 64 });
  exit.useParry(); exit.step(dt, input); assert.equal(exit.state.offTrackExits, 1); assert.equal(exit.state.parry.successes, 0);
});

test('forecast warns only for unsafe paths within 0.7s, following route, altitude, lap and focus clock', () => {
  const t = track({ heightObstacles: [electric] }); const levels = [2, 5.2, 8];
  assert.equal(predictParryThreat(t, pose(), levels, 0, 6), null);
  const warning = predictParryThreat(t, pose({ distance: 10 }), levels, 0, 6);
  assert.equal(warning.kind, 'height'); assert.ok(warning.secondsToImpact < .7);
  assert.equal(predictParryThreat(t, pose({ distance: 10, altitude: 6, targetAltitude: 6 }), levels, 0, 6), null);
  assert.equal(predictParryThreat(t, pose({ distance: 10, targetAltitude: 6 }), levels, 0, 10), null);
  assert.equal(predictParryThreat(t, pose({ distance: 10 }), levels, 0, 6, 1 / .45), null);
  assert.equal(predictParryThreat(track({ heightObstacles: [{ ...electric, routeId: 'upper' }] }), pose({ distance: 10, routeId: 'lower' }), levels, 0, 6), null);
  assert.equal(predictParryThreat(t, pose({ distance: 10 }), levels, 0, 6, 1, () => true), null);
  assert.equal(predictParryThreat(t, pose({ distance: 10010 }), levels, 0, 6).id, 'height-0:1');
});

test('moving electric warnings use the opening at arrival, including the real obstacle clock under focus', () => {
  const t = track({ obstacleTime: .85, heightObstacles: [{ ...electric,
    motion: { stepSeconds: 1, transitionSeconds: .2, phase: 0, clearance: .7 } }] });
  const levels = [2, 5.2, 8];
  assert.equal(predictParryThreat(t, pose({ distance: 10 }), levels, 0, 6).kind, 'height');
  assert.equal(predictParryThreat(t, pose({ distance: 10, altitude: 5.2, targetAltitude: 5.2 }), levels, 0, 6), null);
  // Focus changes travel time, but the moving obstacle continues on the real race clock.
  assert.equal(predictParryThreat(t, pose({ distance: 42 }), levels, 0, 6), null);
  assert.equal(predictParryThreat(t, pose({ distance: 42 }), levels, 0, 6, 1 / .45).kind, 'height');
});

test('warning positions use the road frame; NPC forecasts reject different branches and heights', () => {
  const world = track({ sample: (distance, _, route) => ({ curvature: 0, position: new THREE.Vector3(distance, route === 'far' ? 100 : 0, 0), right: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0) }) });
  assert.deepEqual(parryWorldPosition(world, 50, 3, 5), { x: 50, y: 5, z: 3 });
  const a = pose({ speed: 70 }), b = pose({ distance: 10, speed: 60 });
  const target = predictCraftParryThreat(world, a, b, 'pair'); assert.equal(target.kind, 'craft'); assert.ok(Math.abs(target.secondsToImpact - .56) < 1e-8);
  assert.equal(predictCraftParryThreat(world, a, { ...b, routeId: 'far' }, 'pair'), null);
  assert.equal(predictCraftParryThreat(world, a, { ...b, altitude: 8 }, 'pair'), null);
  assert.equal(predictCraftParryThreat(world, a, { ...b, speed: 80 }, 'pair'), null);
});

test('running-only activation, pause freezes timers, focus does not lengthen parry and restart resets events', () => {
  const race = createTimeAttack(track(), config.performance, records(), 1);
  assert.equal(race.useParry(), false); race.start(); advance(race, 3); assert.equal(race.useFocus(), true);
  assert.equal(race.useParry(), true); advance(race, .2); assert.ok(Math.abs(race.model.state.parry.windowRemaining - .1) < 1e-8);
  race.pause(); const before = race.model.state.parry; advance(race, 4); assert.deepEqual(race.model.state.parry, before); assert.equal(race.useParry(), false);
  race.start(); advance(race, .1); assert.equal(race.model.state.parry.failures, 1); advance(race, 2.7);
  assert.equal(race.model.state.parry.phase, 'ready'); race.restart(); assert.equal(race.model.state.parry.failureEventId, 0);
  const practice = createTimeAttack(track(), config.performance, records(), 0, { practice: true }); practice.start(); advance(practice, 3);
  assert.equal(practice.model.state.parry.enabled, false); assert.equal(practice.useParry(), false);
});

test('awakening and recovery cancel the open defense without a spurious failure', () => {
  const m = createDrivingModel(track()); m.useParry(); m.state.awakeningCores = 1; assert.equal(m.useAwakening(), true);
  assert.equal(m.useParry(), false); assert.equal(m.state.parry.windowRemaining, 0); advance(m, .4); assert.equal(m.state.parry.failures, 0);
  m.reset(); m.useParry(); m.recover(); advance(m, .4); assert.equal(m.state.parry.failures, 0); assert.equal(m.state.parry.windowRemaining, 0);
});

test('competition gives defense to the player only and preserves contact response for the rival', () => {
  const race = createRaceSession({ ...createTrack(), ...track() }, config, records(), 0, 'competition', () => .999); race.start(); advance(race, 3);
  Object.assign(race.model.state, { distance: 60, offset: 0, speed: 40 });
  Object.assign(race.rivals[0].controller.model.state, { distance: 62, offset: 0, speed: 40 });
  assert.ok(race.rivals.every(r => !r.controller.model.state.parry.enabled)); race.useParry(); race.step(dt, input);
  assert.equal(race.model.state.parry.lastEvent.target.kind, 'craft'); assert.equal(race.model.state.collisions, 0);
  assert.equal(race.rivals[0].controller.model.state.collisions, 1); assert.ok(Math.abs(race.model.state.offset - race.rivals[0].controller.model.state.offset) >= .49);
});

test('R3 activates once per press without taking over boost, brake, awakening or item buttons', () => {
  const reader = createPadReader(); const pad = pressed => ({ mapping: 'standard', axes: [0, 0], buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })) });
  reader.read(pad([]), -10, true);
  const first = reader.read(pad([11, 6, 7]), 0, true); assert.deepEqual(first.actions, ['parry']); assert.equal(first.snapshot.brake, true); assert.equal(first.snapshot.boost, true);
  assert.deepEqual(reader.read(pad([11]), 4000, true).actions, []); reader.read(pad([]), 4010, true);
  assert.deepEqual(reader.read(pad([11]), 4020, true).actions, ['parry']);
});

test('defense results and reuse timing are consistent at 30, 60 and 120 FPS', () => {
  const states = [30, 60, 120].map(fps => { const m = createDrivingModel(track({ heightObstacles: [electric] })); Object.assign(m.state, { distance: 44, speed: 64 }); m.useParry(); advance(m, .2, input, fps); advance(m, 3, input, fps); return m.state; });
  for (const s of states) { assert.equal(s.parry.successes, 1); assert.equal(s.collisions, 0); assert.equal(s.parry.phase, 'ready'); }
  for (const s of states.slice(1)) for (const k of ['distance', 'speed', 'charge']) assert.ok(Math.abs(s[k] - states[0][k]) < 1e-7, k);
});

test('a successful craft defense retains drift, but the next unprotected hit cancels it', () => {
  const m = createDrivingModel(track({ halfWidth: 200, sample: () => ({ curvature: .004 }) }), undefined, { drift: true });
  Object.assign(m.state, { speed: 80, charge: .2 }); advance(m, 1.4, { ...NEUTRAL_INPUT, brake: true, steer: .7 });
  assert.equal(m.state.drift.active, true); const stage = m.state.drift.stage;
  m.useParry(); m.contact('drift-contact', hit('drift-contact', 'craft'), 1);
  assert.equal(m.state.drift.active, true); assert.equal(m.state.drift.stage, stage); assert.equal(m.state.drift.lastReward, null);
  m.contact('another-contact', hit('another-contact', 'craft'), -1);
  assert.equal(m.state.drift.active, false); assert.equal(m.state.drift.lastReward.cancelled, true); assert.equal(m.state.drift.lastReward.addedCharge, 0);
});

test('race finish cancels an open window and rejects further activation', () => {
  const race = createTimeAttack(track({ length: 100 }), config.performance, createRaceRecords({ trackId: 'finish-parry', configurationId: 'test', laps: 1 }), 0, { laps: 1 }); race.start(); advance(race, 3);
  Object.assign(race.model.state, { distance: 99, speed: 60 }); race.useParry(); advance(race, .1);
  assert.equal(race.phase, 'finished'); assert.equal(race.model.state.parry.windowRemaining, 0); assert.equal(race.useParry(), false);
  advance(race, 5); assert.equal(race.model.state.parry.failures, 0); assert.equal(race.model.state.parry.target, null);
});

test('wall warning disappears during ongoing contact and returns after a clear separation', () => {
  const m = createDrivingModel(track()); Object.assign(m.state, { speed: 64, offset: 8, heading: .3 }); m.step(dt, input);
  assert.equal(m.state.parry.target.kind, 'wall'); assert.ok(m.state.parry.target.secondsToImpact <= .7);
  Object.assign(m.state, { offset: 9.3, heading: 1 }); m.step(dt, input); assert.equal(m.state.parry.target, null);
  Object.assign(m.state, { offset: 0, heading: 0 }); advance(m, .3);
  Object.assign(m.state, { speed: 64, offset: 8, heading: .3 }); m.step(dt, input); assert.equal(m.state.parry.target.kind, 'wall');
});

test('competition groups continuous craft contact and re-arms only after separation', () => {
  const race = createRaceSession({ ...createTrack(), ...track() }, config, records(), 0, 'competition', () => .999); race.start(); advance(race, 3);
  const player = race.model.state, rival = race.rivals[0].controller.model.state;
  const touch = () => { Object.assign(player, { distance: 60, offset: 0, speed: 40 }); Object.assign(rival, { distance: 62, offset: 0, speed: 40, altitude: player.altitude, targetAltitude: player.altitude }); race.step(dt, input); };
  race.useParry(); touch(); assert.equal(player.parry.successes, 1);
  for (let i = 0; i < 370; i++) touch(); assert.equal(race.useParry(), true);
  for (let i = 0; i < 40; i++) touch(); assert.equal(player.parry.successes, 1); assert.equal(player.parry.failures, 1);
  for (let i = 0; i < 340; i++) { Object.assign(player, { distance: 60, offset: 0, heading: 0, speed: 40 }); Object.assign(rival, { distance: 160, offset: 0, speed: 40 }); race.step(dt, input); }
  assert.equal(race.useParry(), true); touch(); assert.equal(player.parry.successes, 2);
});
