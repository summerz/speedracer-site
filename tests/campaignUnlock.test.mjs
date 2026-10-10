import test from 'node:test';
import assert from 'node:assert/strict';
import { initialProgress, applyCommand, validateProgress, isCampaignUnlockAll, setCampaignUnlockAll, previewRelock } from '../output/test/game/progression/progress.js';
import { campaignStatus } from '../output/test/game/progression/campaign.js';
import { createProgressStore } from '../output/test/game/progression/progressStore.js';
import { campaignRecordKeys } from '../output/test/game/progression/campaignRecordCleanup.js';
import { TRACK_CATALOG } from '../output/test/game/track/trackCatalog.js';
import { challengeLapLimit } from '../output/test/game/track/raceChallenge.js';
import { createRaceRecords } from '../output/test/game/driving/raceRecords.js';
import { ghostKey } from '../output/test/game/driving/raceGhost.js';
const modes = ['time-attack', 'competition'];
const neon = TRACK_CATALOG;
const entry = (cleared = true) => ({cleared, attempts:1, records:{}, stars:cleared?3:0});
const pairs = plan => plan.flatMap(group => group.trackIds.map(id => `${group.mode}/${id}`));
function storage() {
  const data = new Map();
  return {get length(){return data.size;}, key:index=>[...data.keys()][index]??null,
    getItem:key=>data.get(key)??null, setItem:(key,value)=>data.set(key,value), removeItem:key=>data.delete(key)};
}
function record(cache, track, mode, challenge = 'normal', revision = track.revision, assisted = false) {
  const records = createRaceRecords({trackId:`${track.id}:v${revision}`, configurationId:JSON.stringify({challenge, assisted, ...(mode === 'competition'?{mode}:{})})}, cache);
  records.save(120,[40,40,40]); return records.key;
}
function clear(profile, track, mode = 'time-attack', challenge = 'normal') {
  return applyCommand(profile, {kind:'campaign-result',
    input:{raceId:`${mode}:${track.id}`,difficulty:'beginner',collisions:0,offTrackExits:0,recoveries:0,penaltyPoints:0,cleanHalfLaps:6,improvedExistingBest:false,assisted:false},
    outcome:{mode,trackId:track.id,revision:track.revision,total:120,laps:[40,40,40],rank:1,disqualified:false,assisted:false,challenge,lapLimit:challengeLapLimit(track,challenge)}});
}

test('unlock is persisted without fake clears and normal race rewards still save', () => {
  const before = initialProgress(), on = setCampaignUnlockAll(before,true);
  assert.equal(isCampaignUnlockAll(before),false); assert.equal(isCampaignUnlockAll(on),true);
  assert.deepEqual(on.campaign.modes,before.campaign.modes); assert.equal(on.balance,before.balance);
  assert.equal(on.revision,before.revision+1);
  assert.equal(isCampaignUnlockAll(validateProgress(JSON.parse(JSON.stringify(on)))),true);
  for (const mode of modes) {
    for (const track of TRACK_CATALOG) assert.equal(campaignStatus(on.campaign,mode,track),'available');
  }
  const completed = clear(on,neon.at(-1),'competition','easy');
  assert.equal(campaignStatus(completed.campaign,'competition',neon.at(-1)),'cleared');
  assert.ok(completed.balance>0); assert.equal(completed.campaign.modes.competition[neon.at(-1).id].difficulties.easy.stars,3);
  const off = setCampaignUnlockAll(completed,false);
  assert.equal(campaignStatus(off.campaign,'competition',neon.at(-1)),'locked');
  assert.deepEqual(off.rewards,completed.rewards); assert.equal(off.balance,completed.balance);
  for (const flag of [1,'true',null]) assert.throws(()=>validateProgress({...on,campaign:{...on.campaign,unlockAll:flag}}));
  assert.throws(()=>setCampaignUnlockAll(on,'false'));
});

test('relock cascades through own clears, difficulty records and both modes', () => {
  const purchased = applyCommand({...initialProgress(),balance:5000},{kind:'craft',id:'needle'});
  const upgraded = applyCommand(purchased,{kind:'upgrade',id:'needle',upgrade:'engine'});
  const on = setCampaignUnlockAll(upgraded,true);
  on.campaign.modes['time-attack'][neon[0].id] = entry();
  on.campaign.modes['time-attack'][neon[1].id] = entry(false); // available failed attempt survives
  for (const mode of modes) for (const track of neon.slice(2)) on.campaign.modes[mode][track.id] = entry();
  on.campaign.modes.competition[neon[1].id] = {...entry(),difficulties:{easy:entry(),normal:entry(),hard:entry()}};
  on.campaign.modes.competition.retired = entry();
  on.campaign.last = {mode:'competition',trackId:neon.at(-1).id,challenge:'hard'};
  const original = structuredClone(on), preview = previewRelock(on), off = setCampaignUnlockAll(on,false);
  assert.deepEqual(on,original); assert.deepEqual(preview.map(group=>group.trackIds.length),[neon.length-2,neon.length-1]);
  assert.deepEqual(off.campaign.modes['time-attack'],{[neon[0].id]:entry(),[neon[1].id]:entry(false)});
  assert.deepEqual(off.campaign.modes.competition,{retired:entry()});
  assert.deepEqual(off.campaign.last,{mode:'competition',trackId:neon[0].id,challenge:'hard'});
  assert.deepEqual(pairs(previewRelock(off)),[]);
  for (const key of Object.keys(on).filter(key=>!['campaign','revision'].includes(key))) assert.deepEqual(off[key],on[key]);
});

test('legitimate complete chains and partial mode-specific progress keep their records', () => {
  for (const gateMode of modes) {
    let on = setCampaignUnlockAll(initialProgress(),true);
    for (const track of neon) on = clear(on,track,gateMode,'easy');
    const other = modes.find(mode=>mode!==gateMode);
    on = clear(on,neon[0],other,'hard'); on = clear(on,neon[1],other,'normal');
    on = clear(on,neon[3],other);
    assert.deepEqual(pairs(previewRelock(on)),[`${other}/${neon[3].id}`]);
    const off = setCampaignUnlockAll(on,false);
    assert.equal(campaignStatus(off.campaign,other,neon[2]),'available');
    assert.equal(campaignStatus(off.campaign,other,neon[3]),'locked');
    assert.deepEqual(off.campaign.modes[gateMode],on.campaign.modes[gateMode]);
  }
});

test('preview includes cache-only tracks, and transaction cleanup removes all locked variants only', async () => {
  let saved = setCampaignUnlockAll(initialProgress(),true), fail = false;
  saved.campaign.modes['time-attack'][neon[0].id] = entry();
  const cache = storage(), locked = neon[1], cacheOnly = neon.at(-1);
  const remove = [record(cache,locked,'competition'),record(cache,locked,'competition','easy',1,true),record(cache,cacheOnly,'time-attack','hard',2)];
  const ghost = ghostKey(`${cacheOnly.id}:v2`,'hard'); cache.setItem(ghost,'ghost'); remove.push(ghost);
  const keep = [record(cache,locked,'time-attack'),record(cache,neon[0],'competition'),record(cache,{id:'trench-line',revision:1},'competition')];
  cache.setItem('speedracer:tutorial:v1','done'); keep.push('speedracer:tutorial:v1');
  const bad = `speedracer:record:${encodeURIComponent(`${cacheOnly.id}:v1`)}:1:%broken`;cache.setItem(bad,'bad');keep.push(bad);
  assert.deepEqual(pairs(previewRelock(saved)),[]);
  assert.deepEqual(pairs(previewRelock(saved,cache)),[`time-attack/${cacheOnly.id}`,`competition/${locked.id}`]);
  assert.deepEqual(new Set(campaignRecordKeys(previewRelock(saved,cache),cache)),new Set(remove));
  const repo = {read:async()=>saved,close(){},transact:async change=>{if(fail)throw Error('quota');saved=change(saved);return structuredClone(saved);}};
  const store = createProgressStore(repo,cache);
  try {
    await store.refresh(); assert.deepEqual(store.previewRelock(),previewRelock(saved,cache)); fail = true;
    await assert.rejects(store.command({kind:'campaign-unlock-all',on:false}),/quota/);
    assert.equal(isCampaignUnlockAll(store.snapshot()),true); for(const key of remove)assert.notEqual(cache.getItem(key),null);
    fail = false; await store.command({kind:'campaign-unlock-all',on:false});
    assert.equal(isCampaignUnlockAll(saved),false);for(const key of remove)assert.equal(cache.getItem(key),null);
    for(const key of keep)assert.notEqual(cache.getItem(key),null);
    assert.deepEqual(pairs(previewRelock(saved,cache)),[]);
  } finally {store.close();}
});

test('cache removal failures report a saved flag and can be retried while off', async () => {
  let saved = setCampaignUnlockAll(initialProgress(),true), fail = true;
  const cache = storage(); const key = record(cache,neon.at(-1),'time-attack');
  const remove = cache.removeItem; cache.removeItem = key=>{if(fail)throw Error('cache-denied');remove(key);};
  const store = createProgressStore({read:async()=>saved,close(){},transact:async change=>saved=change(saved)},cache);
  try {
    await store.refresh(); await assert.rejects(store.command({kind:'campaign-unlock-all',on:false}),/cache-denied/);
    assert.equal(isCampaignUnlockAll(store.snapshot()),false); assert.match(store.issue,/cache-denied/);
    assert.notEqual(cache.getItem(key),null);
    fail = false; await store.command({kind:'campaign-unlock-all',on:false}); assert.equal(cache.getItem(key),null);
  } finally {store.close();}
});
