import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACK_CATALOG } from '../output/test/game/track/trackCatalog.js';
import { createCatalogTrack, trackMetrics } from '../output/test/game/track/trackRuntime.js';
import { forkAt, selectBranch, roadPaths, roadBoundary, withTrackBranches, physicalDistance, branchChoiceOpen, advanceTrackDistance } from '../output/test/game/track/trackBranches.js';
import { createDrivingModel, NEUTRAL_INPUT } from '../output/test/game/driving/createDrivingModel.js';
import { createTrackFrame, upcomingHeightObstacle } from '../output/test/game/track/createTrack.js';
import { createTimeAttack } from '../output/test/game/driving/createTimeAttack.js';
import { createRaceRecords } from '../output/test/game/driving/raceRecords.js';
import { aiDrivingInput } from '../output/test/game/driving/createRaceSession.js';
import { DRONE_CATALOG } from '../output/test/game/drone/droneCatalog.js';

const definitions = TRACK_CATALOG.filter(d => d.branches?.length);
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
        const axis = kind === 'horizontal' ? 'x' : 'y', otherAxis = kind === 'horizontal' ? 'y' : 'x';
        assert.ok(frames[0].position[axis] < 0 && frames[1].position[axis] > 0);
        assert.ok(Math.abs(frames[0].position[axis] + frames[1].position[axis]) < .002, 'both Y arms match');
        assert.ok(Math.abs(frames[0].position[otherAxis]) < .002 && Math.abs(frames[1].position[otherAxis]) < .002, 'no body curve inside Y');
        assert.ok(Math.abs(frames[0].up.x) < .002 && frames[0].up.y > .7, 'no early road roll');
        const gap = frames[1].position[axis] - frames[0].position[axis];
        assert.ok(gap > separation, 'arms open progressively'); separation = gap;
      }
    }
    if (kind === 'horizontal') {
      const d = fork.start + fork.junctionLength + 3;
      const boundaries = fork.routes.map(r => roadBoundary(track, d, track.sample(d, undefined, r.id), r.id));
      assert.deepEqual(boundaries.map(b => b.visible), [[true, false], [false, true]]);
      assert.ok(boundaries[0].edges[1].distanceTo(boundaries[1].edges[0]) < 1e-8, 'joined surfaces share one seam');
      const separated = fork.start + fork.junctionLength + 100;
      for (const r of fork.routes) assert.deepEqual(roadBoundary(track, separated, track.sample(separated, undefined, r.id), r.id).visible, [true, true]);
    }
  });
}
test('first two courses introduce both choices and all six districts have branches', () => {
  assert.equal(TRACK_CATALOG[0].branches[0].kind, 'horizontal');
  assert.equal(TRACK_CATALOG[1].branches[0].kind, 'vertical');
  assert.equal(new Set(definitions.map(d => d.district)).size, 6);
  assert.equal(definitions.length, 15);
});
for (const definition of definitions) test(`${definition.name}: continuous fork geometry, distinct experiences and physical progress`, () => {
  const track = createCatalogTrack(definition, 'easy');
  const metrics = trackMetrics(track);
  assert.ok(metrics.lengthMin > 2300 && metrics.lengthMax < 5800);
  for (const fork of track.branches) {
    assert.notDeepEqual(fork.routes[0].features, fork.routes[1].features);
    const paths = roadPaths(track).filter(p => p.start === fork.start + fork.junctionLength && p.end === fork.end - fork.junctionLength);
    assert.equal(paths.length, 2); assert.ok(paths.every(p => p.routeId));
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
      const hazards=track.heightObstacles.filter(o=>o.routeId===route.id);
      assert.ok(hazards.length>0);
      assert.ok(hazards.every(o=>o.distance>fork.start+40 && o.distance<fork.end-40));
    }
    assert.equal(track.heightObstacles.filter(o=>o.routeId===fork.routes[0].id).length,2);
    assert.equal(track.heightObstacles.filter(o=>o.routeId===fork.routes[1].id).length,1);
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
      state.distance = d; state.offset = -3; state.altitudeLevel = 0;
      model.step(1/120, NEUTRAL_INPUT); assert.equal(state.routeId, fork.routes[0].id);
      state.offset = 3; state.altitudeLevel = track.altitudeProfile.levels.length-1;
      model.step(1/120, NEUTRAL_INPUT); assert.equal(state.routeId, fork.routes[1].id);
      state.offset = -3; state.altitudeLevel = 0;
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
      Object.assign(state, { distance: seam-3, offset: side ? 3 : -3, routeId: seam===fork.start ? null : route.id,
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
test('ordinary AI inputs use both routes and still complete three laps without route penalties', () => {
  const craft=DRONE_CATALOG[0];
  for(const definition of definitions) {
    const track=createCatalogTrack(definition,'easy'), routes=new Set();
    const race=createTimeAttack(track,craft.configuration.performance,createRaceRecords({trackId:definition.id,configurationId:craft.name}),0,{laps:3,lapLimit:definition.lapLimit});
    race.start();
    for(let tick=0;tick<definition.lapLimit*3*30+120 && race.phase!=='finished';tick++) {
      race.step(1/30,aiDrivingInput(track,craft.configuration,race.model.state,0,[]));
      if(race.model.state.routeId)routes.add(race.model.state.routeId);
    }
    assert.equal(routes.size,2,definition.name);
    assert.equal(race.phase,'finished',definition.name);
    assert.equal(race.snapshot().completedLaps,3,definition.name);
    assert.equal(race.snapshot().disqualified,false,definition.name);
    assert.equal(race.model.state.offTrackExits,0,definition.name);
    assert.equal(race.model.state.collisions,0,definition.name);
  }
});
