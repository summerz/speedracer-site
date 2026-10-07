import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createSoundtrack,SOUNDTRACKS} from '../output/test/game/audio/soundtrack.js';

class Param {
  value=0; ramps=[];
  setTargetAtTime(value){this.value=value;}
  setValueAtTime(value){this.value=value;}
  cancelScheduledValues(){}
  linearRampToValueAtTime(value,at){this.value=value;this.ramps.push({value,at});}
}
class Node {gain=new Param();connect(){}disconnect(){this.disconnected=true;}}
class Context {
  currentTime=0;state='running';destination=new Node();gains=[];media=[];
  createGain(){const n=new Node();this.gains.push(n);return n;}
  createMediaElementSource(audio){this.media.push(audio);return new Node();}
  resume(){this.state='running';return Promise.resolve();}
  suspend(){this.state='suspended';return Promise.resolve();}
  close(){this.state='closed';return Promise.resolve();}
}
class Media extends EventTarget {
  src='';preload='';loop=false;currentTime=0;duration=180;readyState=4;paused=true;ended=false;plays=0;loads=0;
  load(){this.loads++;this.currentTime=0;this.ended=false;this.dispatchEvent(new Event('loadedmetadata'));}
  play(){this.plays++;if(this.fail)return Promise.reject(new Error('unavailable'));this.paused=false;return this.deferred ?? Promise.resolve();}
  pause(){this.paused=true;}
  removeAttribute(){this.src='';}
  time(value){this.currentTime=value;this.dispatchEvent(new Event('timeupdate'));}
}
const flush=()=>new Promise(resolve=>setTimeout(resolve,45));
const fixture=(random=()=>.999999)=>{
  const context=new Context(),media=[];
  const player=createSoundtrack({contextFactory:()=>context,mediaFactory:()=>{const m=new Media();media.push(m);return m;},fadeSeconds:.01,random});
  const active=()=>media.find(m=>!m.paused);
  return {context,media,player,active};
};

test('catalog contains the supplied lobby and eight race recordings in numbered order',()=>{
  assert.equal(SOUNDTRACKS.length,9);
  for(const song of SOUNDTRACKS)assert.ok(fs.statSync(`public/music/ost/${song.file}`).size>100000);
  SOUNDTRACKS.slice(1).forEach((song,i)=>assert.ok(song.file.startsWith(`racing-${i+1}-`)));
});

test('lobby persists across menus and ready, race persists across pause, return resumes lobby',async()=>{
  const f=fixture();try{
    f.player.preload();assert.ok(f.media.every(m=>m.preload==='auto'));assert.ok(f.media.every(m=>m.paused));
    f.player.activate();await flush();const lobby=f.active();assert.equal(f.player.snapshot().song,'Before The Real Dark');assert.equal(lobby.loop,true);
    lobby.time(27);const loads=lobby.loads;
    f.player.setScene('menu');f.player.setScene('ready');await flush();assert.equal(lobby.currentTime,27);assert.equal(lobby.loads,loads);
    f.player.setScene('countdown');await flush();assert.equal(f.player.snapshot().song,'Obsidian Horizon');const race=f.active();race.time(32);
    f.player.setScene('running');f.player.setScene('paused');f.player.setScene('running');await flush();assert.equal(f.active(),race);assert.equal(race.currentTime,32);
    f.player.setScene('finished');assert.equal(f.active(),race);
    f.player.setScene('menu');await flush();assert.equal(f.player.snapshot().song,'Before The Real Dark');assert.equal(f.active().currentTime,27);
    f.player.setScene('ready');f.player.setScene('countdown');await flush();assert.equal(f.player.snapshot().song,'Beneath the Steel Canopy');
    assert.equal(f.context.media.length,2,'streaming decks share one context');
  }finally{f.player.dispose();}
});

test('race playlist advances before the end, completes a bag of eight, and only crossfades two decks',async()=>{
  const f=fixture();try{
    f.player.activate();await flush();f.player.setScene('countdown');await flush();
    for(let i=1;i<=8;i++){
      assert.equal(f.player.snapshot().song,SOUNDTRACKS[i].title);
      const outgoing=f.active();outgoing.time(179.995);
      await Promise.resolve();assert.equal(f.media.filter(m=>!m.paused).length,2,'crossfade overlaps two decks');
      await flush();assert.equal(outgoing.paused,true);assert.equal(f.media.filter(m=>!m.paused).length,1);
    }
    assert.equal(f.player.snapshot().song,SOUNDTRACKS[1].title);
  }finally{f.player.dispose();}
});

test('each shuffled bag plays all eight once without repeating at bag boundaries',async()=>{
  // Force the second shuffle to start with the previous bag's final song.
  const draws=[...Array(7).fill(.999999),0,...Array(6).fill(.999999),0];
  const f=fixture(()=>draws.shift()??0);try{
    f.player.preload();f.player.activate();await flush();f.player.setScene('running');await flush();
    const songs=[];
    for(let i=0;i<24;i++){
      const song=SOUNDTRACKS.findIndex(s=>s.title===f.player.snapshot().song);songs.push(song);
      assert.notEqual(song,0,'lobby never enters a race bag');
      if(i===23)break;
      const idle=f.media.find(m=>m.paused),prepared=idle.src;
      f.active().time(179.995);await flush();
      assert.equal(f.active().src,prepared,'preloading does not consume or reshuffle the next selection');
    }
    for(let start=0;start<24;start+=8)assert.deepEqual([...songs.slice(start,start+8)].sort((a,b)=>a-b),[1,2,3,4,5,6,7,8]);
    for(let i=1;i<songs.length;i++)assert.notEqual(songs[i],songs[i-1],'no consecutive duplicate, including across bags');
    assert.notDeepEqual(songs.slice(0,8),songs.slice(8,16),'next bag gets a new shuffle');
    assert.notDeepEqual(songs.slice(8,16),songs.slice(16,24));
  }finally{f.player.dispose();}
});

test('returning to lobby and retrying keep the shuffled bag instead of resetting it',async()=>{
  const f=fixture(()=>0);try{
    f.player.activate();await flush();const songs=[];
    for(let i=0;i<8;i++){
      const prepared=f.media.find(m=>m.paused).src;
      f.player.setScene('ready');f.player.preload();f.player.activate();await flush();
      f.player.setScene('countdown');await flush();assert.equal(f.active().src,prepared);
      songs.push(f.player.snapshot().song);
      f.player.setScene('running');f.player.setScene('paused');f.player.setScene('running');
      f.player.setScene('finished');f.player.setScene('menu');await flush();
    }
    assert.equal(new Set(songs).size,8,'eight retries use all eight songs once');
  }finally{f.player.dispose();}
});

test('ducking, mute and background suspension preserve position and do not restart songs',async()=>{
  const f=fixture();try{
    f.player.activate();await flush();f.player.setScene('running');await flush();const race=f.active();race.time(25);
    f.player.setDucking(.32);assert.equal(f.context.gains[0].gain.value,.55*.32);
    f.player.setScene('paused');assert.equal(f.context.gains[0].gain.value,.22*.32);assert.equal(race.currentTime,25);
    f.player.setEnabled(false);assert.ok(f.media.every(m=>m.paused));f.player.setDucking(1);assert.equal(f.context.gains[0].gain.value,0);
    f.player.setEnabled(true);await flush();assert.equal(f.active(),race);assert.equal(race.currentTime,25);
    f.player.suspend();assert.ok(f.media.every(m=>m.paused));assert.equal(f.context.state,'suspended');
    f.player.activate();await flush();assert.equal(f.active(),race);assert.equal(race.currentTime,25);
  }finally{f.player.dispose();assert.equal(f.context.state,'closed');assert.ok(f.media.every(m=>m.paused&&m.src===''));}
});

test('unavailable next file leaves the current music intact and retries on gesture',async()=>{
  const f=fixture();try{
    f.player.activate();await flush();const lobby=f.active();const idle=f.media.find(m=>m!==lobby);idle.fail=true;
    f.player.setScene('countdown');await flush();assert.equal(f.active(),lobby);assert.equal(f.player.snapshot().song,SOUNDTRACKS[0].title);
    idle.fail=false;f.player.activate();await flush();assert.equal(f.player.snapshot().song,SOUNDTRACKS[1].title);
  }finally{f.player.dispose();}
});

test('pending playback cannot resurrect a canceled race after returning to menu or disposal',async()=>{
  const f=fixture();try{
    f.player.activate();await flush();const lobby=f.active(),idle=f.media.find(m=>m!==lobby);let resolve;
    idle.deferred=new Promise(r=>{resolve=r;});f.player.setScene('countdown');f.player.setScene('menu');resolve();await flush();
    assert.equal(f.player.snapshot().song,SOUNDTRACKS[0].title);assert.equal(idle.paused,true);
    idle.deferred=undefined;f.player.setScene('countdown');f.player.dispose();await flush();assert.ok(f.media.every(m=>m.paused&&m.src===''));
  }finally{f.player.dispose();}
});

test('a library replacement changes the intended track URL and keeps the other music paths', async () => {
  const context = new Context(), media = [];
  const player = createSoundtrack({ contextFactory: () => context, mediaFactory: () => { const m = new Media(); media.push(m); return m; },
    baseUrl: '/game/', resolveUrl: (file, original) => file === SOUNDTRACKS[0].file ? 'blob:lobby-library' : original, random: () => .999999, fadeSeconds: .01 });
  try {
    player.preload();
    assert.ok(media.some(m => m.src === 'blob:lobby-library'));
    player.activate(); await flush();
    player.setScene('countdown'); await flush();
    assert.ok(media.some(m => m.src === `/game/music/ost/${SOUNDTRACKS[1].file}`));
    assert.equal(player.snapshot().song, SOUNDTRACKS[1].title);
  } finally { player.dispose(); }
  assert.ok(media.every(m => m.paused && m.src === ''));
});


test('custom playlist shuffles only included tracks and supports one racing song', async () => {
  const context = new Context(), media = [];
  const tracks = [SOUNDTRACKS[0], SOUNDTRACKS[3]];
  const player = createSoundtrack({ tracks, contextFactory: () => context, mediaFactory: () => { const m = new Media(); media.push(m); return m; }, fadeSeconds: .01 });
  try {
    player.activate(); await flush(); player.setScene('running'); await flush();
    assert.equal(player.snapshot().song, 'Steel Gemini');
    for (let i = 0; i < 3; i++) { media.find(m => !m.paused).time(179.995); await flush(); assert.equal(player.snapshot().song, 'Steel Gemini'); }
    assert.ok(media.every(m => /lobby-before|racing-3/.test(m.src)));
  } finally { player.dispose(); }
});
test('empty racing playlist stays silent during a race and resumes lobby on return', async () => {
  const context = new Context(), media = [];
  const player = createSoundtrack({ tracks: [SOUNDTRACKS[0]], contextFactory: () => context, mediaFactory: () => { const m = new Media(); media.push(m); return m; }, fadeSeconds: .01 });
  try {
    player.activate(); await flush(); assert.ok(media.some(m => !m.paused));
    player.setScene('countdown'); player.activate(); await flush(); assert.ok(media.every(m => m.paused));
    player.setScene('menu'); await flush(); assert.ok(media.some(m => !m.paused));
  } finally { player.dispose(); }
});
