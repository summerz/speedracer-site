import test from 'node:test';
import assert from 'node:assert/strict';
import { createDriftController, driftStage } from '../output/test/game/driving/drift.js';
import { createDrivingModel, DRIVING_TUNING, NEUTRAL_INPUT } from '../output/test/game/driving/createDrivingModel.js';
import { createTimeAttack } from '../output/test/game/driving/createTimeAttack.js';
import { createRaceSession } from '../output/test/game/driving/createRaceSession.js';
import { createRaceRecords } from '../output/test/game/driving/raceRecords.js';
import { createTouchInput } from '../output/test/game/driving/touchInput.js';
import { createPadReader } from '../output/test/platform/gamepadInput.js';
import { DRONE_CATALOG } from '../output/test/game/drone/droneCatalog.js';
const dt = 1 / 120;
const conditions = { brake: true, steer: .7, speed: 70, ordinarySpeed: 85, curvature: .004, blocked: false };
const input = overrides => ({ ...NEUTRAL_INPUT, brake: true, steer: .7, ...overrides });
const track = overrides => ({ length: 10000, halfWidth: 200, checkpointSpacing: 100, heightObstacles: [], sample: () => ({ curvature: .004 }), ...overrides });
const model = (course = track()) => { const m = createDrivingModel(course, undefined, { drift: true }); m.state.speed = 80; m.state.charge = .2; return m; };
const advance = (m, seconds, controls = input(), fps = 120) => { for (let i = 0; i < Math.round(seconds * fps); i++) m.step(1 / fps, controls); };
function tick(c, seconds, overrides = {}, heading = .1) {
  for (let i = 0; i < Math.round(seconds * 120); i++) {
    if (c.prepare(dt, { ...conditions, ...overrides })) c.finish(0, 1.5);
    c.blend(dt); c.advance(dt, heading);
  }
}
function chargedController(seconds = 2.4) { const c = createDriftController(); tick(c, seconds); return c; }

test('entry requires sustained inside steering, speed, curve and manual control', () => {
  for (const override of [{ brake: false }, { steer: .34 }, { steer: -.7 }, { speed: 19 }, { curvature: 0 }, { curvature: .0014 }, { blocked: true }]) {
    const c = createDriftController(); tick(c, 3, override); assert.equal(c.snapshot().active, false, JSON.stringify(override)); assert.equal(c.snapshot().lastReward, null);
  }
  const c = createDriftController(); tick(c, 17 * dt); assert.equal(c.snapshot().active, false);
  tick(c, dt); assert.equal(c.snapshot().active, true);
  tick(c, 1, {}, .06); assert.equal(c.snapshot().seconds, dt); // Only the entry tick previously had a valid angle.
});

test('stage boundaries and next-stage progress are stable at fixed-step precision', () => {
  for (const [seconds, stage] of [[0,0],[.6-dt,0],[.6,1],[1.2-dt,1],[1.2,2],[2-dt,2],[2,3]]) assert.equal(driftStage(seconds), stage);
  const c = createDriftController(); tick(c, .15 + .3 - dt);
  assert.ok(Math.abs(c.snapshot().stageProgress - .5) < 1e-8);
  tick(c, .3); assert.equal(c.snapshot().stage, 1); assert.ok(c.snapshot().stageProgress < 1e-8);
  tick(c, 2); assert.equal(c.snapshot().stageProgress, 1); assert.equal(c.snapshot().pendingCharge, .15);
});

test('normal exits bank once, cancel retains the earned stage, snapshots stay immutable', () => {
  const c = chargedController(), before = c.snapshot();
  assert.equal(c.finish(1.48, 1.5), 1.5 - 1.48);
  const ended = c.snapshot(); assert.equal(ended.lastReward.stage, 3); assert.equal(ended.lastReward.earnedCharge, .15); assert.equal(ended.lastReward.cancelled, false);
  assert.equal(c.finish(0,1.5), 0); assert.equal(c.snapshot().lastReward.id, 1); assert.equal(before.lastReward, null); assert.equal(before.active, true);
  assert.equal(c.revoke(), 1.5 - 1.48); assert.equal(c.snapshot().lastReward.addedCharge, 0); assert.equal(ended.lastReward.cancelled, false);
  c.reset(); tick(c, 2.4); c.finish(.2, 1.5, true); assert.deepEqual(c.snapshot().lastReward, { id:1, stage:3, earnedCharge:.15, addedCharge:0, cancelled:true });
});

test('release and cooldown are both required to rearm, including a one-tick release', () => {
  const c = chargedController(); tick(c, dt, { brake: false }); const reward = c.snapshot().lastReward;
  tick(c, .24); assert.equal(c.snapshot().active, false);
  tick(c, .16); assert.equal(c.snapshot().active, true); assert.equal(c.snapshot().lastReward, reward);
  tick(c, dt, { blocked: true }); tick(c, 2); assert.equal(c.snapshot().active, false);
  tick(c, dt, { brake: false }); tick(c, .15); assert.equal(c.snapshot().active, true);
});

test('every sustain exit settles and opposing steering ends even if curve reverses', () => {
  for (const override of [{brake:false},{steer:0},{steer:-.7},{steer:-.7,curvature:-.004},{speed:25},{curvature:0},{blocked:true}]) {
    const c = chargedController(); tick(c,dt,override); assert.equal(c.snapshot().active,false); assert.equal(c.snapshot().lastReward.earnedCharge,.15);
  }
});

test('actual heading integration produces slip and reward at 30/60/120 Hz', () => {
  const states = [30,60,120].map(fps => { const m = model(); advance(m,2.4,input(),fps); const active = m.state.drift; advance(m,1/fps,input({brake:false,steer:0,throttle:true}),fps); return { ...m.state, active }; });
  for (const s of states) { assert.equal(s.active.active,true); assert.equal(s.drift.lastReward.stage,3); assert.equal(s.collisions,0); assert.equal(s.offTrackExits,0); assert.ok(Math.abs(s.active.angle)<=.28+1e-8); assert.ok(s.speed>35); assert.equal(s.nearMisses,0); assert.equal(s.cleanStreak,0); assert.equal(s.boostUses,0); }
  assert.ok(Math.max(...states.map(s=>s.active.seconds))-Math.min(...states.map(s=>s.active.seconds))<=dt+1e-8);
  // Compare a common release duration, rather than different render frame lengths.
  const results = [30,60,120].map(fps=>{const m=model();advance(m,2.4,input(),fps);advance(m,.2,input({brake:false,steer:0,throttle:true}),fps);return m.state;});
  for(const s of results.slice(1)) for(const k of ['speed','distance','charge']) assert.ok(Math.abs(s[k]-results[0][k])<1e-7,k);
});

test('plain models retain legacy braking and no drift reward; players opt in, practice opts out', () => {
  const m = createDrivingModel(track()); m.state.speed=80; advance(m,2.4); assert.equal(m.state.drift.active,false); assert.equal(m.state.drift.lastReward,null); assert.equal(m.state.speed,DRIVING_TUNING.crawlSpeed);
  for (const [rules, enabled] of [[{},true],[{practice:true},false],[{drift:false},false]]) {
    const race=createTimeAttack(track(),DRIVING_TUNING,createRaceRecords({trackId:'drift-policy'}),0,rules); race.start();race.step(3,NEUTRAL_INPUT); // Countdown uses bounded stepping.
    for(let i=0;i<40;i++)race.step(.1,NEUTRAL_INPUT);
    race.model.state.speed=80; for(let i=0;i<24;i++)race.step(.1,input());
    assert.equal(race.model.state.drift.active,enabled);
  }
});

test('keyboard, mobile down-diagonal and standard gamepad LT enter the same drift', () => {
  const touch=createTouchInput();touch.pressStick(1);touch.moveStick(1,40,40,40);
  const pad={mapping:'standard',axes:[.75,0],buttons:Array.from({length:16},(_,i)=>({pressed:i===6,value:i===6?1:0}))};
  const controls=[input({steer:1}),input(touch.read(true)),input(createPadReader().read(pad,0,true).snapshot)];
  for(const controlsForDevice of controls){const m=model();advance(m,.4,controlsForDevice);assert.equal(m.state.drift.active,true);assert.equal(m.state.drift.direction,1);}
});

test('drift exit credits before boost starts and still spends at most one battery', () => {
  const m=model();advance(m,2.4);m.state.charge=1.48;
  m.step(dt,input({brake:false,steer:0,boost:true,throttle:true}));
  assert.equal(m.state.drift.lastReward.stage,3);assert.ok(Math.abs(m.state.drift.lastReward.addedCharge-.02)<1e-8);assert.equal(m.state.boostUses,1);
  advance(m,5,input({brake:false,steer:0,boost:true,throttle:true}));assert.equal(m.state.boostNeedsRelease,true);assert.equal(m.state.boosting,false);assert.ok(m.state.charge>=.5-1e-8);
});

test('NPC contact cancels active and same-tick settled drift, preserving aggregate counts', () => {
  for(const release of [false,true]){const m=model();advance(m,2.4);m.state.cleanStreak=4;m.state.bestStreak=4;
    if(release)m.step(dt,input({brake:false,steer:0}));
    const charge=m.state.charge; m.contact();
    assert.equal(m.state.drift.lastReward.cancelled,true);assert.equal(m.state.drift.lastReward.earnedCharge,.15);assert.equal(m.state.drift.lastReward.addedCharge,0);
    assert.ok(Math.abs(m.state.charge-(charge-(release?.15:0)-.02))<1e-8);assert.equal(m.state.collisions,1);assert.equal(m.state.cleanStreak,0);assert.equal(m.state.bestStreak,4);
  }
});

test('obstacle and wall impacts override same-tick release, and off-track clears clean streak', () => {
  for(const kind of ['field','wall','exit']){const course=track(),m=model(course);advance(m,2.4);m.state.cleanStreak=3;
    if(kind==='field')course.heightObstacles.push({distance:m.state.distance+.1,depth:5,minAltitude:100,maxAltitude:110,speedRetention:.8});
    else m.state.offset=course.halfWidth-(kind==='wall'?1: -2);
    m.step(dt,input({brake:false,steer:0}));assert.equal(m.state.drift.lastReward.cancelled,true,kind);assert.equal(m.state.drift.lastReward.addedCharge,0);assert.equal(m.state.cleanStreak,0);
    assert.equal(kind==='exit'?m.state.offTrackExits:m.state.collisions,1);
  }
});

test('later contacts do not revoke an earlier clean reward and recovery/restart cancel current drift', () => {
  const m=model();advance(m,2.4);m.step(dt,input({brake:false,steer:0}));m.step(dt,input({brake:false,steer:0}));m.contact();assert.equal(m.state.drift.lastReward.cancelled,false);
  const r=model();advance(r,2.4);r.recover();assert.equal(r.state.drift.lastReward.cancelled,true);r.reset();assert.equal(r.state.drift.lastReward,null);assert.equal(r.state.drift.active,false);
});

test('awakening settles normally without creating synthetic near-miss or boost events', () => {
  const m=model();advance(m,2.4);m.state.awakeningCores=1;assert.equal(m.useAwakening(),true);assert.equal(m.state.drift.lastReward.cancelled,false);assert.equal(m.state.nearMisses,0);assert.equal(m.state.boostUses,0);
});

test('race pause freezes pending charge, resume settles, finish cancels', () => {
  const race=createTimeAttack(track(),DRIVING_TUNING,createRaceRecords({trackId:'drift-pause'}));race.start();for(let i=0;i<31;i++)race.step(.1,NEUTRAL_INPUT);
  race.model.state.speed=80;for(let i=0;i<24;i++)race.step(.1,input());race.pause();const frozen={...race.model.state};
  for(let i=0;i<50;i++)race.step(.1,input());assert.deepEqual(race.model.state,frozen);
  race.start();race.step(dt,input({brake:false,steer:0}));assert.equal(race.model.state.drift.lastReward.cancelled,false);
  const finish=createTimeAttack(track({length:200}),DRIVING_TUNING,createRaceRecords({trackId:'drift-finish',laps:1}),0,{laps:1});finish.start();for(let i=0;i<31;i++)finish.step(.1,NEUTRAL_INPUT);
  finish.model.state.speed=80;for(let i=0;i<24;i++)finish.step(.1,input());finish.model.state.distance=199.9;finish.step(dt,input({brake:false,steer:0}));assert.equal(finish.phase,'finished');assert.equal(finish.model.state.drift.lastReward.cancelled,true);
});

test('a genuine near miss adds its existing reward independently of drift settlement', () => {
  const course = track(), m = model(course);
  advance(m, 2.3);
  course.heightObstacles.push({ distance: m.state.distance + 1, depth: .1,
    minAltitude: m.state.altitude - .1, maxAltitude: m.state.altitude + 5, speedRetention: .8 });
  const before = m.state.charge;
  advance(m, .15);
  assert.equal(m.state.nearMisses, 1);
  assert.equal(m.state.cleanStreak, 1);
  assert.equal(m.state.obstaclesPassed, 1);
  assert.equal(m.state.drift.active, true);
  assert.ok(m.state.charge >= before + .08);
  m.step(dt, input({ brake: false, steer: 0 }));
  assert.equal(m.state.drift.lastReward.addedCharge, .15);
  assert.equal(m.state.nearMisses, 1);
  assert.equal(m.state.boostUses, 0);
});

test('jump launch settles once and airborne or guided control cannot start a drift', () => {
  const course = track({ altitudeProfile: { levels: [2.4, 5, 7.6], initialLevel: 0, transitionSeconds: .3 } });
  const m = model(course);
  advance(m, 2.4);
  const start = m.state.distance + .1;
  course.jumps = [{ id: 'drift-jump', routeId: null, approachStart: start - 10, start,
    end: start + 50, landingEnd: start + 80, rejoinEnd: start + 90, launchLevel: 0, landingLevel: 0, drop: 1 }];
  m.step(dt, input());
  assert.equal(m.state.drift.lastReward.cancelled, false);
  assert.equal(m.state.drift.lastReward.addedCharge, .15);
  const id = m.state.drift.lastReward.id;
  advance(m, .4, input({ steer: 0 }));
  advance(m, .4);
  assert.equal(m.state.drift.active, false);
  assert.equal(m.state.drift.lastReward.id, id);
  for (const guidance of [{ guidedSpeedScale: .5 }, { guidedOffset: 0 }]) {
    const guided = model();
    advance(guided, 2.4, input(guidance));
    assert.equal(guided.state.drift.lastReward, null);
    assert.equal(guided.state.drift.active, false);
  }
});

test('competition creates drift-enabled player and drift-disabled NPC controllers', () => {
  const config = DRONE_CATALOG[0].configuration;
  const race = createRaceSession(track(), config, createRaceRecords({ trackId: 'drift-npc' }),
    0, 'competition', () => .5);
  const controllers = [race.model, ...race.rivals.map(r => r.controller.model)];
  for (const [i, m] of controllers.entries()) {
    m.state.speed = config.performance.topSpeed * .95;
    advance(m, .5);
    assert.equal(m.state.drift.active, i === 0);
  }
});
