import test from 'node:test';
import assert from 'node:assert/strict';
import { createTimeAttack } from '../output/test/game/driving/createTimeAttack.js';
import { createRaceRecords } from '../output/test/game/driving/raceRecords.js';
import { NEUTRAL_INPUT, DRIVING_TUNING } from '../output/test/game/driving/createDrivingModel.js';
const track={length:10000,halfWidth:12,checkpointSpacing:25,heightObstacles:[],sample:()=>({curvature:0})};
const input={...NEUTRAL_INPUT,throttle:true};
const race=(slots=2)=>createTimeAttack(track,DRIVING_TUNING,createRaceRecords({trackId:'focus',configurationId:'assisted'},undefined),slots);
const advance=(r,seconds)=>{for(let i=0;i<Math.round(seconds*100);i++)r.step(.01,input);};
test('focus slows physics to 45% for two real seconds while race timing remains real',()=>{
  const focused=race(),control=race(0);focused.start();control.start();advance(focused,3);advance(control,3);
  focused.model.state.speed=control.model.state.speed=DRIVING_TUNING.topSpeed;
  assert.equal(focused.useFocus(),true);advance(focused,2);advance(control,.9);
  assert.ok(Math.abs(focused.model.state.distance-control.model.state.distance)<1e-5);
  assert.ok(Math.abs(focused.model.state.elapsed-2)<1e-7);assert.ok(focused.snapshot().focusRemaining<1e-7);
  assert.equal(focused.snapshot().assisted,true);assert.equal(control.snapshot().assisted,false);
});
test('focus only activates during a race, freezes with pause, cannot overlap and resets per new race',()=>{
  const r=race();assert.equal(r.useFocus(),false);r.start();advance(r,3);const id=r.snapshot().raceId;
  assert.equal(r.useFocus(),true);assert.equal(r.useFocus(),false);advance(r,.5);r.pause();const before=r.snapshot();advance(r,20);assert.deepEqual(r.snapshot(),before);
  r.start();advance(r,2.6);assert.equal(r.useFocus(),true);advance(r,3.1);assert.equal(r.useFocus(),false);
  r.restart();assert.notEqual(r.snapshot().raceId,id);assert.equal(r.snapshot().focusUsed,0);assert.equal(r.snapshot().focusRemaining,0);
});
test('first record is distinct from improving an existing best for points',()=>{
  const memory=new Map();const storage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)};
  const records=createRaceRecords({trackId:'bonus',configurationId:'base'},storage);
  assert.equal(records.save(30,[10,10,10]).improvedExistingBest,false);
  assert.equal(records.save(27,[9,9,9]).improvedExistingBest,true);
  assert.equal(records.save(33,[11,11,11]).improvedExistingBest,false);
});
