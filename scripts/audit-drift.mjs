import assert from 'node:assert/strict';
import { TRACK_CATALOG } from '../output/test/game/track/trackCatalog.js';
import { createCatalogTrack } from '../output/test/game/track/trackRuntime.js';
import { createDrivingModel, steeringYawRate, NEUTRAL_INPUT } from '../output/test/game/driving/createDrivingModel.js';
import { DRONE_CATALOG } from '../output/test/game/drone/droneCatalog.js';

// Isolate authored road physics from obstacle timing. Hazards are covered by drift.test.mjs.
const ids = ['coil-foundry', 'garden-helix', 'trench-entry', 'abyss-flow', 'lagoon-glide', 'surface-rush'];
const clearHazards = track => ({ ...track, heightObstacles: [], corridorObstacles: [], mineFields: [], arcRails: [], boostPads: [], boostRings: [] });
const rows = [];
for (const id of ids) for (const challenge of ['easy', 'normal', 'hard']) {
  const definition = TRACK_CATALOG.find(t => t.id === id);
  const track = clearHazards(createCatalogTrack(definition, challenge));
  const safeCorner = distance => {
    const curvature = track.sample(distance).curvature, sign = Math.sign(curvature);
    return Math.abs(curvature) >= .0016 && Array.from({ length: 45 }, (_, i) => distance + i * 5).every(d => {
      const frame = track.sample(d);
      return Math.sign(frame.curvature) === sign && Math.abs(frame.curvature) >= .0015 && Math.abs(frame.curvature) < .007
        && !(track.branches ?? []).some(b => d >= b.start - 250 && d <= b.end);
    });
  };
  let start = 300;
  while (start < track.length - 220 && !safeCorner(start)) start += 5;
  assert.ok(start < track.length - 220, `${id}: representative corner required`);
  const sign = Math.sign(track.sample(start).curvature);
  for (const craft of DRONE_CATALOG) {
    const performance = craft.configuration.performance;
    const run = enabled => {
      const model = createDrivingModel(track, performance, { drift: enabled });
      const state = model.state, initialOffset = -sign * (track.halfWidth - 3);
      Object.assign(state, { distance: start, speed: performance.topSpeed * .95, offset: initialOffset, charge: .1 });
      let angle = 0;
      // A proportional human-like stick: steer into the bend, then feather toward a modest slip.
      for (let tick = 0; tick < 144; tick++) {
        const frame = track.sample(state.distance);
        const yaw = steeringYawRate(state.speed, performance) * (state.drift.active ? .55 : 1);
        const required = (frame.curvature * state.speed + (sign * .08 - state.heading) * 4) / yaw;
        const steer = sign * Math.min(1, Math.max(state.drift.active ? .2 : .35, Math.abs(required)));
        model.step(1 / 120, { ...NEUTRAL_INPUT, brake: true, steer });
        angle = Math.max(angle, Math.abs(state.heading));
      }
      model.step(1 / 120, NEUTRAL_INPUT);
      assert.ok([state.speed, state.offset, state.heading, state.charge].every(Number.isFinite));
      return { speed: state.speed, angle, lateral: Math.abs(state.offset - initialOffset),
        contacts: state.collisions + state.offTrackExits, reward: state.drift.lastReward?.addedCharge ?? 0 };
    };
    const ordinary = run(false), drift = run(true);
    assert.equal(drift.contacts, 0, `${id}/${challenge}/${craft.name}`);
    assert.equal(drift.reward, .05);
    assert.equal(ordinary.reward, 0);
    assert.ok(drift.speed > ordinary.speed, `${id}/${craft.name}: drift should retain pace`);
    rows.push({ track: definition.name, challenge, craft: craft.name, sign, start, ordinary, drift });
  }
}
let stuntRuns = 0;
for (const id of ['coil-foundry', 'garden-helix', 'lagoon-glide']) {
  const track = clearHazards(createCatalogTrack(TRACK_CATALOG.find(t => t.id === id)));
  for (const section of track.sections.filter(s => s.kind !== 'course' && s.end - s.start > 80)) {
    for (const craft of DRONE_CATALOG) {
      const model = createDrivingModel(track, craft.configuration.performance, { drift: true });
      Object.assign(model.state, { distance: (section.start + section.end) / 2, speed: craft.configuration.performance.topSpeed * .95 });
      for (let i = 0; i < 36; i++) model.step(1 / 120, { ...NEUTRAL_INPUT, brake: true, steer: .7 });
      assert.equal(model.state.drift.active, false, `${id}/${section.kind}: no signed lateral bend`);
      assert.equal(model.state.drift.lastReward, null);
      assert.ok(Number.isFinite(model.state.speed));
      stuntRuns++;
    }
  }
}
if (process.argv.includes('--json')) console.log(JSON.stringify({ rows, stuntRuns }, null, 2));
else {
  console.table(ids.map(id => {
    const name = TRACK_CATALOG.find(t => t.id === id).name, runs = rows.filter(r => r.track === name);
    const range = (key, mode = 'drift') => `${Math.min(...runs.map(r => r[mode][key])).toFixed(2)}–${Math.max(...runs.map(r => r[mode][key])).toFixed(2)}`;
    return { track: name, runs: runs.length, brakeSpeed: range('speed', 'ordinary'), driftSpeed: range('speed'),
      slip: range('angle'), lateral: range('lateral'), contacts: 0, reward: '5%' };
  }));
  console.log(`${rows.length} corner comparisons; ${stuntRuns} helix/vertical-loop isolation runs passed.`);
}
