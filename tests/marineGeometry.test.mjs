import test from 'node:test';
import assert from 'node:assert/strict';
import { MARINE_TRACK_CATALOG } from '../output/test/game/track/marineTrackCatalog.js';
import { authorClosedTrack } from '../output/test/game/track/trackAuthoring.js';
import { createCatalogTrack } from '../output/test/game/track/trackRuntime.js';
import { measureLayout } from '../scripts/marine-track-metrics.mjs';
import { createDrivingModel } from '../output/test/game/driving/createDrivingModel.js';
import { aiDrivingInput } from '../output/test/game/driving/createRaceSession.js';
import { DRONE_CATALOG } from '../output/test/game/drone/droneCatalog.js';

test('marine loops form tall inverted roads and the trench coil really descends', () => {
  const metrics = MARINE_TRACK_CATALOG.map(measureLayout);
  const loops = metrics.flatMap(t => t.stunts.filter(s => s.kind === 'loop'));
  assert.equal(loops.length, 6);
  for (const loop of loops) {
    assert.ok(loop.heightRange > 230, `loop rises ${loop.heightRange}m`);
    assert.ok(loop.invertedFraction > .25, `inverted road fraction ${loop.invertedFraction}`);
    assert.ok(loop.metres > 800, 'a visible full loop rather than a short bump');
  }
  const descent = metrics.find(t => t.id === 'abyss-flow').stunts[0];
  assert.ok(descent.rise < -90); assert.ok(descent.heightRange > 230);
  assert.ok(metrics.find(t => t.id === 'rift-descent').stunts.at(-1).heightRange > 300);
  for (const stunt of metrics.flatMap(t => t.stunts).filter(s => s.kind !== 'loop')) {
    assert.ok(stunt.invertedFraction > .45 && stunt.invertedFraction < .55);
  }
});

test('new marine footprints generate distinct closed paths rather than falling back to a ring', () => {
  for (const shape of ['crescent', 'slalom', 'diamond']) {
    const layout = { ...MARINE_TRACK_CATALOG.find(t => t.layout.shape === shape).layout, stunts: [] };
    const points = authorClosedTrack(layout), ring = authorClosedTrack({ ...layout, shape: 'ring' });
    const gap = points.reduce((sum, p, i) => sum + p.position.distanceTo(ring[Math.floor(i * ring.length / points.length)].position), 0) / points.length;
    assert.ok(gap > 100, `${shape}: distinct footprint`);
    assert.ok(points[0].position.distanceTo(points.at(-1).position) < 15, `${shape}: closed seam`);
  }
});

test('marine choices expose vertical, three-way hazard, and optional jump routes', () => {
  const tracks = MARINE_TRACK_CATALOG.map(t => createCatalogTrack(t));
  assert.equal(tracks.filter(t => t.branches?.length).length, 7);
  assert.equal(tracks.flatMap(t => (t.branches ?? []).flatMap(f => f.routes)).length, 16);
  const canopy = tracks[5].branches[0];
  assert.equal(canopy.kind, 'vertical');
  assert.deepEqual(canopy.routes.map(r => r.cue.choice), ['lower', 'upper']);
  for (const index of [9, 11]) {
    const routes = tracks[index].branches[0].routes;
    assert.deepEqual(routes.map(r => r.cue.choice), ['left','center','right']);
    assert.deepEqual(routes.map(r => r.cue.hazards), [['height'],['corridor'],[]]);
  }
  const surface = tracks.at(-1), jump = surface.jumps[0];
  assert.equal(jump.routeId, surface.branches[0].routes[1].id);
  assert.notEqual(jump.routeId, surface.branches[0].routes[0].id);
});

test('all craft traverse the new surface jump at cruise and boost speed', () => {
  const authored = createCatalogTrack(MARINE_TRACK_CATALOG.at(-1));
  const track = { ...authored, heightObstacles: [], corridorObstacles: [], mineFields: [], arcRails: [], boostPads: [], boostRings: [], awakeningCores: [] };
  const jump = track.jumps[0];
  for (const craft of DRONE_CATALOG) for (const boost of [false, true]) {
    const model = createDrivingModel(track, craft.configuration.performance), s = model.state;
    Object.assign(s, { routeId: jump.routeId, distance: jump.approachStart + 1, speed: 65 });
    for (let tick = 0; tick < 60 * 35 && s.distance <= jump.landingEnd + 2; tick++) {
      const ai = aiDrivingInput(track, craft.configuration, s, 1, []);
      model.step(1 / 60, { ...ai, boost, lift: 0, throttle: true,
        targetAltitudeLevel: s.distance < jump.start ? jump.launchLevel : jump.landingLevel });
    }
    assert.ok(s.distance > jump.landingEnd, `${craft.name}/${boost}: reaches landing`);
    assert.equal(s.jumpsPassed, 1); assert.equal(s.jumpsMissed, 0);
    assert.equal(s.collisions, 0); assert.equal(s.offTrackExits, 0);
  }
});
