import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACK_CATALOG } from '../output/test/game/track/trackCatalog.js';
import { createCatalogTrack } from '../output/test/game/track/trackRuntime.js';
import { readForkCue, forkRouteCues } from '../output/test/game/track/forkCue.js';
import { advanceTrackDistance, physicalDistance, selectBranch } from '../output/test/game/track/trackBranches.js';
import { createDrivingModel, NEUTRAL_INPUT } from '../output/test/game/driving/createDrivingModel.js';
import { aiDrivingInput } from '../output/test/game/driving/createRaceSession.js';
import { DRONE_CATALOG } from '../output/test/game/drone/droneCatalog.js';

const definition = TRACK_CATALOG.find(d => d.id === 'arena-ring');
const pose = (distance, extra = {}) => ({ distance, offset: 0, altitudeLevel: 0, speed: 100, ...extra });
const controls = { ...NEUTRAL_INPUT, throttle: true };
const withoutHazards = track => ({ ...track, heightObstacles: [], corridorObstacles: [], mineFields: [], arcRails: [], boostPads: [], boostRings: [] });

test('ARENA RING cue exposes ordered choices, default middle, physical lengths and three distinct hazards', () => {
  const track = createCatalogTrack(definition), fork = track.branches[0], routes = forkRouteCues(fork);
  assert.deepEqual(routes.map(r => r.id), ['arena-ring-fork:0', 'arena-ring-fork:2', 'arena-ring-fork:1']);
  assert.deepEqual(routes.map(r => r.choice), ['left', 'center', 'right']);
  assert.deepEqual(routes.map(r => r.roadHeight), ['low', 'middle', 'high']);
  assert.deepEqual(routes.map(r => r.hazards), [['height'], ['corridor'], []]);
  assert.equal(fork.defaultRouteId, routes[1].id);
  for (const r of routes) assert.ok(Math.abs(physicalDistance(track, fork.start, fork.end - fork.start, r.id) - r.length) < 1e-8);
  assert.deepEqual(track.sample((fork.start + fork.end) / 2).position, track.sample((fork.start + fork.end) / 2, undefined, routes[1].id).position);
});

test('cue phases and distances follow cumulative laps, speed lookahead, preview and locked selection', () => {
  const track = createCatalogTrack(definition), fork = track.branches[0];
  assert.equal(readForkCue(track, pose(fork.start - 181, { speed: 0 })), null);
  let cue = readForkCue(track, pose(fork.start - 200));
  assert.equal(cue.phase, 'approach'); assert.equal(cue.distance, 200); assert.equal(cue.selectedRouteId, null);
  cue = readForkCue(track, pose(track.length * 2 + fork.start + 10, { offset: -6 }));
  assert.equal(cue.phase, 'choice'); assert.equal(cue.previewRouteId, fork.routes[0].id); assert.equal(cue.distance, 50);
  cue = readForkCue(track, pose(fork.start + 61, { offset: 6, routeId: fork.routes[0].id }));
  assert.equal(cue.phase, 'route'); assert.equal(cue.selectedRouteId, fork.routes[0].id); assert.equal(cue.previewRouteId, fork.routes[0].id);
  assert.ok(Math.abs(cue.distance - physicalDistance(track, fork.start + 61, fork.end - fork.start - 61, fork.routes[0].id)) < 1e-8);
  assert.equal(readForkCue(track, pose(fork.end)), null);
  assert.equal(readForkCue(createCatalogTrack(TRACK_CATALOG[0]), pose(0)), null);
});

test('center dead zone includes both boundaries at every hover level; left and right remain steer-only choices', () => {
  const track = createCatalogTrack(definition), fork = track.branches[0], limit = track.halfWidth * .3;
  for (const altitudeLevel of [0, 1]) for (const [offset, index] of [[-limit - .01, 0], [-limit, 1], [0, 1], [limit, 1], [limit + .01, 2]])
    assert.equal(selectBranch(track, fork.start + 10, offset, altitudeLevel), fork.routes[index].id);
});

test('a large frame locks any of three choices, preserves it despite opposite input, and resets after merging and next lap', () => {
  const track = withoutHazards(createCatalogTrack(definition)), fork = track.branches[0];
  for (const [index, offset] of [[0, -6], [1, 0], [2, 6]]) {
    const model = createDrivingModel(track), s = model.state;
    Object.assign(s, { distance: fork.start + 59, offset, speed: 155 });
    model.step(.2, controls);
    assert.equal(s.routeId, fork.routes[index].id);
    s.offset = -offset; model.step(.2, controls); assert.equal(s.routeId, fork.routes[index].id);
    s.distance = fork.end + .1; model.step(1 / 120, NEUTRAL_INPUT); assert.equal(s.routeId, null);
    Object.assign(s, { distance: track.length + fork.start + 1, offset: 0 });
    model.step(1 / 120, NEUTRAL_INPUT); assert.equal(s.routeId, fork.defaultRouteId);
    model.reset(); assert.equal(s.routeId, null);
  }
});

for (const challenge of ['easy', 'normal', 'hard']) test(`${challenge}: randomization preserves fixed heights, corridor and safe pad without extra branch hazards or cores`, () => {
  const track = createCatalogTrack(definition, challenge), fork = track.branches[0];
  const layout = () => [track.heightObstacles, track.corridorObstacles, track.boostPads, track.boostRings, track.mineFields, track.arcRails]
    .map(list => list.filter(o => o.routeId?.startsWith(fork.id)));
  const expected = layout();
  assert.deepEqual(expected.map(a => a.length), [2, 1, 1, 0, 0, 0]);
  assert.ok(Math.abs(physicalDistance(track, expected[0][0].distance, expected[0][1].distance - expected[0][0].distance, fork.routes[0].id) - 140) < 1e-8);
  for (const list of expected) for (const o of list) {
    const route = fork.routes.find(r => r.id === o.routeId);
    assert.ok(o.distance > route.mouthEnd && o.distance < route.mergeStart);
  }
  for (const seed of [0, .17, .5, .99]) {
    track.randomizeObstacles(() => seed);
    assert.deepEqual(layout(), expected);
    const model = createDrivingModel(track);
    assert.ok(model.cores.length <= 1);
    assert.ok(model.cores.every(c => c.distance < fork.start - 35 || c.distance > fork.end + 35));
  }
});

test('ordinary driving clears every authored route with starter and fast craft across difficulties', () => {
  for (const challenge of ['easy', 'normal', 'hard']) for (const craft of [DRONE_CATALOG[0], DRONE_CATALOG[1]]) {
    const track = createCatalogTrack(definition, challenge), fork = track.branches[0];
    for (const route of fork.routes) {
      const model = createDrivingModel(track, craft.configuration.performance), s = model.state;
      Object.assign(s, { distance: fork.start + fork.junctionLength + .1, routeId: route.id, speed: 85 });
      for (let tick = 0; tick < 60 * 30 && s.distance < fork.end; tick++)
        model.step(1 / 60, aiDrivingInput(track, craft.configuration, s, 0, []));
      assert.ok(s.distance >= fork.end, `${craft.name} ${challenge} ${route.id} reaches merge`);
      assert.equal(s.collisions, 0, `${craft.name} ${challenge} ${route.id}`);
      assert.equal(s.offTrackExits, 0, `${craft.name} ${challenge} ${route.id}`);
    }
  }
});

test('awakening takes the middle at entry and follows any already locked route without collision', () => {
  const track = createCatalogTrack(definition), fork = track.branches[0];
  for (const route of [null, ...fork.routes]) {
    const model = createDrivingModel(track), s = model.state;
    Object.assign(s, { distance: route ? fork.start + 61 : fork.start + 1, routeId: route?.id ?? null,
      offset: route ? 0 : 6, speed: 150, awakeningCores: 1 });
    assert.equal(model.useAwakening(), true);
    const expected = route?.id ?? fork.defaultRouteId;
    for (let tick = 0; tick < 60 * 5 && s.distance < fork.end; tick++) {
      model.step(1 / 60, controls);
      if (s.distance > fork.start + 60 && s.distance < fork.end) assert.equal(s.routeId, expected);
    }
    assert.ok(s.distance >= fork.end);
    assert.equal(s.collisions, 0); assert.equal(s.offTrackExits, 0);
  }
});
