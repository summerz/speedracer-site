import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACK_CATALOG } from '../output/test/game/track/trackCatalog.js';
import { createTrackVisual, createTrackFrame } from '../output/test/game/track/createTrack.js';
import { createCatalogTrack } from '../output/test/game/track/trackRuntime.js';
import { createArcRailVisual } from '../output/test/game/track/createArcRailVisual.js';
import { createBoostRingVisual } from '../output/test/game/track/createBoostRingVisual.js';
import { arcGap, arcRailGuide, arcRailHit, boostRingGuide, RING_REACH, stuntSections } from '../output/test/game/track/arcRail.js';
import { ARC_RAILS_PER_TRACK } from '../output/test/game/track/hazardCatalog.js';
import { MINE_LINE_SLOPE } from '../output/test/game/track/mineField.js';
import { physicalDistance, roadPaths } from '../output/test/game/track/trackBranches.js';
import { ALTITUDE_PROFILES } from '../output/test/game/track/altitudeProfile.js';
import { DRONE_CATALOG } from '../output/test/game/drone/droneCatalog.js';
import { createDrivingModel, NEUTRAL_INPUT } from '../output/test/game/driving/createDrivingModel.js';
import { aiDrivingInput } from '../output/test/game/driving/createRaceSession.js';

const seeded = seed => () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const CHALLENGES = ['easy', 'normal', 'hard'], HALF = 1.6;
const key = o => o.routeId ?? '';
const absolute = rail => rail.segments.map(g => ({ start: rail.distance + g.at, end: rail.distance + g.at + g.length, side: g.side, routeId: rail.routeId }));
const stunt = (track, d, routeId) => track.sample(d, undefined, routeId).section !== 'course';
const tally = list => list.reduce((m, o) => m.set(key(o), (m.get(key(o)) ?? 0) + 1), new Map());

test('the electric gap formula crosses a half road at the minefield slope; easy is wider', () => {
  assert.equal(arcGap('normal'), 80); assert.equal(arcGap('hard'), 80); assert.equal(arcGap('easy'), 120);
  assert.ok(arcGap('normal') * MINE_LINE_SLOPE >= 2 * HALF - 1e-9);
  assert.ok(arcRailHit(-1.5, 1) && !arcRailHit(-1.6, 1) && arcRailHit(1.5, -1) && !arcRailHit(1.6, -1) && arcRailHit(8, 1) && arcRailHit(0, -1));
});

test('every rail across the catalog, challenges and 30 runs alternates sides, keeps every gap >= G and stays 30 m inside its stunt section', () => {
  let rails = 0, segments = 0;
  for (const definition of TRACK_CATALOG) for (const challenge of CHALLENGES) {
    const track = createCatalogTrack(definition, challenge), random = seeded(definition.id.length * 11 + challenge.length), G = arcGap(challenge);
    for (let run = 0; run < 30; run++) {
      track.randomizeObstacles(random);
      for (const rail of track.arcRails) {
        rails++;
        for (let d = rail.distance - 30; d <= rail.distance + rail.length + 30; d += 5) assert.ok(stunt(track, d, rail.routeId), `${definition.name}: rail within section +-30 m at ${d | 0}`);
        assert.ok(rail.segments.length >= 1);
        const list = absolute(rail);
        list.forEach((g, i) => {
          segments++;
          assert.ok(g.start >= rail.distance - 1e-6 && g.end <= rail.distance + rail.length + 1e-6, 'segment inside the rail');
          assert.ok(g.end - g.start >= 80 - 1e-6 && g.end - g.start <= 150 / .9, `${definition.name}: segment length ${g.end - g.start}`);
          if (i) {
            assert.equal(g.side, -list[i - 1].side, 'sides alternate');
            const gap = physicalDistance(track, list[i - 1].end, g.start - list[i - 1].end, rail.routeId);
            assert.ok(gap >= G - 1e-6, `${definition.name}/${challenge}: gap ${gap} < ${G}`);
            assert.ok(gap * MINE_LINE_SLOPE >= 2 * HALF - 1e-6, 'a half-to-half switch fits the slope limit');
          }
        });
      }
    }
  }
  assert.ok(rails > 1000 && segments > rails);
});

test('rails per track follow the challenge and rings per path are constant across runs while sides, lengths and switch counts change', () => {
  const firsts = new Set(), lengths = new Set(), counts = new Set(); let withStunts = 0;
  for (const definition of TRACK_CATALOG) for (const challenge of CHALLENGES) {
    const track = createCatalogTrack(definition, challenge), random = seeded(definition.id.length * 5 + challenge.length);
    const rails = track.arcRails.length, rings = tally(track.boostRings);
    if (track.arcRails.length) withStunts++;
    assert.equal(track.arcRails.length, Math.min(ARC_RAILS_PER_TRACK[challenge], stuntSections(track).length), `${definition.name}/${challenge}: rails per track`);
    for (let run = 0; run < 30; run++) {
      track.randomizeObstacles(random);
      assert.equal(track.arcRails.length, rails, `${definition.name}/${challenge}: rails per track`);
      assert.deepEqual(tally(track.boostRings), rings, `${definition.name}/${challenge}: rings per path`);
      for (const rail of track.arcRails) { firsts.add(rail.segments[0].side); counts.add(rail.segments.length); rail.segments.forEach(g => lengths.add(Math.round(g.length))); }
    }
    assert.equal(track.boostKind === 'ring' ? track.boostRings.length > 0 : track.boostRings.length === 0, true, `${definition.name}: rings only on ring tracks`);
  }
  assert.ok(withStunts > TRACK_CATALOG.length * 3 * .8, 'almost every course has stunt sections');
  assert.equal(firsts.size, 2); assert.ok(counts.size >= 2 && lengths.size > 50);
});

test('rings stay in their stunt section, never inside an active danger half (even at the trigger edge) and mostly sit in rail gaps', () => {
  let rings = 0, gapped = 0;
  for (const definition of TRACK_CATALOG) for (const challenge of CHALLENGES) {
    const track = createCatalogTrack(definition, challenge), random = seeded(definition.id.length * 3 + challenge.length);
    for (let run = 0; run < 30; run++) {
      track.randomizeObstacles(random);
      const segments = track.arcRails.flatMap(absolute);
      for (const ring of track.boostRings) {
        assert.equal(ring.radius, 3.5); assert.ok(Math.abs(Math.abs(ring.offset) - track.halfWidth * .45) < 1e-9);
        if (!stunt(track, ring.distance, ring.routeId)) continue; // course rings: see obstacleLayout tests
        rings++;
        for (const d of [-12, 0, 12]) assert.ok(stunt(track, ring.distance + d, ring.routeId), `${definition.name}: ring inside its section`);
        const active = segments.filter(g => (g.routeId ?? '') === key(ring) && ring.distance >= g.start && ring.distance <= g.end);
        if (!active.length) gapped++;
        for (const g of active) for (const edge of [-1, 0, 1]) assert.ok(!arcRailHit(ring.offset + edge * RING_REACH, g.side), `${definition.name}/${challenge}: ring in a danger half`);
      }
    }
  }
  assert.ok(rings > 300 && gapped / rings > .6, `${gapped}/${rings} rings in rail gaps`);
});

const straight = extra => ({ length: 3000, halfWidth: 13, checkpointSpacing: 100, heightObstacles: [], altitudeProfile: ALTITUDE_PROFILES.advanced,
  sample: () => ({ curvature: 0, section: 'course' }), ...extra });
const rail = { distance: 500, length: 700, segments: [{ at: 0, length: 100, side: 1 }, { at: 250, length: 100, side: -1 }, { at: 500, length: 100, side: 1 }] };
const drive = (track, offset, { from = 480, to = 1250, level = 0 } = {}) => {
  const model = createDrivingModel(track), altitude = track.altitudeProfile.levels[level];
  Object.assign(model.state, { distance: from, speed: 90, altitude, targetAltitude: altitude, altitudeLevel: level });
  for (let i = 0; i < 60 * 60 && model.state.distance < to; i++) {
    model.state.offset = offset; model.state.heading = 0;
    model.step(1 / 60, { ...NEUTRAL_INPUT, throttle: true });
  }
  return model;
};

test('a craft on the safe half takes no rail hit; the danger half costs exactly one corridor-style hit per segment per lap at every altitude', () => {
  const track = straight({ arcRails: [rail] });
  for (const level of track.altitudeProfile.levels.keys()) {
    assert.equal(drive(track, -3.1, { level, to: 700 }).state.collisions, 0, 'safe half of segment 1 (danger right)');
    assert.equal(drive(track, 3.1, { level, from: 740, to: 870 }).state.collisions, 0, 'safe half of segment 2 (danger left)');
    assert.equal(drive(track, -1.7, { level, to: 700 }).state.collisions, 0, 'craft edge exactly clear of the centre line');
    const one = drive(track, -1.5, { level, to: 700 }).state;
    assert.equal(one.collisions, 1); assert.equal(one.penaltyPoints, 3);
    const both = drive(track, 0, { level, to: 1250 }).state;
    assert.equal(both.collisions, 3, `level ${level}: three segments, three hits`);
  }
  const model = drive(track, 0, { to: 1250 }), pass = model.state.collisions;
  Object.assign(model.state, { distance: 3000 + 480 });
  for (let i = 0; i < 60 * 60 && model.state.distance < 3000 + 1250; i++) { model.state.offset = 0; model.state.heading = 0; model.step(1 / 60, { ...NEUTRAL_INPUT, throttle: true }); }
  assert.equal(model.state.collisions, pass + 3, 'the next lap hits each segment once again');
  const other = straight({ arcRails: [{ ...rail, routeId: 'elsewhere' }] }), model2 = drive(other, 0);
  assert.equal(model2.state.collisions, 0, 'a rail on another route is ignored');
});

test('a boost ring triggers once per lap, only for a craft centre within radius - .8, adding .3 charge and the pad speed bump', () => {
  const ring = { distance: 700, offset: 5, radius: 3.5 }, track = straight({ arcRails: [], boostRings: [ring] });
  const cross = (model, offset, from) => {
    Object.assign(model.state, { distance: from, offset, speed: 40, charge: .3 }); const before = model.state.boostRings;
    for (let i = 0; i < 600 && model.state.distance < from + 40; i++) { model.state.offset = offset; model.state.heading = 0; model.step(1 / 120, NEUTRAL_INPUT); }
    return model.state.boostRings - before;
  };
  const model = createDrivingModel(track);
  assert.equal(RING_REACH, 2.7);
  assert.equal(cross(model, 0, 680), 0); assert.equal(cross(model, 5 + 2.8, 680), 0);
  assert.equal(cross(model, 5 + 2.6, 680), 1); assert.equal(cross(model, 5, 680), 0, 'same lap');
  assert.equal(cross(model, 5, 3000 + 680), 1, 'next lap'); assert.equal(cross(model, 5, 3000 + 680), 0);
  const fresh = createDrivingModel(track); let before;
  Object.assign(fresh.state, { distance: 690, offset: 5, speed: 40, charge: .3 });
  while (fresh.state.distance < 720) { before = { speed: fresh.state.speed, charge: fresh.state.charge, rings: fresh.state.boostRings }; fresh.step(1 / 120, NEUTRAL_INPUT); if (fresh.state.boostRings > before.rings) break; }
  assert.equal(fresh.state.boostPads, 0);
  assert.ok(Math.abs(fresh.state.charge - before.charge - .3) < .01 && fresh.state.speed - before.speed > 17);
  for (const level of track.altitudeProfile.levels.keys()) {
    const m = createDrivingModel(track), altitude = track.altitudeProfile.levels[level];
    Object.assign(m.state, { altitude, targetAltitude: altitude, altitudeLevel: level }); assert.equal(cross(m, 5, 680), 1, `level ${level}`);
  }
});

const loopTrack = (definition, challenge = 'normal') => TRACK_CATALOG.find(d => d.id === definition) && createCatalogTrack(TRACK_CATALOG.find(d => d.id === definition), challenge);
const bare = track => { Object.assign(track, { corridorObstacles: [], mineFields: [], boostPads: [] }); track.heightObstacles.splice(0); return track; };

test('a headless rival lapping courses with a loop and helix (and a forked helix) takes no rail hit and picks up rings', () => {
  let laps = 0, rings = 0, collisions = 0;
  for (const id of ['reactor-turn', 'coil-foundry']) { // ring tracks; hard puts 2 rails on them
    assert.ok(loopTrack(id, 'hard').arcRails.length >= 2);
    for (let run = 0; run < 8; run++) {
      const track = loopTrack(id, 'hard'), craft = DRONE_CATALOG[run % DRONE_CATALOG.length];
      track.randomizeObstacles(seeded(run * 13 + id.length)); bare(track);
      const model = createDrivingModel(track, craft.configuration.performance);
      for (let i = 0; i < 60 * 300 && model.state.distance < track.length * 2; i++) model.step(1 / 60, aiDrivingInput(track, craft.configuration, model.state, run % 3, []));
      assert.ok(model.state.distance >= track.length * 2, `${id}/${run}: two laps`);
      laps += 2; rings += model.state.boostRings; collisions += model.state.collisions + model.state.offTrackExits;
    }
  }
  assert.equal(collisions, 0, 'zero rail hits per lap');
  assert.ok(rings / laps >= 1, `${rings} rings over ${laps} laps`);
});

test('arc rail HUD cue: 200 m (or 4.5 s) ahead, 0 inside, next switch in the gaps, mirrored sides, and a nearer hazard wins', () => {
  const track = { length: 3000, halfWidth: 13, arcRails: [rail, { distance: 900, length: 100, routeId: 'other', segments: [{ at: 0, length: 100, side: 1 }] }] };
  const guide = (d, offset = 0, speed = 60, hazard = null) => arcRailGuide(track, d, offset, speed, 'main', hazard);
  assert.equal(guide(200), null, '300 m is too early at 60 m/s (270 m)'); assert.deepEqual(guide(300), { distance: 200, side: 1, safe: false });
  assert.equal(guide(300, -3, 60).safe, true); assert.equal(guide(250, 0, 100).distance, 250, '4.5 s at 100 m/s is 450 m');
  assert.equal(guide(520).distance, 0, 'inside segment 1'); assert.equal(guide(520).side, 1);
  assert.deepEqual(guide(620, 3), { distance: 130, side: -1, safe: true }, 'before the switch: the next segment');
  assert.equal(guide(620, 3).side, -1); assert.equal(guide(740, -3).side, -1, 'inside segment 2 the cue shows its danger side');
  assert.equal(guide(1150), null, 'passed; the next lap is far');
  assert.equal(arcRailGuide({ ...track, arcRails: [track.arcRails[1]] }, 880, 0, 60, 'main'), null, 'other route');
  assert.equal(guide(300, 0, 60, 150), null, 'a nearer hazard wins'); assert.equal(guide(300, 0, 60, 250).side, 1);
});

test('boost ring HUD cue: 150 m ahead, side and alignment, and a nearer hazard wins', () => {
  const track = { length: 3000, halfWidth: 13, boostRings: [{ distance: 700, offset: -5.85, radius: 3.5 }, { distance: 1000, offset: 5.85, radius: 3.5, routeId: 'other' }] };
  const guide = (d, offset, hazard = null) => boostRingGuide(track, d, offset, 'main', hazard);
  assert.equal(guide(540, 0), null); assert.deepEqual(guide(600, 0), { distance: 100, side: 'left', safe: false });
  assert.equal(guide(600, -5.85).safe, true); assert.equal(guide(600, -5.85 + 2.6).safe, true); assert.equal(guide(600, -5.85 + 2.8).safe, false);
  assert.equal(guide(600, 0, 80), null); assert.equal(guide(600, 0, 120).side, 'left'); assert.equal(guide(710, 0), null, 'passed ring is a lap away');
  assert.equal(boostRingGuide({ ...track, boostRings: [{ distance: 700, offset: 5.85, radius: 3.5 }] }, 600, 0, 'main').side, 'right');
});

test('arc rail visual follows the road frame through loops, is unlit and over-bright, flickers, flashes, and is static under reduced motion', () => {
  const track = loopTrack('neon-circuit'), visual = createArcRailVisual(track), [strip, floor, wall] = visual.object.children;
  const segment = track.arcRails.find(r => !r.routeId).segments[0], source = track.arcRails.find(r => !r.routeId);
  const frame = createTrackFrame(); track.sample(source.distance + segment.at, undefined); track.sample(source.distance + segment.at, frame);
  const at = (mesh, i) => [0, 1, 2].map(k => mesh.geometry.getAttribute('position').getComponent(i, k));
  const expect = (lat, lift) => ['x', 'y', 'z'].map(k => frame.position[k] + frame.right[k] * lat * segment.side + frame.up[k] * lift);
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-3); // float32 vertices
  assert.ok(near(at(strip, 0), expect(track.halfWidth - 1, .32)) && near(at(strip, 1), expect(track.halfWidth - .1, .32)), 'rail strip along the danger edge');
  assert.ok(near(at(floor, 0), expect(0, .22)) && near(at(wall, 1), expect(0, 1.8)), 'arcs across the half and a curtain on the centre line');
  for (const mesh of [strip, floor, wall]) { assert.ok(mesh.material.toneMapped === false); assert.ok(mesh.material.isShaderMaterial); }
  assert.match(strip.material.fragmentShader, /vec3\(\.5,1\.25,\.1\)/, 'lime rail, only its core above the bloom threshold');
  visual.update(1.5, false); assert.equal(strip.material.uniforms.time.value, 1.5); assert.equal(strip.material.uniforms.amp.value, 1);
  visual.update(1.5, true); assert.equal(strip.material.uniforms.time.value, 0); assert.equal(strip.material.uniforms.amp.value, 0);
  const flash = floor.geometry.getAttribute('flash');
  visual.update(2, false); visual.hit(source.distance + segment.at + 10, source.routeId); visual.update(2, false);
  assert.ok(flash.getX(0) > .99); visual.update(4, false); assert.ok(flash.getX(0) < .01);
  visual.dispose(); assert.equal(visual.object.parent, null);
});

test('boost ring visual: cyan instanced ring facing the road frame at the craft altitude, pulses on hit, static under reduced motion; track visual rebuilds both', () => {
  const track = loopTrack('terrace-flow'), visual = createBoostRingVisual(track), [core, halo, film] = visual.object.children;
  for (const mesh of [core, halo, film]) { assert.equal(mesh.count, track.boostRings.length); assert.ok(mesh.material.toneMapped === false); }
  assert.match(core.material.fragmentShader, /vec3\(\.1,1\.7,1\.6\)/, 'cyan reward colour');
  const ring = track.boostRings[0], frame = createTrackFrame(), matrix = new (core.matrix.constructor)();
  track.sample(ring.distance, frame, ring.routeId); core.getMatrixAt(0, matrix);
  const lift = Math.max(track.altitudeProfile.levels[track.altitudeProfile.initialLevel], ring.radius + .3), p = matrix.elements;
  const expected = ['x', 'y', 'z'].map(k => frame.position[k] + frame.right[k] * ring.offset + frame.up[k] * lift);
  assert.ok(expected.every((v, i) => Math.abs(v - p[12 + i]) < 1e-5), 'centred at the craft altitude on the ring offset');
  assert.ok(Math.abs(p[8] * frame.tangent.x + p[9] * frame.tangent.y + p[10] * frame.tangent.z) > .99, 'ring plane faces along the road');
  const scale = () => { core.getMatrixAt(0, matrix); return Math.hypot(matrix.elements[0], matrix.elements[1], matrix.elements[2]); };
  visual.update(2, false); visual.hit(ring.distance, ring.routeId); visual.update(2, false);
  assert.ok(scale() > 1.25 && core.geometry.getAttribute('flash').getX(0) > .99, 'flash and scale pulse');
  visual.update(4, false); assert.ok(Math.abs(scale() - 1) < .01);
  visual.update(2, true); visual.hit(ring.distance, ring.routeId); visual.update(2, true); assert.ok(Math.abs(scale() - 1) < 1e-6); assert.equal(core.material.uniforms.pulse.value, 0);
  visual.dispose(); assert.equal(visual.object.parent, null);

  const trackVisual = createTrackVisual(track), inGroup = name => trackVisual.object.children.filter(c => c.name === name).length;
  assert.equal(inGroup('arc-rails'), 1); assert.equal(inGroup('boost-rings'), 1);
  track.randomizeObstacles(seeded(4)); trackVisual.refreshObstacles();
  assert.equal(inGroup('arc-rails'), 1); assert.equal(inGroup('boost-rings'), 1);
  trackVisual.hitRing(ring.distance, ring.routeId); trackVisual.hit(track.arcRails[0].distance + 10, track.arcRails[0].routeId); trackVisual.update(1, false);
});
