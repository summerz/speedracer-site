import test from 'node:test';
import assert from 'node:assert/strict';
import { expandObstacleLayout, layoutCounts, layoutObstacles } from '../output/test/game/track/obstacleLayout.js';
import { TRACK_CATALOG } from '../output/test/game/track/trackCatalog.js';
import { safePlacement } from '../output/test/game/track/obstacleDynamics.js';
import { physicalDistance } from '../output/test/game/track/trackBranches.js';
import { isAuthoredForkRoute } from '../output/test/game/track/authoredForkLayout.js';
import { createCatalogTrack } from '../output/test/game/track/trackRuntime.js';
import { minedTrack } from './fixtures/minedTrack.mjs';
import { createRaceSession } from '../output/test/game/driving/createRaceSession.js';
import { createRaceRecords } from '../output/test/game/driving/raceRecords.js';
import { DEFAULT_DRONE_CONFIGURATION } from '../output/test/game/drone/droneConfiguration.js';

test('every campaign course has more fields and random safe levels with unchanged counts and types', () => {
  for (const definition of TRACK_CATALOG) {
    const track = createCatalogTrack(definition);
    assert.ok(track.heightObstacles.length + track.corridorObstacles.length + track.mineFields.length > definition.obstacleLevels.length);
    const shape = () => track.heightObstacles.map(o => `${o.routeId}`).sort();
    const kinds = shape();
    assert.ok(track.heightObstacles[0].distance >= 140);
    for (const routeId of [null, ...(track.branches ?? []).flatMap(f => f.routes.map(r => r.id))]) {
      const reachable = track.heightObstacles.filter(o => !o.routeId || o.routeId === routeId);
      for (let i = 1; i < reachable.length; i++) assert.ok(
        physicalDistance(track, reachable[i-1].distance, reachable[i].distance-reachable[i-1].distance, routeId) >= 90,
        `${definition.name}: fields on the same route need 90m clearance`);
    }
    for (const random of [() => 0, () => .5, () => .999]) {
      track.randomizeObstacles(random);
      assert.deepEqual(shape(), kinds);
      const statics = track.heightObstacles.filter(o => !o.motion);
      const band = o => track.altitudeProfile.levels.findIndex(h => h >= o.minAltitude && h <= o.maxAltitude);
      assert.ok(statics.every(o => band(o) >= 0));
      // Authored pilot fields have their own fixed rise/descend sequence.
      const bands = statics.filter(o => !isAuthoredForkRoute(track, o.routeId)).map(band);
      for (let i = 2; i < bands.length; i++) assert.ok(!(bands[i] === bands[i-1] && bands[i] === bands[i-2]), `${definition.name}: three identical levels`);
    }
  }
});

test('straight segments receive extra fields while bends keep the base spacing', () => {
  const authored = Array.from({ length: 6 }, (_, i) => ({ distance: i * 100, depth: 4, minAltitude: 1, maxAltitude: 2 }));
  const road = curvature => ({ length: 4000, sample: () => ({ section: 'course', curvature, tangent: { y: 0 } }) });
  assert.ok(expandObstacleLayout(road(0), authored).length > expandObstacleLayout(road(.01), authored).length);
});

test('session randomizes once on fresh start/restart, shares fields with rivals and preserves pause/resume', () => {
  const track = createCatalogTrack(TRACK_CATALOG[0]);
  const original = track.randomizeObstacles;
  let calls = 0;
  track.randomizeObstacles = random => { calls++; original(random); };
  const session = createRaceSession(track, DEFAULT_DRONE_CONFIGURATION, createRaceRecords({ trackId: 'random-layout', configurationId: 'stock' }), 0, 'competition', () => .5);
  session.start(); assert.equal(calls, 1);
  const bands = track.heightObstacles.map(o => [o.minAltitude, o.maxAltitude]);
  session.pause(); session.start(); assert.equal(calls, 1);
  assert.deepEqual(track.heightObstacles.map(o => [o.minAltitude, o.maxAltitude]), bands);
  session.restart(); assert.equal(calls, 2);
});

test('hard tracks randomize corridor lanes and moving-field phases without triple repeats', () => {
  const seeded = seed => () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const definition = TRACK_CATALOG.find(d => { const t = createCatalogTrack(d, 'hard'); return (t.corridorObstacles?.length ?? 0) >= 3 && t.heightObstacles.some(o => o.motion); });
  assert.ok(definition);
  const track = createCatalogTrack(definition, 'hard'), random = seeded(7);
  const routes = track.corridorObstacles.map(o => o.routeId).sort(), lanes = new Set(), phases = new Set();
  for (let run = 0; run < 20; run++) {
    track.randomizeObstacles(random);
    const corridors = track.corridorObstacles;
    assert.deepEqual(corridors.map(o => o.routeId).sort(), routes);
    corridors.forEach((c, i) => {
      lanes.add(c.lane);
      assert.equal(c.safeCenter, (['left', 'center', 'right'].indexOf(c.lane) - 1) * track.halfWidth * .58);
      if (i >= 2) assert.ok(!(c.lane === corridors[i-1].lane && c.lane === corridors[i-2].lane));
    });
    for (const o of track.heightObstacles.filter(o => o.motion)) {
      const cycle = o.motion.stepSeconds * (track.altitudeProfile.levels.length - 1) * 2;
      assert.ok(o.motion.phase >= 0 && o.motion.phase < cycle);
      phases.add(o.motion.phase);
    }
  }
  assert.ok(lanes.size >= 2);
  assert.ok(phases.size > 1);
});

test('minefields are on hold: catalog layouts have none', () => {
  for (const definition of TRACK_CATALOG) for (const challenge of ['easy', 'normal', 'hard']) {
    const track = createCatalogTrack(definition, challenge);
    track.randomizeObstacles(seeded(3));
    assert.equal(track.mineFields.length, 0, `${definition.name}/${challenge}`);
  }
});

test('mine fields (explicit option) keep a constant per-run count and share, with fresh lines and mines', () => {
  const share = { easy: .1, normal: .2, hard: .25 }, shapes = new Set();
  for (const challenge of ['easy', 'normal', 'hard']) {
    let mines = 0, all = 0;
    for (const definition of TRACK_CATALOG) {
      const track = minedTrack(definition, challenge), random = seeded(definition.id.length + 5);
      const count = () => track.mineFields.length, first = count(), total = first + track.corridorObstacles.length + track.heightObstacles.length;
      mines += first; all += total;
      for (let run = 0; run < 10; run++) {
        track.randomizeObstacles(random);
        assert.equal(count(), first);
        assert.equal(track.mineFields.length + track.corridorObstacles.length + track.heightObstacles.length, total);
        for (const f of track.mineFields) shapes.add(JSON.stringify([f.distance, f.line[0].offset, f.mines.map(m => m.offset)]));
      }
    }
    assert.ok(all > 0 && Math.abs(mines / all - share[challenge]) < .2, `${challenge}: mine share ${mines}/${all}`);
  }
  assert.ok(shapes.size > 100, 'mine fields are re-rolled every run');
});

const seeded = seed => () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const fields = track => [...track.heightObstacles.map(o => ({ o, type: o.motion ? 'moving' : 'static' })), ...(track.corridorObstacles ?? []).map(o => ({ o, type: 'corridor' })),
  ...(track.mineFields ?? []).map(f => ({ o: { routeId: f.routeId, distance: f.distance + f.length / 2, depth: f.length }, type: 'mine' }))];
const countKey = track => JSON.stringify([...layoutCounts(track.heightObstacles, track.corridorObstacles ?? [], track.boostPads ?? [], track.mineFields ?? [], track.boostRings ?? [])].sort());
const trunkTypes = track => fields(track).filter(f => !f.o.routeId).sort((a, b) => a.o.distance - b.o.distance).map(f => ({ static: 's', corridor: 'c', moving: 'v', mine: 'm' })[f.type]).join('');

test('every track re-rolls layout per run: counts per path hold, placement is valid, order changes, density is higher', () => {
  const gaps = { easy: [], normal: [], hard: [] };
  let runs = 0, reordered = 0, risky = 0;
  const padTotals = { easy: 0, normal: 0, hard: 0 }, padRuns = { easy: 0, normal: 0, hard: 0 };
  for (const definition of TRACK_CATALOG) for (const challenge of ['easy', 'normal', 'hard']) {
    const track = createCatalogTrack(definition, challenge), random = seeded(definition.id.length * 31 + challenge.length);
    const counts = countKey(track), baseOrder = trunkTypes(track);
    gaps[challenge].push([track.length, fields(track).length]);
    for (let run = 0; run < 30; run++) {
      track.randomizeObstacles(random);
      const list = fields(track);
      assert.equal(countKey(track), counts, `${definition.name}/${challenge}: per-path counts`);
      for (const { o, type } of list) {
        const fork = o.routeId && track.branches.find(f => f.routes.some(r => r.id === o.routeId));
        if (fork) assert.ok(o.distance >= fork.start + 80 && o.distance <= fork.end - 80, `${definition.name}: route field inside its fork`);
        else assert.ok(o.distance >= 140 && o.distance <= track.length - 120 && !track.branches?.some(f => o.distance >= f.start - 125 && o.distance <= f.end + 100), `${definition.name}: trunk field placement`);
        if (type !== 'static') assert.ok(safePlacement(track, o), `${definition.name}: ${type} placement`);
        else if (!o.routeId) assert.equal(track.sample(o.distance).section, 'course');
      }
      for (const routeId of [null, ...(track.branches ?? []).flatMap(f => f.routes.map(r => r.id))]) {
        const reachable = list.filter(l => !l.o.routeId || l.o.routeId === routeId).sort((a, b) => a.o.distance - b.o.distance);
        for (let i = 1; i < reachable.length; i++) {
          const [a, b] = [reachable[i - 1], reachable[i]], hard = a.type !== 'static' || b.type !== 'static';
          assert.ok(physicalDistance(track, a.o.distance, b.o.distance - a.o.distance, routeId) >= (hard ? 130 : 90), `${definition.name}/${challenge}: ${hard ? 130 : 90}m clearance`);
        }
      }
      for (const routeId of [null, ...(track.branches ?? []).flatMap(f => f.routes.map(r => r.id))]) {
        const path = o => !o.routeId || o.routeId === routeId, pads = [...track.boostPads, ...track.boostRings.filter(r => track.sample(r.distance, undefined, r.routeId).section === 'course')].filter(path);
        const gap = (a, b) => physicalDistance(track, a.distance, b.distance - a.distance, routeId);
        for (const pad of pads) {
          assert.equal(track.sample(pad.distance, undefined, routeId).section, 'course', `${definition.name}: boost on a course slot`);
          if (isAuthoredForkRoute(track, pad.routeId)) {
            assert.equal(pad.width, track.halfWidth); assert.equal(pad.length, 14); assert.equal(pad.center, 0); assert.equal(pad.lane, 'center');
          } else if (pad.lane) assert.ok(pad.width === track.halfWidth * .5 && pad.length === 14 && pad.center === ['left', 'center', 'right'].indexOf(pad.lane) * track.halfWidth * .58 - track.halfWidth * .58);
          else assert.ok(Math.abs(Math.abs(pad.offset) - track.halfWidth * .45) < 1e-9);
          for (const { o } of list.filter(l => path(l.o))) assert.ok(Math.abs(gap(pad, o)) - o.depth / 2 >= 40, `${definition.name}/${challenge}: boost 40 m from field edge`);
          const next = (track.corridorObstacles ?? []).filter(path).find(c => c.distance > pad.distance);
          if (next && gap(pad, next) >= 80 && gap(pad, next) <= 120) {
            risky++;
            if (pad.lane) assert.notEqual(pad.lane, next.lane, `${definition.name}/${challenge}: risk pad leaves the safe lane`);
            else if (next.lane !== 'center') assert.equal(Math.sign(pad.offset), next.lane === 'left' ? 1 : -1, `${definition.name}/${challenge}: risk ring leaves the safe lane`);
          }
        }
        for (let i = 1; i < pads.length; i++) assert.ok(gap(pads[i - 1], pads[i]) >= 120, `${definition.name}/${challenge}: boosts 120 m apart`);
      }
      padTotals[challenge] += track.boostPads.length + track.boostRings.length; padRuns[challenge]++;
      const types = new Set(trunkTypes(track));
      if (types.size > 1) { runs++; if (trunkTypes(track) !== baseOrder) reordered++; }
    }
  }
  assert.ok(risky > 0, 'some pads sit before a corridor');
  assert.ok(padTotals.easy / padRuns.easy > 0 && padTotals.easy / padRuns.easy >= padTotals.hard / padRuns.hard, 'easy has the most boosts');
  assert.ok(reordered / runs >= .5, `${reordered}/${runs} runs changed the trunk order`);
  const average = list => list.reduce((s, [length]) => s + length, 0) / list.reduce((s, [, n]) => s + n, 0);
  assert.ok(average(gaps.easy) <= 450, `easy gap ${average(gaps.easy)}`);
  assert.ok(average(gaps.normal) <= 360, `normal gap ${average(gaps.normal)}`);
  assert.ok(average(gaps.hard) <= 290, `hard gap ${average(gaps.hard)}`);
});

test('moving fields keep a constant per-run count and share, and each path mixes in the target shares', () => {
  const share = { easy: .1, normal: .25, hard: .3 };
  for (const challenge of ['easy', 'normal', 'hard']) {
    let moving = 0, all = 0;
    for (const definition of TRACK_CATALOG) {
      const track = createCatalogTrack(definition, challenge), random = seeded(definition.id.length + 9);
      const count = () => track.heightObstacles.filter(o => o.motion).length, first = count(), total = first + track.corridorObstacles.length + track.heightObstacles.filter(o => !o.motion).length + track.mineFields.length;
      moving += first; all += total;
      for (let run = 0; run < 10; run++) { track.randomizeObstacles(random); assert.equal(count(), first, `${definition.name}/${challenge}`); }
    }
    assert.ok(moving > 0 && Math.abs(moving / all - share[challenge]) < .12, `${challenge}: moving share ${moving}/${all}`);
  }
});

test('layoutObstacles never mutates its input and returns fresh arrays', () => {
  const track = createCatalogTrack(TRACK_CATALOG[0], 'hard');
  const before = JSON.stringify([track.heightObstacles, track.corridorObstacles, track.mineFields]);
  const layout = layoutObstacles(track, 'hard', () => .3, track.heightObstacles[0]);
  assert.equal(JSON.stringify([track.heightObstacles, track.corridorObstacles, track.mineFields]), before);
  assert.notEqual(layout.heights, track.heightObstacles);
});
