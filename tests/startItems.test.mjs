import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { RIVAL_ITEMS, boostItemBonus, speedItemBonus, itemAllowedInMode } from '../output/test/game/progression/catalog.js';
import { validItemLoadout } from '../output/test/game/progression/itemLoadout.js';
import { createItemSlots, itemSlotIndex } from '../output/test/game/driving/itemSlots.js';
import { initialProgress, applyCommand, validateProgress } from '../output/test/game/progression/progress.js';
import { reserveStartItems } from '../output/test/game/progression/startItemUse.js';
import { createDrivingModel } from '../output/test/game/driving/createDrivingModel.js';
import { createRaceSession } from '../output/test/game/driving/createRaceSession.js';
import { createRaceRecords } from '../output/test/game/driving/raceRecords.js';
import { createTrack } from '../output/test/game/track/createTrack.js';
import { DEFAULT_DRONE_CONFIGURATION as config } from '../output/test/game/drone/droneConfiguration.js';
const input = { throttle:true, brake:false, steer:0, lift:0, boost:false };
const track = { ...createTrack(), length:10000, halfWidth:14, checkpointSpacing:25, branches:[], jumps:[], heightObstacles:[], corridors:[], mineFields:[], boostPads:[], arcRails:[], boostRings:[],
  sample:d=>({curvature:0,position:new Vector3(0,0,d),right:new Vector3(1,0,0),up:new Vector3(0,1,0),tangent:new Vector3(0,0,1)}) };
const make = (slots, mode='time-attack')=>createRaceSession(track, config, createRaceRecords({trackId:'start-items',configurationId:JSON.stringify(slots)}), 0, mode, ()=>.999, 'desktop', {}, undefined, slots);
const advance=(race,seconds,fps=120)=>{for(let n=0;n<Math.round(seconds*fps);n++)race.step(1/fps,input);};
const approx=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);

for(const [family,prices,bonus] of [['boost',[400,600,800],boostItemBonus],['speed',[500,800,1100],speedItemBonus]]) {
  for(const [i,percent] of [10,20,30].entries()) for(const mode of ['competition','time-attack']) test(`${family} ${percent}% costs ${prices[i]}P and works throughout ${mode}`,()=>{
    const id=`${family}-${percent}`;
    assert.equal(RIVAL_ITEMS.find(item=>item.id===id).price,prices[i]); approx(bonus(id),percent/100);
    let p={...initialProgress(),balance:5000};
    p=applyCommand(p,{kind:'rival-buy',item:id,mode}); assert.equal(p.balance,5000-prices[i]);
    p=applyCommand(p,{kind:'rival-slots',slots:[id],mode}); assert.equal(itemAllowedInMode(id,mode),true);
    const race=make([id,id],mode); assert.equal(race.useRivalItem(id),false);
    race.start(); assert.equal(race.useRivalItem(id),true); assert.equal(race.useRivalItem(id),false);
    advance(race,3); advance(race,12);
    const s=race.snapshot(); approx(s[family==='boost'?'boostBonus':'speedBonus'],percent/100);
    assert.equal(s.items.find(item=>item.id===id).remaining,1); assert.equal(s.items.find(item=>item.id===id).active,1);
    assert.equal(s.assisted,true); race.pause(); const paused=race.snapshot(); advance(race,6); assert.deepEqual(race.snapshot(),paused);
    race.start(); approx(race.snapshot()[family==='boost'?'boostBonus':'speedBonus'],percent/100);
    race.restart(); assert.equal(race.snapshot().boostBonus,0); assert.equal(race.snapshot().speedBonus,0);
  });
}

test('actual ordinary and both boost-stage cruising speeds gain independent bonuses without compounding',()=>{
  const ceiling = (ordinary,boost,boosting,stage2=false) => {
    const model=createDrivingModel(track,config.performance); model.setSpeedBonuses(ordinary,boost); model.setSpeedBonuses(ordinary,boost);
    const base=boosting?(stage2?config.performance.boostStage2Speed:config.performance.boostSpeed):config.performance.topSpeed;
    model.state.speed=base*(1+(boosting?boost:ordinary)); model.state.charge=1.5;
    if(stage2){ model.state.boosting=true; model.state.boostElapsed=10; }
    model.step(.01,{...input,boost:boosting});
    assert.equal(model.state.boostStage,boosting?(stage2?2:1):0);
    return {speed:model.state.speed,base};
  };
  for(const boosting of [false,true]) for(const stage2 of boosting?[false,true]:[false]) {
    const control=ceiling(0,0,boosting,stage2),enhanced=ceiling(.2,.3,boosting,stage2);
    approx(enhanced.speed/control.speed,boosting?1.3:1.2);
  }
  const race=make(['speed-20','boost-30']);race.start();race.useRivalItem('speed-20');race.useRivalItem('boost-30');advance(race,3);
  race.model.state.speed=config.performance.topSpeed*1.2;race.step(.01,input); const improved=race.model.state.speed;
  race.restart();race.start();advance(race,3);race.model.state.speed=config.performance.topSpeed;race.step(.01,input);approx(improved/race.model.state.speed,1.2);
});

test('only highest equipped tier in a family can activate; other copies remain unused',()=>{
  for(const family of ['speed','boost']) {
    const low=`${family}-10`,high=`${family}-30`,race=make([low,high,high]);race.start();
    assert.equal(race.useRivalItem(low),false);assert.equal(race.useRivalItem(high),true);assert.equal(race.useRivalItem(high),false);
    assert.equal(race.snapshot().items.find(i=>i.id===low).remaining,1);assert.equal(race.snapshot().items.find(i=>i.id===high).remaining,1);
  }
});

test('two stable Q/E slots hold five copies each and never shift exhausted or automatic slots',()=>{
  assert.equal(validItemLoadout(5,Array(5).fill('time-stop')),true);
  assert.equal(validItemLoadout(6,[]),false);assert.equal(validItemLoadout(0,Array(6).fill('speed-10')),false);
  assert.equal(validItemLoadout(1,['time-stop','speed-10']),false);
  const slots=createItemSlots(5,Array(5).fill('time-stop'));
  assert.equal(slots.manual(itemSlotIndex('KeyQ')),'focus');assert.equal(slots.manual(itemSlotIndex('KeyE')),'time-stop');
  assert.equal(itemSlotIndex('KeyV'),null);
  for(let n=0;n<5;n++)slots.consume(0);assert.equal(slots.manual(0),null);assert.equal(slots.manual(1),'time-stop');
  const auto=createItemSlots(0,['speed-10','time-stop']);assert.equal(auto.manual(0),null);assert.equal(auto.manual(1),'time-stop');
  let p=initialProgress();p.focus=5;p.rivalInventory['time-stop']=5;p.rivalInventory['speed-10']=6;
  p=applyCommand(p,{kind:'slots',count:5});p=applyCommand(p,{kind:'rival-slots',slots:Array(5).fill('time-stop'),mode:'competition'});
  assert.equal(validateProgress(p).rivalSlots.length,5);
  assert.throws(()=>applyCommand(p,{kind:'slots',count:6}));
  assert.throws(()=>applyCommand(p,{kind:'rival-slots',slots:['speed-10',...p.rivalSlots],mode:'competition'}));
  assert.throws(()=>applyCommand({...p,focusSlots:0},{kind:'rival-slots',slots:Array(6).fill('speed-10'),mode:'time-attack'}));
  assert.throws(()=>applyCommand({...p,focusSlots:0,rivalSlots:['time-stop']},{kind:'rival-slots',slots:['time-stop','time-stop'],mode:'time-attack'}));
});

for(const fps of [30,60,120]) test(`five equipped head starts trigger once and release rivals after five running seconds at ${fps}fps`,()=>{
  const race=make(Array(5).fill('head-start'),'competition');race.start();assert.equal(race.useRivalItem('head-start'),true);
  advance(race,3,fps);assert.equal(race.phase,'running');approx(race.snapshot().headStartRemaining,5);
  const grid=race.rivals.map(r=>r.controller.model.state.distance);
  advance(race,2,fps);assert.ok(race.model.state.distance>0);race.rivals.forEach((r,i)=>approx(r.controller.model.state.distance,grid[i]));
  race.pause();advance(race,9,fps);approx(race.snapshot().headStartRemaining,3);race.start();advance(race,3,fps);
  race.rivals.forEach((r,i)=>approx(r.controller.model.state.distance,grid[i]));approx(race.snapshot().headStartRemaining,0);
  assert.equal(race.useRivalItem('head-start'),false);assert.equal(race.snapshot().items.find(i=>i.id==='head-start').remaining,4);
  advance(race,.1,fps);assert.ok(race.rivals.every((r,i)=>r.controller.model.state.distance>grid[i]));
  race.restart();assert.equal(race.snapshot().headStartRemaining,0);
});

const stock=()=>{let profile=initialProgress();profile.rivalInventory['speed-20']=5;profile.rivalInventory['boost-30']=5;
  return {snapshot:()=>profile,command:async c=>{profile=applyCommand(profile,c);}};};
const reserve=(store,extra={})=>reserveStartItems({store,items:['speed-20','boost-30'],mode:'time-attack',receipt:'race-start',valid:()=>true,start:()=>{},activate:()=>true,...extra});
test('automatic items reserve one copy per family before start and confirm activated effects',async()=>{
  const store=stock();let starts=0,activations=0;
  assert.equal(await reserve(store,{start:()=>{starts++;assert.equal(store.snapshot().rivalInventory['speed-20'],4);},activate:()=>{activations++;return true;}}),true);
  assert.equal(starts,1);assert.equal(activations,2);assert.equal(store.snapshot().rivalInventory['boost-30'],4);
  assert.ok(Object.values(store.snapshot().rivalUses).every(use=>use.state==='used'));
});
test('cancelled, partially reserved and rejected effects refund unused stock without starting prematurely',async()=>{
  for(const reason of ['cancel','reserve','activate']) {
    const store=stock();let starts=0;
    const wrapped={command:async c=>{if(reason==='reserve'&&c.kind==='consume-rival'&&c.item==='boost-30')throw Error('disk');await store.command(c);}};
    const task=reserve(wrapped,{valid:()=>reason!=='cancel',start:()=>starts++,activate:()=>false});
    if(reason==='reserve')await assert.rejects(task);else assert.equal(await task,false);
    assert.equal(starts,reason==='activate'?1:0);assert.equal(store.snapshot().rivalInventory['speed-20'],5);assert.equal(store.snapshot().rivalInventory['boost-30'],5);
  }
});
test('failed confirmation never returns items whose effects have already activated',async()=>{
  const store=stock();const wrapped={command:async c=>{if(c.kind==='confirm-rival')throw Error('disk');await store.command(c);}};
  await assert.rejects(reserve(wrapped));assert.equal(store.snapshot().rivalInventory['speed-20'],4);assert.equal(store.snapshot().rivalInventory['boost-30'],4);
});

test('speed items leave awakening speed unchanged',()=>{
  const run=(ordinary,boost)=>{
    const model=createDrivingModel(track,config.performance,undefined,config.altitudeProfile);
    model.setSpeedBonuses(ordinary,boost);model.state.awakeningCores=1;assert.equal(model.useAwakening(),true);
    for(let n=0;n<120;n++)model.step(1/120,input);return model.state.speed;
  };
  approx(run(.3,.3),run(0,0));
});
