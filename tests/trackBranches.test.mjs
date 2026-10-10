import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACK_CATALOG, DISTRICTS } from '../output/test/game/track/trackCatalog.js';
import { createCatalogTrack, trackMetrics } from '../output/test/game/track/trackRuntime.js';
import { forkAt, selectBranch, roadPaths, roadBoundary, withTrackBranches, physicalDistance, branchChoiceOpen, advanceTrackDistance } from '../output/test/game/track/trackBranches.js';
import { createDrivingModel, NEUTRAL_INPUT } from '../output/test/game/driving/createDrivingModel.js';
import { createTrackFrame, upcomingHeightObstacle } from '../output/test/game/track/createTrack.js';
import { createTimeAttack } from '../output/test/game/driving/createTimeAttack.js';
import { createRaceRecords } from '../output/test/game/driving/raceRecords.js';
import { aiDrivingInput } from '../output/test/game/driving/createRaceSession.js';
import { DRONE_CATALOG } from '../output/test/game/drone/droneCatalog.js';

const definitions = TRACK_CATALOG.filter(d => d.branches?.length);
test('Coil Foundry keeps both complete fork surfaces above ground without folded pavement', () => {
  const definition = TRACK_CATALOG.find(d => d.id === 'coil-foundry');
  for (const challenge of ['easy', 'normal', 'hard']) {
    const track = createCatalogTrack(definition, challenge), fork = track.branches[0];
    for (const route of fork.routes) {
      let previous;
      for (let d = fork.start + fork.junctionLength; d < fork.end - fork.junctionLength; d += .25) {
        const frame = track.sample(d, undefined, route.id), boundary = roadBoundary(track, d, frame, route.id);
        for (const [side, edge] of boundary.edges.entries()) {
          assert.ok(edge.y >= definition.branches[0].groundClearance, `${challenge} ${route.id}: buried pavement at ${d}`);
          if (previous) assert.ok(edge.clone().sub(previous[side]).dot(frame.tangent) > 0, `${route.id}: folded pavement at ${d}`);
        }
        previous = boundary.edges;
      }
    }
  }
});
test('Coil Foundry accepts a short steering choice and carries either route through the merge at cruise and boost speeds', () => {
  const authored = createCatalogTrack(TRACK_CATALOG.find(d => d.id === 'coil-foundry'), 'easy');
  // Isolate junction steering from the separate altitude/hazard decisions.
  const track = { ...authored, heightObstacles: [], corridorObstacles: [], mineFields: [], arcRails: [], boostPads: [], boostRings: [] };
  const fork = track.branches[0], entrance = fork.start + fork.junctionLength;
  for (const speed of [85, 150]) for (const [side, steer] of [[0, -1], [1, 1]]) {
    const model = createDrivingModel(track), state = model.state;
    Object.assign(state, { distance: entrance - 40, speed, offset: 0, heading: 0 });
    for (let tick = 0; tick < 60 * 30 && state.distance < fork.end; tick++) {
      model.step(1 / 60, { ...NEUTRAL_INPUT, throttle: true, boost: speed > 100,
        steer: state.distance < entrance && entrance - state.distance <= state.speed * .2 ? steer : 0 });
      if (state.distance >= entrance && state.distance < fork.end) assert.equal(state.routeId, fork.routes[side].id);
    }
    assert.ok(state.distance >= fork.end, 'reaches the merge');
    assert.equal(state.collisions, 0);
    assert.equal(state.offTrackExits, 0);
  }
});
for (const kind of ['horizontal', 'vertical']) for (const intertwined of [false, true]) {
  test(`${kind} ${intertwined ? 'coil' : 'ordinary'} route begins and ends with a symmetric Y before its own curves`, () => {
    const track = createCatalogTrack(TRACK_CATALOG[0], 'easy');
    Object.assign(track, { length: 1000, branches: [], sample: (d, frame = createTrackFrame()) => {
      frame.position.set(0, 0, -d); frame.tangent.set(0, 0, -1); frame.right.set(1, 0, 0); frame.up.set(0, 1, 0);
      frame.section = 'course'; frame.curvature = 0; frame.distanceScale = 1; return frame;
    } });
    withTrackBranches(track, [{ id: 'test-y', kind, experience: 'reactor', intertwined }]);
    const fork = track.branches[0];
    for (const exit of [false, true]) {
      let separation = 0;
      for (const metres of [10, 25, 45, 70]) {
        const frames = fork.routes.map(route => {
          const travel = exit ? route.length - fork.junctionLength - metres : fork.junctionLength + metres;
          return track.sample(advanceTrackDistance(track, fork.start, travel, route.id), undefined, route.id);
        });
        const axis = 'x', otherAxis = 'y';
        assert.ok(frames[0].position[axis] < 0 && frames[1].position[axis] > 0);
        assert.ok(Math.abs(frames[0].position[axis] + frames[1].position[axis]) < .002, 'both Y arms match');
        assert.ok(Math.abs(frames[0].position[otherAxis]) < .002 && Math.abs(frames[1].position[otherAxis]) < .002, 'no body curve inside Y');
        assert.ok(Math.abs(frames[0].up.x) < .002 && frames[0].up.y > .7, 'no early road roll');
        const gap = frames[1].position[axis] - frames[0].position[axis];
        assert.ok(gap > separation, 'arms open progressively'); separation = gap;
      }
    }
    {
      const boundaries = fork.routes.map(r => {
        const d = advanceTrackDistance(track, fork.start, fork.junctionLength + 3, r.id);
        return roadBoundary(track, d, track.sample(d, undefined, r.id), r.id);
      });
      assert.deepEqual(boundaries.map(b => b.visible), [[true, false], [false, true]]);
      assert.ok(boundaries[0].edges[1].distanceTo(boundaries[1].edges[0]) < 1e-8, 'joined surfaces share one seam');
      const separated = fork.start + fork.junctionLength + 100;
      for (const r of fork.routes) assert.deepEqual(roadBoundary(track, separated, track.sample(separated, undefined, r.id), r.id).visible, [true, true]);
    }
  });
}
test('first two courses introduce both choices and all campaign districts have branches', () => {
  assert.equal(TRACK_CATALOG[0].branches[0].kind, 'horizontal');
  assert.equal(TRACK_CATALOG[1].branches[0].kind, 'vertical');
  assert.equal(new Set(definitions.map(d => d.district)).size, new Set(TRACK_CATALOG.map(track => track.district)).size);
  assert.equal(definitions.length, 26);
});
for (const definition of definitions) test(`${definition.name}: continuous fork geometry, distinct experiences and physical progress`, () => {
  const track = createCatalogTrack(definition, 'easy');
  const metrics = trackMetrics(track);
  assert.ok(metrics.lengthMin > 2300 && metrics.lengthMax < 5800);
  for (const fork of track.branches) {
    assert.notDeepEqual(fork.routes[0].features, fork.routes[1].features);
    const paths = roadPaths(track).filter(p => p.start === fork.start + fork.junctionLength && p.end === fork.end - fork.junctionLength);
    assert.equal(paths.length, fork.routes.length); assert.ok(paths.every(p => p.routeId));
    assert.equal(roadPaths(track).filter(p => p.start <= fork.start + 10 && p.end >= fork.start + 10).length, 1, 'shared entrance drawn once');
    assert.equal(roadPaths(track).filter(p => p.start <= fork.end - 10 && p.end >= fork.end - 10).length, 1, 'shared exit drawn once');
    for (const route of fork.routes) {
      for (const seam of [fork.start, fork.start + fork.junctionLength, fork.end - fork.junctionLength, fork.end]) {
        const before = track.sample(seam-.0001, undefined, route.id), after = track.sample(seam+.0001, undefined, route.id);
        assert.ok(before.position.distanceTo(after.position) < .005);
        assert.ok(before.tangent.dot(after.tangent) > .9999);
        assert.ok(before.up.dot(after.up) > .9999);
      }
      let sampledLength = 0, previous = track.sample(fork.start, undefined, route.id);
      for(let d=fork.start+.1;d<fork.end;d+=.1) {
        const frame = track.sample(d, undefined, route.id);
        sampledLength += previous.position.distanceTo(frame.position);
        assert.ok(frame.up.dot(previous.up) > .95, `abrupt roll: ${route.id} ${d}`);
        assert.ok(Math.abs(frame.up.dot(frame.tangent)) < 1e-6);
        previous=frame;
      }
      sampledLength += previous.position.distanceTo(track.sample(fork.end, undefined, route.id).position);
      assert.ok(Math.abs(sampledLength-route.length) < .1);
      assert.ok(Math.abs(physicalDistance(track, fork.start, fork.end-fork.start, route.id)-route.length) < 1e-6);
      const whole = physicalDistance(track, 0, track.length, route.id);
      assert.ok(Math.abs(physicalDistance(track, track.length-10, track.length+20, route.id)-whole-20) < 1e-6);
      assert.ok(Math.abs(physicalDistance(track, fork.end, -(fork.end-fork.start), route.id) + route.length) < 1e-6);
      for (const from of [fork.start-2, fork.start+fork.junctionLength-2, fork.end-fork.junctionLength-2, fork.end-2, track.length-2]) {
        for (const metres of [1, 5, 90, track.length+10]) {
          const to = advanceTrackDistance(track,from,metres,route.id);
          assert.ok(Math.abs(physicalDistance(track,from,to-from,route.id)-metres)<1e-6);
        }
      }
    }
    if (definition.branches[0].intertwined) {
      const points=fork.routes.map(r=>Array.from({length:61},(_,i)=>track.sample(fork.start+fork.junctionLength+(fork.end-fork.start-fork.junctionLength*2)*(.2+i*.01),undefined,r.id).position));
      for(const a of points[0]) for(const b of points[1]) assert.ok(a.distanceTo(b)>track.halfWidth*2+4,'crossed roads need clearance');
    }
    for(const route of fork.routes) {
      const hazards=[...track.heightObstacles,...track.corridorObstacles??[]].filter(o=>o.routeId===route.id);
      assert.ok(route.cue?.hazards.length === 0 ? hazards.length === 0 : hazards.length > 0, `${definition.name}: ${route.id} matches its advertised hazards`);
      assert.ok(hazards.every(o=>o.distance>fork.start+40 && o.distance<fork.end-40));
    }
  }
});
test('choice locks until merge, resets, and can change on the next lap', () => {
  for(const definition of TRACK_CATALOG.slice(0,2)) {
    const track=createCatalogTrack(definition,'easy'), fork=track.branches[0], model=createDrivingModel(track);
    const state=model.state;
    state.distance=fork.start+fork.junctionLength+.01; state.offset=3; state.altitudeLevel=track.altitudeProfile.levels.length-1;
    model.step(1/120,NEUTRAL_INPUT); assert.equal(state.routeId,fork.routes[1].id);
    state.offset=-3;state.altitudeLevel=0;model.step(1/120,NEUTRAL_INPUT);
    assert.equal(state.routeId,fork.routes[1].id);
    const own=upcomingHeightObstacle(track,state.distance,state.routeId);
    assert.ok(!own.obstacle.routeId || own.obstacle.routeId===state.routeId);
    state.distance=fork.end+.01;model.step(1/120,NEUTRAL_INPUT);assert.equal(state.routeId,null);
    state.distance=track.length+fork.start+fork.junctionLength+.01;model.step(1/120,NEUTRAL_INPUT);assert.equal(state.routeId,fork.routes[0].id);
    model.reset();assert.equal(state.routeId,null);assert.equal(state.distance,0);
    assert.equal(forkAt(track,track.length+fork.start+.01).id,fork.id);
    assert.equal(selectBranch(track,fork.start+.01,-3,0),fork.routes[0].id);
  }
});
for (const definition of definitions) test(`${definition.name}: Y entry and both merge surfaces never fold backwards`, () => {
  const track = createCatalogTrack(definition, 'easy');
  for (const fork of track.branches) for (const route of fork.routes) {
    for (const [start, end] of [[fork.start + fork.junctionLength, route.mouthEnd], [route.mergeStart, fork.end - fork.junctionLength]]) {
      let previous;
      for (let d = start; d <= end; d += .25) {
        const frame = track.sample(d, undefined, route.id);
        const boundary = roadBoundary(track, d, frame, route.id);
        if (previous) for (const [side, edge] of boundary.edges.entries()) {
          assert.ok(edge.clone().sub(previous.edges[side]).dot(frame.tangent) > 0,
            `${route.id}: folded pavement at ${d}, edge ${side}`);
        }
        previous = boundary;
      }
    }
  }
});
test('either choice remains available in the shared entrance without moving the road frame', () => {
  for (const definition of definitions) {
    const track = createCatalogTrack(definition, 'easy'), fork = track.branches[0];
    for (const d of [fork.start + 1, fork.start + 18, fork.start + fork.junctionLength - 1]) {
      const left = track.sample(d, undefined, fork.routes[0].id), right = track.sample(d, undefined, fork.routes[1].id);
      assert.ok(left.position.distanceTo(right.position) < 1e-8, definition.name);
      assert.ok(left.tangent.dot(right.tangent) > .999999);
      assert.ok(left.up.dot(right.up) > .999999);
      assert.equal(branchChoiceOpen(track, d), true);
      const model = createDrivingModel(track), state = model.state;
      state.distance = d; state.offset = fork.authoredLayout ? -6 : -3; state.altitudeLevel = 0;
      model.step(1/120, NEUTRAL_INPUT); assert.equal(state.routeId, fork.routes[0].id);
      state.offset = fork.authoredLayout ? 6 : 3; state.altitudeLevel = track.altitudeProfile.levels.length-1;
      model.step(1/120, NEUTRAL_INPUT); assert.equal(state.routeId, fork.routes[fork.authoredLayout === 'arena-three' ? 2 : 1].id);
      state.offset = fork.authoredLayout ? -6 : -3; state.altitudeLevel = 0;
      model.step(1/120, NEUTRAL_INPUT); assert.equal(state.routeId, fork.routes[0].id);
    }
    assert.equal(branchChoiceOpen(track, fork.start + fork.junctionLength), false);
  }
});
test('boost-speed craft poses stay continuous through choice and merge on either route', () => {
  for (const definition of definitions) {
    const track = createCatalogTrack(definition, 'easy'), fork = track.branches[0];
    const pose = state => {
      const frame = track.sample(state.distance, undefined, state.routeId);
      return { position: frame.position.clone().addScaledVector(frame.right,state.offset).addScaledVector(frame.up,state.altitude),
        tangent: frame.tangent, up: frame.up };
    };
    for (const [side, route] of fork.routes.entries()) for (const seam of [fork.start, fork.start+fork.junctionLength, fork.end-fork.junctionLength, fork.end]) {
      const model = createDrivingModel(track), state = model.state;
      Object.assign(state, { distance: seam-3, offset: route.cue ? (route.cue.choice === 'left' ? -6 : route.cue.choice === 'right' ? 6 : 0) : side ? 3 : -3, routeId: seam===fork.start ? null : route.id,
        speed:155, boostElapsed:3, altitudeLevel: side ? track.altitudeProfile.levels.length-1 : 0 });
      state.altitude = state.targetAltitude = track.altitudeProfile.levels[state.altitudeLevel];
      let previous = pose(state);
      for (let tick=0;tick<12;tick++) {
        const speed = state.speed;
        model.step(1/120, { ...NEUTRAL_INPUT, throttle:true, boost:true });
        const current = pose(state);
        assert.ok(current.position.distanceTo(previous.position) < Math.max(speed,state.speed)/120*1.3+.02,
          `${definition.name} ${route.id} seam ${seam}: craft jumped`);
        assert.ok(current.tangent.dot(previous.tangent) > .998, `${definition.name}: abrupt view direction`);
        assert.ok(current.up.dot(previous.up) > .998, `${definition.name}: abrupt view roll`);
        if (branchChoiceOpen(track,state.distance)) assert.equal(state.routeId,route.id);
        previous=current;
      }
      assert.equal(state.offTrackExits,0,definition.name);
      assert.equal(state.collisions,0,definition.name);
    }
  }
});
test('ordinary AI inputs use every route and still complete three laps without route penalties', () => {
  const craft=DRONE_CATALOG[0];
  for(const definition of definitions) {
    const track=createCatalogTrack(definition,'easy'), routes=new Set();
    const race=createTimeAttack(track,craft.configuration.performance,createRaceRecords({trackId:definition.id,configurationId:craft.name}),0,{laps:3,lapLimit:definition.lapLimit});
    race.start();
    for(let tick=0;tick<definition.lapLimit*3*30+120 && race.phase!=='finished';tick++) {
      race.step(1/30,aiDrivingInput(track,craft.configuration,race.model.state,0,[]));
      if(race.model.state.routeId)routes.add(race.model.state.routeId);
    }
    assert.equal(routes.size,track.branches[0].routes.length,definition.name);
    assert.equal(race.phase,'finished',definition.name);
    assert.equal(race.snapshot().completedLaps,3,definition.name);
    assert.equal(race.snapshot().disqualified,false,definition.name);
    assert.equal(race.model.state.offTrackExits,0,definition.name);
  }
});

const forkSim = (track, fork, speed, steer, leadFrom, from) => {
  const model = createDrivingModel(track), s = model.state, entrance = fork.start + fork.junctionLength;
  Object.assign(s, { distance: from, speed, offset: 0, routeId: null, altitude: track.altitudeProfile.levels[0], targetAltitude: track.altitudeProfile.levels[0] });
  while (s.distance < entrance) {
    model.step(1 / 60, { ...NEUTRAL_INPUT, throttle: true, boost: speed > 100, steer: steer && entrance - s.distance <= leadFrom ? steer : 0 });
    if (s.distance < entrance) var last = s.offset;
  }
  return { offset: last, route: s.routeId };
};
test('horizontal forks: a hands-off craft arrives centred, and all routes are reachable within each fork’s entrance lead at 150 m/s', () => {
  for (const definition of definitions.filter(d => d.branches[0].kind === 'horizontal')) {
    const track = createCatalogTrack(definition, 'normal'), fork = track.branches[0], entrance = fork.start + fork.junctionLength;
    for (const speed of [85, 150]) {
      const idle = forkSim(track, fork, speed, 0, 0, Math.max(0, entrance - 400));
      assert.ok(Math.abs(idle.offset) <= 1, `${definition.name}@${speed}: idle offset ${idle.offset}`);
    }
    for (const [steer, side] of [[-1, 0], [1, 1]]) {
      const lead = fork.authoredLayout ? 60 : 40;
      const taken = forkSim(track, fork, 150, steer, lead, Math.max(0, entrance - 400));
      assert.equal(taken.route, fork.routes[fork.authoredLayout && side === 1 ? 2 : side].id, `${definition.name}: steer ${steer} with ${lead} m lead`);
    }
  }
});
test('vertical forks: the high route starts at floor(levels / 2) for 2, 3 and 4 levels', () => {
  const track = createCatalogTrack(definitions.find(d => d.branches[0].kind === 'vertical'), 'normal'), fork = track.branches[0];
  for (const [count, threshold] of [[2, 1], [3, 1], [4, 2]]) {
    const levels = Array.from({ length: count }, (_, i) => 1.8 + i * 3);
    const profiled = Object.create(track, { altitudeProfile: { value: { ...track.altitudeProfile, levels } } });
    for (let level = 0; level < count; level++)
      assert.equal(selectBranch(profiled, fork.start + 1, 0, level), fork.routes[level >= threshold ? 1 : 0].id, `${count} levels, level ${level}`);
  }
});
