import test from 'node:test';
import assert from 'node:assert/strict';
import { createPadReader } from '../output/test/platform/gamepadInput.js';
const pad = (axes = [0,0], buttons = []) => ({ mapping:'standard', axes, buttons:Array.from({length:16}, (_,i) => ({ pressed:buttons.includes(i), value:buttons.includes(i) ? 1 : 0 })) });
test('standard gamepads normalize steering deadzone and clear every driving input on disconnect', () => {
  const reader=createPadReader();
  assert.equal(reader.read(pad([.17,0]),0,true).snapshot.steer,0);
  assert.equal(reader.read(pad([1,0],[6,7]),10,true).snapshot.steer,1);
  assert.equal(reader.read(pad([-1,0]),20,true).snapshot.steer,-1);
  const boost=reader.read(pad([.5,0],[6,7]),30,true).snapshot;
  assert.equal(boost.brake,true);assert.equal(boost.boost,true);
  assert.deepEqual(reader.read(null,40,true).snapshot,{connected:false,steer:0,brake:false,boost:false});
  assert.equal(reader.read({...pad(),mapping:''},50,true).snapshot.connected,false);
});
test('held menu trigger cannot start boost until released after entering driving', () => {
  const reader=createPadReader();reader.read(pad([0,0],[7]),0,false);
  assert.equal(reader.read(pad([0,0],[7]),16,true).snapshot.boost,false);
  assert.equal(reader.read(pad([0,0],[7]),32,true).snapshot.boost,false);
  reader.read(pad(),48,true);assert.equal(reader.read(pad([0,0],[5]),64,true).snapshot.boost,true);
  reader.read(pad([0,0],[5]),80,false);
  assert.equal(reader.read(pad([0,0],[5]),96,true).snapshot.boost,false);
});
test('menu directions repeat with delay; altitude and selection fire only once per press', () => {
  const reader=createPadReader();
  assert.deepEqual(reader.read(pad([0,-1],[0]),0,false).actions,['up','confirm']);
  assert.deepEqual(reader.read(pad([0,-1],[0]),399,false).actions,[]);
  assert.deepEqual(reader.read(pad([0,-1],[0]),400,false).actions,['up']);
  assert.deepEqual(reader.read(pad([0,-1],[0]),549,false).actions,[]);
  assert.deepEqual(reader.read(pad([0,-1],[0]),550,false).actions,['up']);
  reader.read(pad(),600,true);
  assert.deepEqual(reader.read(pad([0,0],[12,9,2,3,4]),700,true).actions,['up','cockpit','track','focus','pause']);
  assert.deepEqual(reader.read(pad([0,0],[12,9,2,3,4]),1500,true).actions,[]);
  assert.deepEqual(reader.read(pad([0,-1]),1600,true).actions,[]);
});
