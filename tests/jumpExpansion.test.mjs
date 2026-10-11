import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACK_CATALOG } from '../output/test/game/track/trackCatalog.js';
import { createCatalogTrack } from '../output/test/game/track/trackRuntime.js';
import { physicalDistance } from '../output/test/game/track/trackBranches.js';
import { jumpPlacementClear, upcomingTrackJump } from '../output/test/game/track/trackJump.js';
import { createDrivingModel } from '../output/test/game/driving/createDrivingModel.js';
import { aiDrivingInput } from '../output/test/game/driving/createRaceSession.js';
import { createJumpPresentation } from '../output/test/game/driving/jumpPresentation.js';
import { DRONE_CATALOG } from '../output/test/game/drone/droneCatalog.js';

const courses = TRACK_CATALOG.filter(d => d.jumps.length);
const challenges = ['easy', 'normal', 'hard'];
const seeded = seed => () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 2 ** 32);

test('optional jumps span all twelve districts, leaving the first course intact', () => {
  assert.equal(courses.length, 17);
  assert.deepEqual([...new Set(courses.map(d => d.district))].sort(), [...new Set(TRACK_CATALOG.map(d => d.district))].sort());
  assert.equal(TRACK_CATALOG[0].jumps.length, 0);
  for (const definition of courses) {
    assert.equal(definition.jumps.length, 1, `${definition.id}: one jump per lap`);
    const track = createCatalogTrack(definition), jump = track.jumps[0];
    const fork = track.branches.find(f => f.routes.some(r => r.id === jump.routeId));
    const route = fork.routes.find(r => r.id === jump.routeId);
    assert.ok(jump.approachStart >= route.mouthEnd && jump.rejoinEnd <= route.mergeStart, definition.id);
    const metres = (a, b) => physicalDistance(track, jump[a], jump[b] - jump[a], jump.routeId);
    assert.ok(Math.abs(metres('approachStart', 'start') - 100) < .02, `${definition.id}: warning`);
    // 60m of the original road, then the 12m world descent; existing slopes/rolls
    // make the measured flight path shorter or longer than the original span.
    assert.ok(metres('start', 'end') >= 55 && metres('start', 'end') < 73, `${definition.id}: gap`);
    assert.ok(Math.abs(metres('end', 'landingEnd') - 50) < .02, `${definition.id}: landing`);
    assert.ok(metres('landingEnd', 'rejoinEnd') >= 60, `${definition.id}: return ramp`);
    const base = createCatalogTrack({ ...definition, jumps: [] });
    for (const alternative of fork.routes.filter(r => r.id !== jump.routeId)) {
      for (let d = fork.start; d <= fork.end; d += 10)
        assert.ok(track.sample(d, undefined, alternative.id).position.distanceTo(base.sample(d, undefined, alternative.id).position) < 1e-8,
          `${definition.id}: ordinary alternative retained`);
    }
  }
});

test('every jump reserves its instruction, gap and landing across randomized hazards and pickups', () => {
  for (const definition of courses) for (const challenge of challenges) {
    const track = createCatalogTrack(definition, challenge), jump = track.jumps[0];
    const counts = () => [track.heightObstacles.length, track.corridorObstacles.length, track.boostPads.length, track.boostRings.length];
    const expected = counts();
    for (let run = 0; run < 12; run++) {
      track.randomizeObstacles(seeded(run + 1));
      assert.deepEqual(counts(), expected, `${definition.id}/${challenge}: stable pickup/field counts`);
      for (const o of [...track.heightObstacles, ...track.corridorObstacles, ...track.boostPads, ...track.boostRings, ...track.mineFields])
        assert.ok(jumpPlacementClear(track, o.distance, o.routeId, (o.depth ?? o.length ?? o.radius ?? 5) / 2),
          `${definition.id}/${challenge}/${run}: reserved ${o.distance}`);
      for (const rail of track.arcRails.filter(r => r.routeId === jump.routeId)) for (const segment of rail.segments) {
        const start = rail.distance + segment.at, end = start + segment.length;
        assert.ok(end < jump.approachStart || start > jump.landingEnd, `${definition.id}/${challenge}/${run}: electric segment`);
      }
    }
  }
});

test('NPCs select each expanded jump route from the common road and land without a jump miss', () => {
  for (const definition of courses) for (const challenge of challenges) {
    const track = createCatalogTrack(definition, challenge), jump = track.jumps[0];
    const fork = track.branches.find(f => f.routes.some(r => r.id === jump.routeId));
    for (const craft of DRONE_CATALOG) {
      const model = createDrivingModel(track, craft.configuration.performance), state = model.state;
      const routeIndex = fork.routes.findIndex(r => r.id === jump.routeId);
      const index = (routeIndex - (craft.configuration.performance.topSpeed > 100 ? 1 : 0) + fork.routes.length) % fork.routes.length;
      Object.assign(state, { distance: fork.start - 120, speed: 65 });
      for (let tick = 0; tick < 60 * 30 && state.distance <= jump.landingEnd + 1; tick++)
        model.step(1 / 60, aiDrivingInput(track, craft.configuration, state, index, []));
      const label = `${definition.id}/${challenge}/${craft.name}`;
      assert.equal(state.routeId, jump.routeId, `${label}: selected jump route`);
      assert.equal(state.jumpsPassed, 1, `${label}: landed`);
      assert.equal(state.jumpsMissed, 0, `${label}: no jump miss`);
    }
  }
});

for (const challenge of challenges) for (const fps of [30, 60, 120]) for (const boost of [false, true]) {
  test(`expanded jumps land with every craft, ${challenge}/${fps}fps/${boost ? 'boost' : 'cruise'}, including slow-motion pacing`, () => {
    for (const definition of courses) {
      const track = createCatalogTrack(definition, challenge), jump = track.jumps[0];
      for (const craft of DRONE_CATALOG) {
        const model = createDrivingModel(track, craft.configuration.performance), state = model.state;
        const motion = createJumpPresentation();
        Object.assign(state, { routeId: jump.routeId, distance: jump.approachStart + 1, speed: 65 });
        let flightFrames = 0;
        for (let tick = 0; tick < fps * 20 && state.distance <= jump.landingEnd + 1; tick++) {
          const cue = upcomingTrackJump(track, state.distance, state.routeId);
          const pose = motion.step(cue, 1 / fps, false, state.speed);
          if (cue?.phase === 'airborne') flightFrames++;
          const input = aiDrivingInput(track, craft.configuration, state, 1, []);
          model.step(pose.timeScale / fps, { ...input, boost });
        }
        const label = `${definition.id}/${craft.name}`;
        assert.ok(state.distance > jump.landingEnd, `${label}: reached landing`);
        assert.equal(state.jumpsPassed, 1, `${label}: pass`);
        assert.equal(state.jumpsMissed, 0, `${label}: miss`);
        assert.equal(state.collisions, 0, `${label}: collision`);
        assert.equal(state.offTrackExits, 0, `${label}: exit`);
        // Feedback uses the previous frame's speed: cruise acceleration can add
        // a short tail after the four-second camera orbit, before touchdown.
        assert.ok(flightFrames / fps >= 3.8 && flightFrames / fps <= 4.25,
          `${label}: full camera duration (${flightFrames / fps}s)`);
      }
    }
  });
}
