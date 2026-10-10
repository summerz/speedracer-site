import test from 'node:test';
import assert from 'node:assert/strict';
import { auditForks } from '../scripts/fork-audit-lib.mjs';
import { TRACK_CATALOG } from '../output/test/game/track/trackCatalog.js';
import { createCatalogTrack } from '../output/test/game/track/trackRuntime.js';
import { upcomingFork, advanceTrackDistance } from '../output/test/game/track/trackBranches.js';
import { createDrivingModel, NEUTRAL_INPUT } from '../output/test/game/driving/createDrivingModel.js';
import { aiDrivingInput } from '../output/test/game/driving/createRaceSession.js';
import { DRONE_CATALOG } from '../output/test/game/drone/droneCatalog.js';
import { createArcRails, arcGap } from '../output/test/game/track/arcRail.js';

for (const holdAfterLock of [.2, 1.5]) test(`all 39 fork choices accept sustained input with all five craft (${holdAfterLock}s reaction)`, () => {
  const rows = auditForks({ allCraft: true, holdAfterLock });
  assert.equal(rows.length, 39);
  assert.equal(new Set(rows.map(r => r.trackId)).size, 19);
  for (const row of rows) {
    assert.equal(row.runs.length, 30);
    assert.deepEqual(row.failures, [], `${row.routeId}: ${JSON.stringify(row.failures)}`);
    assert.ok(row.peak <= .012, `${row.routeId}: entrance curvature ${row.peak}`);
  }
});

test('first fork is announced across the lap seam', () => {
  const track = createCatalogTrack(TRACK_CATALOG.find(t => t.id === 'window-run'));
  const fork = { ...track.branches[0], start: 95 };
  track.branches = [fork];
  assert.equal(upcomingFork(track, track.length + fork.start - 180, 181)?.id, fork.id);
  assert.equal(upcomingFork(track, track.length + fork.start - 180, 179), undefined);
});

test('starting-grid rivals select a valid first-lap route behind zero', () => {
  const track = createCatalogTrack(TRACK_CATALOG.find(t => t.id === 'window-run'));
  track.branches = [{ ...track.branches[0], start: 95 }];
  const model = createDrivingModel(track);
  model.state.distance = -12;
  for (let index = 0; index < 7; index++) {
    const input = aiDrivingInput(track, DRONE_CATALOG[index % 5].configuration, model.state, index, []);
    assert.ok(Number.isFinite(input.steer));
  }
});

test('forked electric rails leave a lane-switch gap after the Y mouth', () => {
  for (const challenge of ['easy', 'normal', 'hard']) {
    const track = createCatalogTrack(TRACK_CATALOG.find(t => t.id === 'coil-foundry'), challenge);
    for (const roll of [.01, .3, .7, .99]) for (const rail of createArcRails(track, challenge, () => roll)) {
      const route = track.branches[0].routes.find(r => r.id === rail.routeId);
      if (route) assert.ok(rail.distance >= route.mouthEnd + Math.max(120, arcGap(challenge)));
    }
  }
});

test('fork handoff still permits opposing steering and actual wall contacts', () => {
  const authored = createCatalogTrack(TRACK_CATALOG.find(t => t.id === 'arena-ring'));
  const track = { ...authored, heightObstacles: [], corridorObstacles: [], mineFields: [], arcRails: [], boostPads: [], boostRings: [], awakeningCores: [], jumps: [] };
  const fork = track.branches[0], route = fork.routes.at(-1);
  const model = createDrivingModel(track), state = model.state;
  Object.assign(state, { distance: advanceTrackDistance(track, fork.start + fork.junctionLength, 5, route.id), routeId: route.id, speed: 80 });
  for (let i = 0; i < 18; i++) model.step(1 / 60, { ...NEUTRAL_INPUT, throttle: true, steer: -1 });
  assert.ok(state.offset < -1, 'opposite steering remains available for hazard avoidance');
  state.distance = advanceTrackDistance(track, route.mouthEnd, 50, route.id);
  state.offset = track.halfWidth - .2;
  state.altitude = state.targetAltitude = 1;
  model.step(1 / 60, { ...NEUTRAL_INPUT, throttle: true });
  assert.ok(state.collisions > 0, 'a wide craft is not teleported in or made invulnerable');
});
