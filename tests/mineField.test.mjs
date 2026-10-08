import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACK_CATALOG } from '../output/test/game/track/trackCatalog.js';
import { createTrackVisual } from '../output/test/game/track/createTrack.js';
import { createRaceGates } from '../output/test/game/track/createRaceGates.js';
import { createCatalogTrack } from '../output/test/game/track/trackRuntime.js';
import { minedTrack } from './fixtures/minedTrack.mjs';
import { createMineFieldVisual } from '../output/test/game/track/createMineFieldVisual.js';
import { CRAFT_HALF_WIDTH, MINE_LINE_SLOPE, createMineField, mineLane, mineLineOffset } from '../output/test/game/track/mineField.js';
import { EXTRA_OBSTACLES, mineFieldGuide } from '../output/test/game/track/obstacleDynamics.js';
import { physicalDistance } from '../output/test/game/track/trackBranches.js';
import { ALTITUDE_PROFILES } from '../output/test/game/track/altitudeProfile.js';
import { DEFAULT_DRONE_CONFIGURATION } from '../output/test/game/drone/droneConfiguration.js';
import { DRONE_CATALOG } from '../output/test/game/drone/droneCatalog.js';
import { createDrivingModel, steeringYawRate, NEUTRAL_INPUT, DRIVING_TUNING } from '../output/test/game/driving/createDrivingModel.js';
import { aiDrivingInput } from '../output/test/game/driving/createRaceSession.js';

const seeded = seed => () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const CHALLENGES = ['easy', 'normal', 'hard'];

/**
 * Independent of the generator: only mines, road width and the slope limit are used. Reachable lateral positions are kept as exact
 * intervals (the 0.25 m grid cannot represent a .04 m/m limit: only "stay" would be legal), advanced in 1 m steps; each step
 * dilates by the slope cap, clips to the road and removes every mine's keep-out band.
 */
function passable(field, halfWidth, slope = MINE_LINE_SLOPE) {
  const bound = halfWidth - CRAFT_HALF_WIDTH;
  let reach = [[-bound, bound]];
  for (let d = 0; d <= field.length; d++) {
    const blocked = field.mines.filter(m => Math.abs(d - m.at) <= m.radius + DRIVING_TUNING.craftHalfLength)
      .map(m => [m.offset - m.radius - CRAFT_HALF_WIDTH, m.offset + m.radius + CRAFT_HALF_WIDTH]).sort((a, b) => a[0] - b[0]);
    const grown = d ? reach.map(([lo, hi]) => [Math.max(-bound, lo - slope), Math.min(bound, hi + slope)]) : reach;
    reach = grown.flatMap(([lo, hi]) => {
      const free = []; let from = lo;
      for (const [a, b] of blocked) { if (b <= from) continue; if (a >= hi) break; if (a > from) free.push([from, a]); from = Math.max(from, b); }
      if (from < hi) free.push([from, hi]);
      return free;
    });
    if (!reach.length) return false;
  }
  return true;
}

test('the safe-line slope limit is half of what the stock craft holds at boost stage 2', () => {
  const p = DEFAULT_DRONE_CONFIGURATION.performance;
  const yaw = steeringYawRate(p.boostStage2Speed, p), sideSlip = Math.tan(yaw / p.lateralBraking);
  assert.ok(Math.abs(yaw - .567) < .001 && Math.abs(sideSlip - .0812) < .0005);
  assert.ok(MINE_LINE_SLOPE <= sideSlip / 2 && MINE_LINE_SLOPE > sideSlip / 2 * .95);
});

test('every generated field has a feasible path, keeps full line clearance and blocks two lanes in every 30 m', () => {
  const sizes = EXTRA_OBSTACLES;
  let fields = 0;
  for (const definition of TRACK_CATALOG) for (const challenge of CHALLENGES) {
    const track = minedTrack(definition, challenge), random = seeded(definition.id.length * 17 + challenge.length);
    for (let run = 0; run < 30; run++) {
      track.randomizeObstacles(random);
      for (const field of track.mineFields) {
        fields++;
        const { length, mines: count, radius } = sizes[challenge].mine;
        assert.equal(field.length, length); assert.equal(field.mines.length, count);
        assert.ok(passable(field, track.halfWidth), `${definition.name}/${challenge}: no path through the field`);
        for (let i = 1; i < field.line.length; i++) {
          assert.ok(Math.abs(field.line[i].offset - field.line[i - 1].offset) / (field.line[i].at - field.line[i - 1].at) <= MINE_LINE_SLOPE + 1e-9, 'line slope');
          assert.ok(Math.abs(field.line[i].offset) <= track.halfWidth - CRAFT_HALF_WIDTH, 'line inside the road');
        }
        assert.equal(field.line[0].at, 0); assert.equal(field.line.at(-1).at, length);
        for (const mine of field.mines) {
          assert.equal(mine.radius, radius);
          assert.ok(Math.abs(mine.offset) + radius <= track.halfWidth, 'mine inside the road');
          assert.ok(mine.at >= 0 && mine.at <= length);
          assert.ok(Math.abs(mine.offset - mineLineOffset(field, mine.at)) >= CRAFT_HALF_WIDTH + radius + 1, `${definition.name}: line clearance`);
        }
        for (let start = 0; start <= length - 30; start++) {
          const lanes = new Set(field.mines.filter(m => m.at >= start && m.at <= start + 30).map(m => mineLane(m.offset, track.halfWidth)));
          assert.ok(lanes.size >= 2, `${definition.name}/${challenge}: window ${start} blocks ${lanes.size} lane(s)`);
        }
      }
    }
  }
  assert.ok(fields > 1000);
});

test('the feasibility check rejects a wall of mines and per-run minefield counts and spacing hold', () => {
  const wall = { length: 20, mines: Array.from({ length: 6 }, (_, i) => ({ at: 10, offset: -12.5 + i * 5, radius: 1.5 })) };
  assert.equal(passable(wall, 14), false);
  for (const definition of TRACK_CATALOG) for (const challenge of CHALLENGES) {
    const track = minedTrack(definition, challenge), random = seeded(definition.id.length * 7 + 3);
    const count = () => JSON.stringify(track.mineFields.map(f => f.routeId ?? '').sort()), base = count();
    for (let run = 0; run < 10; run++) {
      track.randomizeObstacles(random);
      assert.equal(count(), base, `${definition.name}/${challenge}: mine fields per path`);
      const hazards = [...track.heightObstacles.map(o => ({ distance: o.distance, routeId: o.routeId })), ...track.corridorObstacles,
        ...track.mineFields.map(f => ({ distance: f.distance + f.length / 2, routeId: f.routeId, mine: true }))].sort((a, b) => a.distance - b.distance);
      for (const routeId of [null, ...(track.branches ?? []).flatMap(f => f.routes.map(r => r.id))]) {
        const path = hazards.filter(h => !h.routeId || h.routeId === routeId);
        for (let i = 1; i < path.length; i++) if (path[i].mine || path[i - 1].mine)
          assert.ok(physicalDistance(track, path[i - 1].distance, path[i].distance - path[i - 1].distance, routeId) >= 130, `${definition.name}/${challenge}: 130 m from a mine field`);
      }
    }
  }
});

const straight = (field, extra = {}) => ({ length: 3000, halfWidth: 14, checkpointSpacing: 100, heightObstacles: [], mineFields: [field],
  altitudeProfile: ALTITUDE_PROFILES.advanced, sample: () => ({ curvature: 0, section: 'course' }), ...extra });
const randomField = (seed, challenge = 'hard', distance = 600) => createMineField(distance, undefined, EXTRA_OBSTACLES[challenge].mine, 14, seeded(seed));

test('a craft following the line takes no hit; crossing a mine hits at every altitude, once per mine', () => {
  for (const challenge of CHALLENGES) for (let seed = 1; seed <= 10; seed++) {
    const field = randomField(seed, challenge), track = straight(field);
    for (const [level, altitude] of track.altitudeProfile.levels.entries()) {
      const model = createDrivingModel(track);
      Object.assign(model.state, { distance: 500, speed: 155, altitude, targetAltitude: altitude, altitudeLevel: level, boosting: true });
      while (model.state.distance < 600 + field.length + 40) {
        model.state.offset = mineLineOffset(field, Math.max(0, Math.min(field.length, model.state.distance - field.distance))); model.state.heading = 0;
        model.step(1 / 60, { ...NEUTRAL_INPUT, throttle: true, boost: true });
      }
      assert.equal(model.state.collisions, 0, `${challenge}/${seed}/level ${level}`); assert.equal(model.state.obstaclesPassed, 1);
    }
    const mine = field.mines[0];
    for (const [level, altitude] of track.altitudeProfile.levels.entries()) {
      const model = createDrivingModel(track);
      Object.assign(model.state, { distance: field.distance + mine.at - 40, speed: 155, altitude, targetAltitude: altitude, altitudeLevel: level, offset: mine.offset });
      while (model.state.distance < field.distance + mine.at + 3) { model.state.offset = mine.offset; model.state.heading = 0; model.step(1 / 60, { ...NEUTRAL_INPUT, throttle: true, boost: true }); }
      assert.equal(model.state.collisions, 1, `${challenge}/${seed}/level ${level}: one hit`); assert.equal(model.state.penaltyPoints, 3);
      assert.equal(model.state.notice, 'corridor-collision'); assert.equal(model.state.obstaclesPassed, 0);
    }
  }
});

test('a headless rival passes 20 random fields on a straight track without a hit', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const craft = DRONE_CATALOG[seed % DRONE_CATALOG.length], field = randomField(seed * 13, CHALLENGES[seed % 3]), track = straight(field);
    const model = createDrivingModel(track, craft.configuration.performance);
    for (let i = 0; i < 60 * 40 && model.state.distance < field.distance + field.length + 60; i++)
      model.step(1 / 60, aiDrivingInput(track, craft.configuration, model.state, seed % 3, []));
    assert.ok(model.state.distance >= field.distance + field.length + 60, `seed ${seed}: reached the end`);
    assert.equal(model.state.collisions, 0, `seed ${seed} (${craft.name}): collisions`);
    assert.equal(model.state.offTrackExits, 0, `seed ${seed}: off track`);
    assert.equal(model.state.obstaclesPassed, 1, `seed ${seed}: passed`);
  }
});

test('a pad right before a mine field never pulls a rival off its line', () => {
  const craft = DRONE_CATALOG[0], field = randomField(5), pad = { distance: 480, lane: 'left', center: -8, width: 7, length: 14 };
  const track = straight(field, { boostPads: [pad] }), model = createDrivingModel(track, craft.configuration.performance);
  for (let i = 0; i < 60 * 40 && model.state.distance < 720; i++) model.step(1 / 60, aiDrivingInput(track, craft.configuration, model.state, 1, []));
  assert.equal(model.state.collisions, 0); assert.equal(model.state.boostPads, 0);
});

test('the mine field HUD cue appears 250 m (or 3 s) ahead, shows the entry lane only on easy and yields to a nearer hazard', () => {
  const field = { ...randomField(3, 'easy', 1000), routeId: undefined }, track = { length: 3000, halfWidth: 14, mineFields: [field, { ...field, distance: 2000, routeId: 'other' }] };
  const lane = ['left', 'center', 'right'][mineLane(field.line[0].offset, 14)];
  assert.equal(mineFieldGuide(track, 700, 85, 'main'), null, '300 m ahead is too early');
  assert.deepEqual(mineFieldGuide(track, 750, 85, 'main'), { distance: 250, hint: null });
  assert.equal(mineFieldGuide(track, 750, 85, 'main', null, true).hint, lane);
  assert.equal(mineFieldGuide(track, 750, 85, 'main', null, false).hint, null);
  assert.equal(mineFieldGuide(track, 700, 100, 'main').distance, 300, 'three seconds at 100 m/s is 300 m');
  assert.equal(mineFieldGuide(track, 750, 85, 'main', 120), null, 'a nearer corridor or height field wins');
  assert.equal(mineFieldGuide(track, 1000 + field.length + 1, 85, 'main'), null, 'passed field is a lap away');
  assert.equal(mineFieldGuide(track, 1020, 85, 'main').distance, 0, 'inside the field');
  assert.equal(mineFieldGuide(track, 1750, 85, 'main'), null, 'other route field');
});

test('mine field visual: instanced, flickers, flashes on hit, static under reduced motion and disposable', () => {
  const definition = TRACK_CATALOG.find(d => minedTrack(d, 'hard').mineFields.length), track = minedTrack(definition, 'hard');
  const total = track.mineFields.reduce((sum, f) => sum + f.mines.length, 0), visual = createMineFieldVisual(track);
  const [orbs, columns, bands] = visual.object.children;
  assert.equal(orbs.count, total); assert.equal(columns.count, total); assert.equal(bands.count, track.mineFields.length);
  assert.ok(orbs.material.toneMapped === false && columns.material.toneMapped === false);
  visual.update(1.234, false); assert.equal(orbs.material.uniforms.time.value, 1.234);
  visual.update(1.234, true); assert.equal(orbs.material.uniforms.time.value, 0);
  const field = track.mineFields[0], mine = field.mines[0], flash = orbs.geometry.getAttribute('flash');
  visual.update(2, false); visual.hit(field.distance + mine.at, field.routeId); visual.update(2, false);
  assert.ok(flash.getX(0) > .99, 'the mine hit flashes');
  visual.update(4, false); assert.ok(flash.getX(0) < .01, 'and decays');
  visual.dispose(); assert.equal(visual.object.parent, null);

  const trackVisual = createTrackVisual(track), minesIn = () => trackVisual.object.children.filter(c => c.name === 'mine-fields').length;
  assert.equal(minesIn(), 1); track.randomizeObstacles(seeded(2)); trackVisual.refreshObstacles(); assert.equal(minesIn(), 1);
  const gates = createRaceGates(track, 24);
  for (const child of gates.object.children) {
    if (!child.name.startsWith('Checkpoint arch') || !child.visible) continue;
    const distance = Number(child.name.split(' ').at(-1)) * track.length / 24;
    for (const f of track.mineFields) assert.ok(distance < f.distance - 40 - 18 || distance > f.distance + f.length + 18, 'arch clear of the field and its band');
  }
});
