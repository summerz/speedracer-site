import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readMidi} from '../output/test/game/audio/midi.js';
import {createSoundtrack, musicRegion, SOUNDTRACKS} from '../output/test/game/audio/soundtrack.js';
import {createMidiSynth} from '../output/test/game/audio/synth.js';
const scores=SOUNDTRACKS.map(song=>{const data=fs.readFileSync(`public/music/${song.file}.mid`);return readMidi(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength));});
test('all five supplied MIDI scores retain tempo, six parts and continuous arpeggios',()=>{
  scores.forEach((score,i)=>{
    assert.ok(score.notes.length>2000);assert.deepEqual([...new Set(score.notes.map(n=>n.channel))].sort((a,b)=>a-b),[0,1,2,3,4,9]);
    assert.ok(Math.abs(score.bpm-[120,128,100,126,110][i])<.001);
    const region=musicRegion(i,true);assert.equal(region.start,128);assert.equal(region.end,SOUNDTRACKS[i].climaxEnd*4);
    for(let beat=128;beat<region.end;beat+=4){assert.ok(score.notes.some(n=>n.channel===1&&n.beat>=beat&&n.beat<beat+4),`song ${i} bar ${beat} has arpeggio`);}
    assert.ok(score.notes.some(n=>n.beat===region.start&&n.channel===1));
  });
});
test('invalid/truncated MIDI is rejected before scheduling',()=>{
  assert.throws(()=>readMidi(new ArrayBuffer(2)),/Truncated/);
  const data=fs.readFileSync('public/music/01_grid_theme.mid');const broken=data.subarray(0,200);assert.throws(()=>readMidi(broken.buffer.slice(broken.byteOffset,broken.byteOffset+broken.byteLength)),/Truncated/);
});
class Param { value=0; setValueAtTime(v){this.value=v;} linearRampToValueAtTime(v){this.value=v;} exponentialRampToValueAtTime(v){this.value=v;} setTargetAtTime(v){this.value=v;} cancelScheduledValues(){} }
class Node { gain=new Param();frequency=new Param();Q=new Param();pan=new Param();detune=new Param();delayTime=new Param();threshold=new Param();knee=new Param();ratio=new Param(); connect(){} disconnect(){} start(at){this.at=at;} stop(at){this.end=at;} }
class Context {
  currentTime=0;state='running';sampleRate=100;destination=new Node();sources=[];
  createGain(){return new Node();}createStereoPanner(){return new Node();}createBiquadFilter(){return new Node();}createDynamicsCompressor(){return new Node();}createDelay(){return new Node();}
  createOscillator(){const n=new Node();this.sources.push(n);return n;}createBufferSource(){return this.createOscillator();}
  createBuffer(_,frames){return {getChannelData:()=>new Float32Array(frames)};}resume(){return Promise.resolve();}suspend(){this.state='suspended';return Promise.resolve();}close(){this.state='closed';return Promise.resolve();}
}
const flush=()=>new Promise(r=>setTimeout(r,55));
test('transport starts with notes immediately, keeps playing across menus/pause and starts race on Light Cycle Run',async()=>{
  const ctx=new Context();let contexts=0;const player=createSoundtrack(async song=>scores[song],()=>{contexts++;return ctx;});
  try{
    player.preload();player.activate();await flush();assert.ok(ctx.sources.some(n=>n.at<=.013));assert.equal(player.snapshot().song,'Grid Theme');
    const count=ctx.sources.length;player.setScene('ready');player.setScene('menu');await flush();assert.equal(ctx.sources.length,count);assert.equal(contexts,1);
    player.setScene('countdown');await flush();assert.equal(player.snapshot().song,'Light Cycle Run');assert.ok(ctx.sources.slice(count).some(n=>Math.abs(n.frequency.value-329.6275569)<.001));
    const start=ctx.sources.length;player.setScene('running');player.setScene('paused');player.setScene('running');await flush();assert.equal(ctx.sources.length,start);
    // Score proceeds through its break/build continuously, rather than jumping between climax clips.
    ctx.currentTime=35;await flush();assert.equal(player.snapshot().song,'Light Cycle Run');
    const boundary=.012+(480-128)*60/128;ctx.currentTime=boundary-.1;const before=ctx.sources.length;await flush();assert.equal(player.snapshot().song,'Neon Pursuit');
    assert.ok(ctx.sources.slice(before).some(n=>Math.abs(n.at-boundary)<1e-6),'next downbeat is scheduled in advance at the boundary');
    player.setEnabled(false);ctx.currentTime+=1;const muted=ctx.sources.length;await flush();assert.equal(ctx.sources.length,muted);
    player.setEnabled(true);await flush();assert.ok(ctx.sources.length>muted);assert.equal(contexts,1);
  }finally{player.dispose();assert.equal(ctx.state,'closed');}
});

test('arrangement keeps bass, arpeggio and chord pad, omitting lead and horn melodies',()=>{
 const ctx=new Context(),synth=createMidiSynth(ctx,ctx.destination);
 try{
  for(const score of scores){
   for(const channel of [3,4]){const before=ctx.sources.length;synth.play(score.notes.find(n=>n.channel===channel),0,.5);assert.equal(ctx.sources.length,before);}
   for(const channel of [0,1,2,9]){const before=ctx.sources.length;synth.play(score.notes.find(n=>n.channel===channel),0,.5);assert.equal(ctx.sources.length,before+1);}
  }
 }finally{synth.dispose();}
});
