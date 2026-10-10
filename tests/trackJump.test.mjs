import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACK_CATALOG } from '../output/test/game/track/trackCatalog.js';
import { createCatalogTrack } from '../output/test/game/track/trackRuntime.js';
import { physicalDistance } from '../output/test/game/track/trackBranches.js';
import { upcomingTrackJump, jumpPlacementClear } from '../output/test/game/track/trackJump.js';
import { createJumpTracker } from '../output/test/game/driving/jumpPassage.js';
import { createDrivingModel, NEUTRAL_INPUT } from '../output/test/game/driving/createDrivingModel.js';
import { aiDrivingInput } from '../output/test/game/driving/createRaceSession.js';
import { DRONE_CATALOG } from '../output/test/game/drone/droneCatalog.js';

const definition = TRACK_CATALOG.find(d => d.id === 'voltage-yard');
const authored = createCatalogTrack(definition, 'easy'), jump = authored.jumps[0];
const track = { ...authored, heightObstacles: [], corridorObstacles: [], mineFields: [], arcRails: [], boostPads: [], boostRings: [] };
const levels = track.altitudeProfile.levels;
const pose = (distance, altitude = levels[0], offset = 0, routeId = jump.routeId) => ({ distance, altitude, offset, routeId });

test('only Voltage Yard upper fork has a jump, with measured approach and landing allowance', () => {
  assert.deepEqual(TRACK_CATALOG.filter(d => d.jumps?.length).map(d => d.id), ['voltage-yard']);
  assert.equal(jump.routeId, track.branches[0].routes[1].id);
  const metres = (a, b) => physicalDistance(track, jump[a], jump[b] - jump[a], jump.routeId);
  assert.ok(Math.abs(metres('approachStart', 'start') - 100) < .01);
  assert.ok(metres('start', 'end') >= 60 && metres('start', 'end') < 62);
  assert.ok(Math.abs(metres('end', 'landingEnd') - 50) < .01);
  const base = createCatalogTrack({ ...definition, jumps: [] }, 'easy');
  const lower = track.branches[0].routes[0].id;
  for (let d = track.branches[0].start; d <= track.branches[0].end; d += 5)
    assert.ok(track.sample(d, undefined, lower).position.distanceTo(base.sample(d, undefined, lower).position) < 1e-8);
  const exit = track.branches[0].end;
  assert.ok(track.sample(exit, undefined, jump.routeId).position.distanceTo(base.sample(exit, undefined, jump.routeId).position) < 1e-8);
});

test('jump cues follow the chosen route, actual metres, phase and lap', () => {
  for (const lap of [0, 1, 3]) {
    const d = jump.approachStart + lap * track.length;
    assert.equal(upcomingTrackJump(track, d, null), null);
    assert.equal(upcomingTrackJump(track, d, track.branches[0].routes[0].id), null);
    const cue = upcomingTrackJump(track, d, jump.routeId);
    assert.equal(cue.phase, 'approach'); assert.equal(cue.requiredLevel, jump.launchLevel);
    assert.ok(Math.abs(cue.distance - 100) < .01);
    assert.equal(upcomingTrackJump(track, jump.start + lap * track.length, jump.routeId).phase, 'airborne');
    const landing = upcomingTrackJump(track, jump.end + lap * track.length, jump.routeId);
    assert.equal(landing.phase, 'landing'); assert.equal(landing.requiredLevel, 0);
    assert.equal(upcomingTrackJump(track, jump.landingEnd + 1 + lap * track.length, jump.routeId), null);
  }
});

test('swept jump judgment uses actual altitude, allows landing grace, and records one pass', () => {
  const tracker = createJumpTracker(track);
  assert.deepEqual(tracker.update(pose(jump.start - 1, levels[1]), pose(jump.start + 1, levels[1])), []);
  assert.deepEqual(tracker.update(pose(jump.start + 1, levels[1]), pose(jump.end + 1, levels[1])), []);
  assert.deepEqual(tracker.update(pose(jump.end + 1), pose(jump.landingEnd + 1)), ['landed']);
  assert.deepEqual(tracker.update(pose(jump.start - 1, levels[1]), pose(jump.landingEnd + 1)), []);
});

test('wrong takeoff, landing or lane misses once per lap, even after recovery', () => {
  for (const kind of ['launch', 'landing', 'lane']) {
    const tracker = createJumpTracker(track);
    for (const lap of [0, 1]) {
      const shift = lap * track.length, events = [];
      const launchAltitude = kind === 'launch' ? levels[0] : levels[1];
      const landingAltitude = kind === 'landing' ? levels[1] : levels[0];
      const lane = kind === 'lane' ? track.halfWidth : 0;
      events.push(...tracker.update(pose(jump.start - 1 + shift, launchAltitude, lane), pose(jump.start + 1 + shift, launchAltitude, lane)));
      events.push(...tracker.update(pose(jump.start + 1 + shift, launchAltitude, lane), pose(jump.landingEnd + 1 + shift, landingAltitude, lane)));
      assert.deepEqual(events, ['missed'], kind);
      assert.deepEqual(tracker.update(pose(jump.start - 1 + shift, levels[1]), pose(jump.landingEnd + 1 + shift)), []);
    }
    tracker.reset();
    assert.deepEqual(tracker.update(pose(jump.start - 1), pose(jump.start + 1)), ['missed']);
  }
});

test('wrong route is ignored and awakening can cross safely without altitude/lane judgment', () => {
  const tracker = createJumpTracker(track);
  assert.deepEqual(tracker.update(pose(jump.start - 1, 0, 0, null), pose(jump.landingEnd + 1, 0, 0, null)), []);
  assert.deepEqual(tracker.update(pose(jump.start - 1, 0, 100), pose(jump.landingEnd + 1, 0, 100), true), ['landed']);
});

test('an altitude change started too late is judged at the swept takeoff position', () => {
  const tracker = createJumpTracker(track);
  assert.deepEqual(tracker.update(pose(jump.start - 1, levels[0]), pose(jump.start + 1, levels[1])), ['missed']);
});

function runJump(craft, fps, mode, wrongAltitude = false) {
  const model = createDrivingModel(track, craft.configuration.performance), s = model.state;
  Object.assign(s, { routeId: jump.routeId, distance: jump.approachStart + 1, speed: mode === 'slow' ? 8 : 65 });
  if (mode === 'awakening') { s.awakeningCores = 1; assert.equal(model.useAwakening(), true); }
  for (let tick = 0; tick < fps * 35 && s.distance <= jump.landingEnd + 2; tick++) {
    const ai = aiDrivingInput(track, craft.configuration, s, 1, []);
    const input = mode === 'npc' || mode === 'awakening' ? ai : {
      ...ai, lift: 0, throttle: true, boost: mode === 'boost',
      brake: mode === 'brake' && s.distance < jump.start && s.speed > 18,
      targetSpeedScale: mode === 'slow' ? .25 : 1,
      targetAltitudeLevel: wrongAltitude ? 0 : s.distance < jump.start ? jump.launchLevel : jump.landingLevel,
    };
    model.step(1 / fps, input);
  }
  assert.ok(s.distance > jump.landingEnd, `${craft.name}/${fps}/${mode}: reaches landing`);
  return s;
}

for (const fps of [30, 60, 120]) for (const mode of ['cruise', 'boost', 'brake', 'slow', 'npc', 'awakening']) {
  test(`all craft can launch and land at ${fps}fps (${mode})`, () => {
    for (const craft of DRONE_CATALOG) {
      const s = runJump(craft, fps, mode);
      assert.equal(s.jumpsPassed, 1, `${craft.name}: pass`);
      assert.equal(s.jumpsMissed, 0, `${craft.name}: miss`);
      assert.equal(s.collisions, 0, `${craft.name}: collision`);
      assert.equal(s.offTrackExits, 0, `${craft.name}: exit`);
    }
  });
}

test('failed jump slows the craft and counts one collision without resetting distance', () => {
  const s = runJump(DRONE_CATALOG[0], 60, 'cruise', true);
  assert.equal(s.jumpsPassed, 0); assert.equal(s.jumpsMissed, 1);
  assert.equal(s.collisions, 1); assert.equal(s.recoveries, 0);
  assert.ok(s.penaltyPoints > 0); assert.ok(s.speed > 0);
});

test('NPCs finish three real laps and follow the upper jump route on every challenge', () => {
  for (const challenge of ['easy', 'normal', 'hard']) for (const craft of DRONE_CATALOG) {
    const t = createCatalogTrack(definition, challenge), model = createDrivingModel(t, craft.configuration.performance), s = model.state;
    for (let tick = 0; tick < 60 * 400 && s.distance < t.length * 3; tick++)
      model.step(1 / 60, aiDrivingInput(t, craft.configuration, s, 0, []));
    assert.ok(s.distance >= t.length * 3, `${challenge}/${craft.name}: finish`);
    assert.ok(s.jumpsPassed >= 1, `${challenge}/${craft.name}: chose upper route`);
    assert.equal(s.jumpsMissed, 0, `${challenge}/${craft.name}: safe jump`);
  }
});

function seeded(seed) { return () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 2 ** 32); }
test('random fields and pickups leave the entire jump decision and landing clear', () => {
  for (const challenge of ['easy', 'normal', 'hard']) {
    const t = createCatalogTrack(definition, challenge), count = () => t.heightObstacles.length + t.corridorObstacles.length + t.boostPads.length + t.boostRings.length;
    const expected = count();
    for (let run = 0; run < 20; run++) {
      t.randomizeObstacles(seeded(run + 1)); assert.equal(count(), expected);
      for (const o of [...t.heightObstacles, ...t.corridorObstacles, ...t.boostPads, ...t.boostRings])
        assert.ok(jumpPlacementClear(t, o.distance, o.routeId, (o.depth ?? o.length ?? o.radius ?? 5) / 2), `${challenge}/${run}: ${o.distance}`);
    }
    assert.equal(jumpPlacementClear(t, jump.start, jump.routeId), false);
    assert.equal(jumpPlacementClear(t, jump.start, t.branches[0].routes[0].id), true);
  }
});
