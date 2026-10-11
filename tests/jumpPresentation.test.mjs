import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACK_CATALOG } from '../output/test/game/track/trackCatalog.js';
import { createCatalogTrack } from '../output/test/game/track/trackRuntime.js';
import { upcomingTrackJump } from '../output/test/game/track/trackJump.js';
import { createJumpPresentation, jumpFlightPose, jumpCameraPose, JUMP_ORBIT_SECONDS, JUMP_CAMERA_SHOTS } from '../output/test/game/driving/jumpPresentation.js';
import { createDrivingModel } from '../output/test/game/driving/createDrivingModel.js';
import { aiDrivingInput, createRaceSession } from '../output/test/game/driving/createRaceSession.js';
import { createRaceRecords } from '../output/test/game/driving/raceRecords.js';
import { DRONE_CATALOG } from '../output/test/game/drone/droneCatalog.js';

for (const id of ['voltage-yard', 'surface-rush']) {
  const authored = createCatalogTrack(TRACK_CATALOG.find(d => d.id === id), 'easy');
  const t = { ...authored, heightObstacles: [], corridorObstacles: [], mineFields: [], arcRails: [], boostPads: [], boostRings: [] };
  const j = t.jumps[0];
  const cue = d => upcomingTrackJump(t, d, j.routeId);
  test(`${id}: lift and nose pitch have smooth takeoff/landing and repeat on each lap`, () => {
    const at = (u, lap = 0, reduced = false) => { const d = j.start + (j.end - j.start) * u + t.length * lap;
      return jumpFlightPose(cue(d), d, t.length, reduced); };
    for (const lap of [0, 1, 2]) {
      assert.ok(at(0, lap).lift < 1e-10);
      assert.ok(Math.abs(at(.02, lap).lift - 3.25) < 1e-8, 'rise as soon as the road ends');
      assert.ok(Math.abs(at(.04, lap).lift - 6.5) < 1e-8, 'reach the reduced apex during takeoff');
      assert.ok(at(.5, lap).lift < at(.04, lap).lift, 'descend after the early apex');
      assert.ok(at(1, lap).lift < 1e-10);
      assert.ok(at(.02, lap).pitch < 0);
      assert.ok(at(.75, lap).pitch > 0);
    }
    assert.equal(at(.5, 0, true).pitch, 0);
    assert.equal(at(.5, 0, true).lift, 1);
  });
  for (const fps of [30, 60, 120]) test(`${id}: all craft land with slow motion at ${fps}fps, then recover normal time`, () => {
    for (const c of DRONE_CATALOG) {
      const m = createDrivingModel(t, c.configuration.performance), s = m.state, motion = createJumpPresentation();
      Object.assign(s, { routeId: j.routeId, distance: j.approachStart + 1, speed: 70 });
      let real = 0, airReal = 0, airSim = 0, lastScale = 1;
      for (let i = 0; i < fps * 15 && s.distance < j.landingEnd + 100; i++) {
        const current = cue(s.distance);
        lastScale = motion.step(current, 1 / fps, false, s.speed).timeScale;
        const controls = aiDrivingInput(t, c.configuration, s, 1, []);
        const dt = lastScale / fps;
        if (current?.phase === 'airborne') { airReal += 1 / fps; airSim += dt; }
        m.step(dt, controls); real += 1 / fps;
      }
      assert.equal(s.jumpsPassed, 1, c.name);
      assert.equal(s.jumpsMissed, 0, c.name);
      assert.ok(airReal > airSim * 2, `${c.name}: perceptible slow motion`);
      assert.ok(real > s.elapsed);
      assert.equal(lastScale, 1);
    }
  });
  test(`${id}: race clock, rivals and moving hazards receive the same slowed delta`, () => {
    const session = createRaceSession(t, DRONE_CATALOG[0].configuration,
      createRaceRecords({ trackId: id, configurationId: 'jump-test' }), 0, 'competition');
    session.start();
    for (let i = 0; i < 240; i++) session.step(1 / 60, { throttle: true, steer: 0, lift: 0, boost: false, brake: false });
    assert.equal(session.phase, 'running');
    const s = session.model.state;
    Object.assign(s, { routeId: j.routeId, distance: j.start + 1, speed: 70 });
    const motion = createJumpPresentation();
    const old = [s.elapsed, ...session.rivals.map(r => r.controller.model.state.elapsed)], time = t.obstacleTime;
    let simulated = 0;
    for (let i = 0; i < 30; i++) {
      const dt = motion.step(cue(s.distance), 1 / 60, false, s.speed).timeScale / 60;
      session.step(dt, aiDrivingInput(t, DRONE_CATALOG[0].configuration, s, 1, [])); simulated += dt;
    }
    assert.ok(simulated < .3);
    [s.elapsed, ...session.rivals.map(r => r.controller.model.state.elapsed)].forEach((elapsed, i) => assert.ok(Math.abs(elapsed - old[i] - simulated) < 1e-6));
    assert.ok(Math.abs(t.obstacleTime - time - simulated) < 1e-6);
  });
}

test('jump cancellation resets slow motion and landing kick; landing is a single short pulse', () => {
  const m = createJumpPresentation(), jump = { id: 'test' };
  m.step({ phase: 'airborne', jump, distance: 60 }, .2);
  assert.ok(m.step({ phase: 'landing', jump }, .08).landing > .5);
  assert.equal(m.step({ phase: 'landing', jump }, .3).landing, 0);
  m.step({ phase: 'airborne', jump, distance: 60 }, .2); m.reset();
  assert.deepEqual(m.step(null, .016), { timeScale: 1, landing: 0, cameraAge: 0, cameraDuration: JUMP_ORBIT_SECONDS, cameraShot: 'orbit' });
});


test('jump never freezes: movement gradually resumes while the camera turns at constant speed', () => {
  const motion = createJumpPresentation(), jump = { id: 'orbit' }, speed = 80;
  let distance = 60, previousScale = 0, sample;
  for (let i = 1; i <= 240; i++) {
    sample = motion.step({ phase: 'airborne', jump, distance }, 1 / 60, false, speed);
    assert.ok(sample.timeScale > 0, 'no completely stopped frame');
    assert.ok(sample.timeScale >= previousScale - 1e-9, 'gradual time recovery');
    distance = Math.max(0, distance - speed * sample.timeScale / 60);
    previousScale = sample.timeScale;
    assert.ok(Math.abs(sample.cameraAge - i / 60) < 1e-10);
  }
  assert.ok(distance < 1e-8, 'landing aligns with the four-second orbit');
  assert.equal(jumpCameraPose(0).weight, 0, 'continuous handoff starts from the original view');
  assert.ok(jumpCameraPose(1 / 120).weight > 0, 'camera starts moving on the first airborne frame');
  const front = jumpCameraPose(2);
  assert.equal(front.weight, 1);
  assert.ok(front.forward > 8.49);
  assert.ok(Math.abs(front.right) < 1e-6);
  const poses = Array.from({ length: 9 }, (_, i) => jumpCameraPose(i * 4 / 8));
  for (let i = 1; i < poses.length; i++) {
    const a = poses[i - 1], b = poses[i];
    const turn = Math.atan2(a.right * b.forward - a.forward * b.right, a.forward * b.forward + a.right * b.right);
    assert.ok(Math.abs(turn - Math.PI / 4) < 1e-10);
  }
  assert.deepEqual(motion.step({ phase: 'airborne', jump, distance }, 0), sample, 'pause preserves time and camera');
  const landing = jumpCameraPose(JUMP_ORBIT_SECONDS);
  assert.equal(landing.weight, 0);
  assert.ok(landing.forward < -8.49);
  motion.reset();
  assert.equal(motion.step(null, .1).timeScale, 1);
});

for (const speed of [20, 80, 150]) test(`orbit pacing keeps constant camera speed and reaches landing at ${speed}m/s`, () => {
  const motion = createJumpPresentation(), jump = { id: 'paced' };
  let distance = 60, sample;
  for (let i = 0; i < 2000 && distance > 1e-8; i++) {
    sample = motion.step({ phase: 'airborne', jump, distance }, 1 / 120, false, speed);
    assert.ok(sample.timeScale > 0 && sample.timeScale <= 1);
    distance = Math.max(0, distance - speed * sample.timeScale / 120);
  }
  assert.ok(sample.cameraDuration >= 4, 'never a fast orbit, even with boost');
  assert.ok(Math.abs(sample.cameraAge - sample.cameraDuration) < 1 / 120 + 1e-8);
  assert.ok(distance < 1e-8);
});

test('orbit takeoff begins immediately without a sudden sideways camera catch-up', () => {
  const first = jumpCameraPose(1 / 60);
  assert.ok(first.weight > 0);
  assert.ok(Math.abs(first.right * first.weight) < .002, 'first frame stays close to chase view');
  const early = jumpCameraPose(.18);
  assert.ok(early.weight > 0 && early.weight < .25, 'ease into the moving orbit rather than snap to it');
  assert.ok(Math.abs(early.right * early.weight) < .6);
  assert.equal(jumpCameraPose(.55).weight, 1, 'finish the handoff without delaying the orbit');
  const dt = .0001;
  const at = age => jumpCameraPose(age).weight;
  assert.ok(Math.abs((at(dt) - at(0)) / dt) < .001, 'start with negligible blend velocity');
  assert.ok(Math.abs((at(.55) - at(.55 - dt)) / dt) < .001, 'join the orbit with negligible blend velocity');
});

test('reduced motion keeps ordinary slow flight without a freeze or orbit', () => {
  const cue = { phase: 'airborne', jump: { id: 'reduced' }, distance: 60 }, motion = createJumpPresentation();
  assert.ok(motion.step(cue, 1 / 60, true).timeScale > .4);
  assert.equal(motion.step(cue, .2, true).timeScale, .4);
  assert.equal(jumpCameraPose(.6, 4, true).weight, 0);
});

test('bird shot climbs and returns continuously, without a cut or a vertical camera singularity', () => {
  const at = age => jumpCameraPose(age, 4, false, 'bird');
  assert.equal(at(0).weight, 0);
  assert.ok(at(1 / 120).weight > 0, 'climb begins on the first airborne frame');
  assert.equal(at(2.88).weight, 1, 'stay overhead a little longer before returning');
  assert.equal(at(4).weight, 0);
  assert.equal(at(2).weight, 1);
  assert.ok(at(2).up > 20 && Math.abs(at(2).forward) < 3);
  assert.ok(Math.hypot(at(2).forward, at(2).right) > 1, 'camera up stays nonparallel to viewing direction');
  let previous = at(0);
  for (let i = 1; i <= 480; i++) {
    const pose = at(i / 120);
    // Smoothstep's maximum slope is 1.5; the shorter return lasts 1.12s.
    assert.ok(Math.abs(pose.weight - previous.weight) <= 1.5 / (4 * .28) / 120, 'no camera cut');
    assert.ok(Object.values(pose).every(Number.isFinite));
    previous = pose;
  }
});

for (const shot of ['low', 'side']) test(`${shot} shot cuts at takeoff, then restores chase before landing`, () => {
  for (const duration of [4, 6]) {
    const at = age => jumpCameraPose(age, duration, false, shot);
    assert.equal(at(0).weight, 1);
    assert.equal(at(1 / 120).weight, 1);
    assert.equal(at(duration * .889).weight, 1);
    assert.equal(at(duration * .891).weight, 0);
    assert.equal(at(duration).weight, 0);
    const pose = at(duration / 2);
    assert.ok(shot === 'low' ? pose.up < -3 : pose.right > 9 && Math.abs(pose.up) < 2);
    assert.ok(Object.values(pose).every(Number.isFinite));
  }
});

test('random shots cover all four per bag, avoid consecutive repeats and remain stable during flight/pause', () => {
  const motion = createJumpPresentation({ random: () => 0 }), selected = [];
  for (let i = 0; i < 32; i++) {
    const cue = { phase: 'airborne', jump: { id: `jump-${i}` }, distance: 60 };
    const shot = motion.step(cue, 1 / 60).cameraShot;
    selected.push(shot);
    for (const delta of [1 / 60, .1, 0]) assert.equal(motion.step(cue, delta).cameraShot, shot);
    motion.step(null, 1);
  }
  for (let i = 0; i < selected.length; i += 4) assert.deepEqual([...selected.slice(i, i + 4)].sort(), [...JUMP_CAMERA_SHOTS].sort());
  for (let i = 1; i < selected.length; i++) assert.notEqual(selected[i], selected[i - 1]);
});

test('all camera variants use identical simulation pacing; reduced motion suppresses every camera shot', () => {
  const motions = JUMP_CAMERA_SHOTS.map(shot => createJumpPresentation({ shot }));
  const cue = { phase: 'airborne', jump: { id: 'shared' }, distance: 60 };
  for (let i = 0; i < 240; i++) {
    const samples = motions.map(m => m.step(cue, 1 / 60));
    samples.forEach((sample, index) => {
      assert.equal(sample.cameraShot, JUMP_CAMERA_SHOTS[index]);
      assert.equal(sample.timeScale, samples[0].timeScale);
      assert.equal(sample.cameraAge, samples[0].cameraAge);
      assert.equal(jumpCameraPose(sample.cameraAge, sample.cameraDuration, true, sample.cameraShot).weight, 0);
    });
  }
  motions.forEach(m => { m.reset(); assert.equal(m.step(null, .1).cameraAge, 0); });
});

test('local preview can choose each shot on entry, while changes mid-flight wait for the next jump', () => {
  let selected = 'bird';
  const motion = createJumpPresentation({ shot: () => selected });
  const cue = { phase: 'airborne', jump: { id: 'preview' }, distance: 60 };
  assert.equal(motion.step(cue, .1).cameraShot, 'bird');
  selected = 'side';
  assert.equal(motion.step(cue, .1).cameraShot, 'bird');
  motion.reset();
  assert.equal(motion.step(cue, .1).cameraShot, 'side');
});
