import test from 'node:test';
import assert from 'node:assert/strict';
import { initialProgress, applyCommand, validateProgress } from '../output/test/game/progression/progress.js';
import { createRaceSession } from '../output/test/game/driving/createRaceSession.js';
import { createRaceRecords } from '../output/test/game/driving/raceRecords.js';
import { createTrack } from '../output/test/game/track/createTrack.js';
import { DEFAULT_DRONE_CONFIGURATION as config } from '../output/test/game/drone/droneConfiguration.js';
const competition = 'competition';
const input = { throttle: true, brake: false, steer: 0, lift: 0, boost: false };
const straight = { ...createTrack(), length: 5000, halfWidth: 14, checkpointSpacing: 25, heightObstacles: [], sample: () => ({ curvature: 0 }) };
const make = (slots = ['time-stop', 'interference'], focus = 0) => createRaceSession(straight, config, createRaceRecords({trackId:'items',configurationId:'test'}), focus, competition, () => .999, 'desktop', {}, undefined, slots);
const advance = (race, time, fps = 120) => { for (let tick = 0; tick < Math.round(time * fps); tick++) race.step(1 / fps, input); };
const started = slots => { const race = make(slots); race.start(); advance(race, 3); return race; };
const funded = () => ({...initialProgress(), balance: 2000});

test('existing profiles migrate AI inventories without losing ownership, balance or receipts', () => {
  const old = funded(); delete old.rivalInventory; delete old.rivalSlots; delete old.rivalUses;
  const restored = validateProgress(old);
  assert.equal(restored.balance,2000); assert.deepEqual(restored.owned, old.owned);
  assert.deepEqual(restored.rivalInventory, {'time-stop':0,interference:0});
  assert.deepEqual(restored.rivalSlots, []);
});

test('AI purchases and equipment require competition, share the two-charge limit, and charge fixed prices', () => {
  let p = funded();
  assert.throws(() => applyCommand(p,{kind:'rival-buy',item:'time-stop',mode:'time-attack'}));
  p = applyCommand(p,{kind:'rival-buy',item:'time-stop',mode:competition});
  p = applyCommand(p,{kind:'rival-buy',item:'interference',mode:competition});
  assert.equal(p.balance,1780);
  assert.throws(() => applyCommand(p,{kind:'rival-slots',slots:['time-stop'],mode:'time-attack'}));
  assert.throws(() => applyCommand(p,{kind:'rival-slots',slots:['time-stop','time-stop'],mode:competition}));
  p = applyCommand(p,{kind:'rival-slots',slots:['time-stop','interference'],mode:competition});
  p = applyCommand(p,{kind:'focus'});
  assert.throws(() => applyCommand(p,{kind:'slots',count:1}));
  assert.throws(() => applyCommand(p,{kind:'rival-slots',slots:['time-stop','interference','time-stop'],mode:competition}));
  assert.throws(() => applyCommand(p,{kind:'rival-buy',item:'unknown',mode:competition}));
});

test('AI reservations consume once, refund only unused activations and retain confirmed usage', () => {
  let p = applyCommand(funded(),{kind:'rival-buy',item:'time-stop',mode:competition});
  const use = {kind:'consume-rival',item:'time-stop',id:'race:1',mode:competition};
  p = applyCommand(p,use); assert.equal(p.rivalInventory['time-stop'],0);
  assert.deepEqual(applyCommand(p,use),p);
  assert.throws(() => applyCommand(p,{...use,item:'interference'}));
  p = applyCommand(p,{kind:'refund-rival',id:use.id}); assert.equal(p.rivalInventory['time-stop'],1);
  assert.deepEqual(applyCommand(p,{kind:'refund-rival',id:use.id}),p);
  p = applyCommand(p,{...use,id:'race:2'});
  p = applyCommand(p,{kind:'confirm-rival',id:'race:2'});
  assert.deepEqual(applyCommand(p,{kind:'refund-rival',id:'race:2'}),p);
  assert.throws(() => applyCommand(p,{...use,id:'race:3'}));
  assert.throws(() => applyCommand(p,{...use,mode:'time-attack'}));
});

test('pending AI charges reserve capacity and malformed saves are rejected', () => {
  let p = funded(); p.rivalInventory['time-stop'] = 99;
  p = applyCommand(p,{kind:'consume-rival',item:'time-stop',id:'pending',mode:competition});
  assert.throws(() => applyCommand(p,{kind:'rival-buy',item:'time-stop',mode:competition}));
  assert.equal(applyCommand(p,{kind:'refund-rival',id:'pending'}).rivalInventory['time-stop'],99);
  for (const change of [q=>q.rivalInventory['time-stop']=-1,q=>q.rivalInventory.interference=.5,q=>q.rivalSlots=['unknown'],q=>q.rivalUses.bad={item:'time-stop',state:'bad'}]) {
    const malformed = funded(); change(malformed); assert.throws(() => validateProgress(malformed));
  }
});

test('time stop freezes all running rivals for one real second while player and clocks continue', () => {
  const race = started();
  race.rivals.forEach((p,i)=> { p.controller.model.state.distance = 100 + i*200; });
  const before = race.rivals.map(p=>({...p.controller.model.state}));
  assert.equal(race.useRivalItem('time-stop'),true);
  assert.equal(race.snapshot().assisted,true);
  assert.equal(race.useRivalItem('interference'),false);
  advance(race,.5);
  for (let i=0;i<3;i++) {
    assert.equal(race.rivals[i].controller.model.state.distance,before[i].distance);
    assert.ok(Math.abs(race.rivals[i].controller.model.state.elapsed-before[i].elapsed-.5)<1e-8);
  }
  assert.ok(race.model.state.distance > 0);
  race.pause(); const paused = race.snapshot(); advance(race,2); assert.deepEqual(race.snapshot(),paused);
  race.start(); advance(race,.5);
  assert.ok(race.rivals.every((p,i)=>p.controller.model.state.distance===before[i].distance));
  advance(race,.1); assert.ok(race.rivals.every((p,i)=>p.controller.model.state.distance>before[i].distance));
  assert.equal(race.snapshot().items.find(p=>p.id==='time-stop').remaining,0);
});

test('interference targets only nearest two rivals ahead within 180m, and no target consumes nothing', () => {
  const race = started(['interference','interference']);
  const distance = race.model.state.distance;
  race.rivals.forEach(p=>{p.controller.model.state.distance = distance - 20;});
  assert.equal(race.useRivalItem('interference'),false);
  assert.equal(race.snapshot().items.find(p=>p.id==='interference').remaining,2);
  race.rivals.forEach((p,i)=>{p.controller.model.state.distance = distance + [120,40,80][i];});
  assert.equal(race.useRivalItem('interference'),true);
  assert.deepEqual(race.rivals.map(p=>p.effects.jam),[0,3,3]);
  advance(race,3); assert.ok(race.rivals.every(p=>p.effects.jam<1e-8));
  race.rivals.forEach((p,i)=>{p.controller.model.state.distance = race.model.state.distance + (i===0 ? 181 : -20);});
  assert.equal(race.useRivalItem('interference'),false);
});

test('jammed AI slows without slowing race time and effect expiration is independent of rendering frequency', () => {
  const results = [30,60,120].map(fps=>{
    const race = started(['interference']); advance(race,2,fps);
    const d = race.model.state.distance;
    race.rivals.forEach((p,i)=>{p.controller.model.state.distance=d+40+i*40; p.controller.model.state.speed=100;});
    race.useRivalItem('interference'); const elapsed = race.rivals[0].controller.model.state.elapsed;
    advance(race,3,fps);
    assert.ok(Math.abs(race.rivals[0].controller.model.state.elapsed - elapsed - 3)<1e-7);
    assert.ok(race.rivals[0].controller.model.state.speed < race.rivals[2].controller.model.state.speed);
    assert.ok(race.rivals.every(p=>p.effects.jam<1e-8));
    return race.rivals.map(p=>p.controller.model.state.distance);
  });
  results[0].forEach((distance,i)=>assert.ok(Math.abs(distance-results[2][i])<1e-6));
});

test('focus and rival items share cooldown and restart clears effects', () => {
  const race = make(['time-stop'],1); race.start(); advance(race,3);
  assert.equal(race.useFocus(),true); assert.equal(race.useRivalItem('time-stop'),false);
  advance(race,3); assert.equal(race.useRivalItem('time-stop'),true);
  assert.equal(race.useFocus(),false); race.restart();
  assert.ok(race.rivals.every(p=>p.effects.freeze===0 && p.effects.jam===0));
  assert.equal(race.snapshot().itemCooldown,0);
  assert.throws(()=>make(['time-stop','interference'],1));
  assert.throws(()=>createRaceSession(straight,config,undefined,0,'time-attack',Math.random,'desktop',{},undefined,['time-stop']));
});

test('rival items preserve ordered laps, final standings and stable completion', () => {
  const course = {...straight,length:500};
  const race = createRaceSession(course,config,createRaceRecords({trackId:'item-finish',configurationId:'test'}),0,competition,()=>.999,'desktop',{},undefined,['time-stop','interference']);
  race.start(); advance(race,3); assert.equal(race.useRivalItem('time-stop'),true);
  advance(race,3); race.useRivalItem('interference');
  for(let n=0;n<12000&&!race.snapshot().competition.complete;n++)race.step(1/120,input);
  const final=race.snapshot(); assert.equal(final.competition.complete,true);
  assert.deepEqual(final.competition.standings.map(p=>p.rank),[1,2,3,4]);
  assert.ok(final.competition.standings.every(p=>p.completedLaps===3&&p.finishTime>0));
  assert.equal(race.useRivalItem('time-stop'),false);
  advance(race,1); assert.deepEqual(race.snapshot(),final);
});
