import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACK_CATALOG } from '../output/test/game/track/trackCatalog.js';
import { createCatalogTrack } from '../output/test/game/track/trackRuntime.js';
import { readForkCue, forkRouteCues } from '../output/test/game/track/forkCue.js';
import { physicalDistance } from '../output/test/game/track/trackBranches.js';
import { createDrivingModel, NEUTRAL_INPUT } from '../output/test/game/driving/createDrivingModel.js';
import { aiDrivingInput } from '../output/test/game/driving/createRaceSession.js';
import { DRONE_CATALOG } from '../output/test/game/drone/droneCatalog.js';

const definition = TRACK_CATALOG.find(d => d.id === 'terrace-flow');
const controls = { ...NEUTRAL_INPUT, throttle: true };
const layout = track => [track.heightObstacles, track.corridorObstacles, track.boostPads, track.boostRings, track.mineFields, track.arcRails]
  .map(list => list.filter(o => o.routeId?.startsWith('terrace-flow-fork:')));

test('TERRACE FLOW offers a short lower slalom and elevated safe boost route through the same entrance', () => {
  const track = createCatalogTrack(definition), fork = track.branches[0], routes = forkRouteCues(fork);
  assert.equal(fork.kind, 'vertical');
  assert.equal(fork.junctionLength, 60);
  assert.deepEqual(routes.map(r => r.choice), ['lower', 'upper']);
  assert.deepEqual(routes.map(r => r.roadHeight), ['low', 'high']);
  assert.deepEqual(routes.map(r => r.hazards), [['height'], []]);
  assert.equal(fork.defaultRouteId, routes[0].id);
  assert.ok(routes[1].length > routes[0].length && routes[1].length < routes[0].length * 1.05);
  for (const r of routes) assert.ok(Math.abs(physicalDistance(track, fork.start, fork.end - fork.start, r.id) - r.length) < 1e-8);
  const midpoint = (fork.start + fork.end) / 2;
  assert.ok(track.sample(midpoint, undefined, routes[1].id).position.y - track.sample(midpoint, undefined, routes[0].id).position.y > 70);
  for (const altitudeLevel of [0, 1]) {
    const s = { distance: fork.start + 30, offset: 0, altitudeLevel, speed: 100 };
    const cue = readForkCue(track, s);
    assert.equal(cue.kind, 'vertical'); assert.equal(cue.phase, 'choice'); assert.ok(Math.abs(cue.distance - 30) < 1e-8);
    assert.equal(cue.previewRouteId, routes[altitudeLevel].id);
    s.distance = fork.start + 61; s.routeId = routes[altitudeLevel].id; s.altitudeLevel = 1 - altitudeLevel;
    assert.equal(readForkCue(track, s).selectedRouteId, routes[altitudeLevel].id);
  }
});

for (const challenge of ['easy', 'normal', 'hard']) test(`${challenge}: fixed rise/descend gates and safe upper pad survive randomization`, () => {
  const track = createCatalogTrack(definition, challenge), fork = track.branches[0], expected = layout(track);
  assert.deepEqual(expected.map(a => a.length), [2, 0, 1, 0, 0, 0]);
  assert.deepEqual(expected[0].map(o => o.kind), ['rise', 'descend']);
  assert.ok(expected[0].every(o => o.routeId === fork.routes[0].id && o.motion === undefined));
  assert.equal(expected[2][0].routeId, fork.routes[1].id);
  assert.ok(Math.abs(physicalDistance(track, fork.routes[1].mouthEnd, expected[2][0].distance - fork.routes[1].mouthEnd, fork.routes[1].id) - 130) < 1e-8);
  for (const [i, o] of expected[0].entries())
    assert.ok(Math.abs(physicalDistance(track, fork.routes[0].mouthEnd, o.distance - fork.routes[0].mouthEnd, o.routeId) - (65 + i * 140)) < 1e-8);
  for (const seed of [0, .17, .5, .99]) {
    track.randomizeObstacles(() => seed); assert.deepEqual(layout(track), expected);
    assert.ok(createDrivingModel(track).cores.every(c => c.distance < fork.start - 35 || c.distance > fork.end + 35));
  }
});

for (const challenge of ['easy', 'normal', 'hard']) test(`${challenge}: a single altitude tap selects either route at ordinary and boost speed for every craft`, () => {
  for (const craft of DRONE_CATALOG) for (const boost of [false, true]) for (const level of [0, 1]) {
    const track = createCatalogTrack(definition, challenge), fork = track.branches[0];
    const model = createDrivingModel(track, craft.configuration.performance), s = model.state;
    Object.assign(s, { distance: fork.start - 50, speed: boost ? craft.configuration.performance.boostStage2Speed : craft.configuration.performance.topSpeed,
      altitudeLevel: 1 - level, altitude: track.altitudeProfile.levels[1 - level], targetAltitude: track.altitudeProfile.levels[1 - level] });
    model.step(1 / 60, { ...controls, lift: level ? 1 : -1, boost });
    let previewed = false;
    for (let tick = 0; tick < 600 && s.distance < fork.start + fork.junctionLength + .1; tick++) {
      previewed ||= readForkCue(track, s)?.previewRouteId === fork.routes[level].id;
      model.step(1 / 60, { ...controls, boost });
    }
    const context = `${craft.name} ${challenge} ${boost ? 'boost' : 'ordinary'} ${level}`;
    assert.ok(previewed, context); assert.equal(s.routeId, fork.routes[level].id, context);
    assert.equal(s.collisions, 0, context); assert.equal(s.offTrackExits, 0, context);
    model.step(1 / 60, { ...controls, lift: level ? -1 : 1, boost });
    assert.equal(s.routeId, fork.routes[level].id, `${context}: altitude changes after the entrance keep the selected road`);
  }
});

test('ordinary driving clears the lower height sequence and upper safe route with starter and fastest craft in all difficulties', () => {
  for (const challenge of ['easy', 'normal', 'hard']) for (const craft of [DRONE_CATALOG[0], DRONE_CATALOG[1]]) {
    const track = createCatalogTrack(definition, challenge), fork = track.branches[0];
    for (const [level, route] of fork.routes.entries()) {
      const model = createDrivingModel(track, craft.configuration.performance), s = model.state;
      Object.assign(s, { distance: fork.start + fork.junctionLength + .1, routeId: route.id, speed: 85,
        altitudeLevel: level, altitude: track.altitudeProfile.levels[level], targetAltitude: track.altitudeProfile.levels[level] });
      let sawHigh = false, sawLowAfterHigh = false;
      for (let tick = 0; tick < 60 * 30 && s.distance < fork.end; tick++) {
        model.step(1 / 60, aiDrivingInput(track, craft.configuration, s, 0, []));
        sawHigh ||= s.altitudeLevel === 1;
        sawLowAfterHigh ||= sawHigh && s.altitudeLevel === 0;
      }
      const context = `${craft.name} ${challenge} ${route.id}`;
      assert.ok(s.distance >= fork.end, context); assert.equal(s.collisions, 0, context); assert.equal(s.offTrackExits, 0, context);
      if (level === 0) assert.ok(sawHigh && sawLowAfterHigh, `${context}: both altitude actions were needed`);
    }
  }
});
