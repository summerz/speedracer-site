import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACK_CATALOG, campaignRankLimit } from '../output/test/game/track/trackCatalog.js';
import { RACE_CHALLENGES, raceChallenge, challengeLapLimit, challengeStars } from '../output/test/game/track/raceChallenge.js';
import { createCatalogTrack } from '../output/test/game/track/trackRuntime.js';
import { initialCampaign, completeCampaign, campaignStars, campaignDifficultyProgress, campaignStatus, validateCampaign } from '../output/test/game/progression/campaign.js';
import { createRaceSession } from '../output/test/game/driving/createRaceSession.js';
import { createRaceRecords } from '../output/test/game/driving/raceRecords.js';
import { DRONE_CATALOG } from '../output/test/game/drone/droneCatalog.js';
const first=TRACK_CATALOG[0];
const result=(challenge='normal',ratio=.99,mode='time-attack',rank=1)=>{
  const lapLimit=challengeLapLimit(first,challenge), laps=Array(first.laps).fill(lapLimit*ratio);
  return {challenge,mode,trackId:first.id,revision:first.revision,total:laps.reduce((a,b)=>a+b,0),laps,rank,disqualified:false,assisted:false,lapLimit};
};
test('every course has three distinct deadlines and obstacle densities that survive retries',()=>{
  for(const course of TRACK_CATALOG){
    assert.ok(challengeLapLimit(course,'easy')>challengeLapLimit(course));
    assert.ok(challengeLapLimit(course)>challengeLapLimit(course,'hard'));
    const tracks=['easy','normal','hard'].map(c=>createCatalogTrack(course,c));
    const count = track => track.heightObstacles.length + (track.corridorObstacles?.length ?? 0);
    assert.ok(count(tracks[0]) < count(tracks[1]), course.id);
    assert.ok(count(tracks[1]) < count(tracks[2]), course.id);
    for(const track of tracks){
      const distances=track.heightObstacles.map(o=>o.distance);
      track.randomizeObstacles(()=>.4);
      assert.deepEqual(track.heightObstacles.map(o=>o.distance),distances);
      assert.equal(new Set(distances).size,distances.length);
    }
    assert.equal(tracks[0].length,tracks[2].length);
  }
  assert.equal(raceChallenge('bad'),'normal');
});
test('stars reward lap margins and ranks rather than collision-free perfection',()=>{
  for(const challenge of Object.keys(RACE_CHALLENGES)){
    for(const [ratio,stars] of [[1,1],[.98,1],[.97,2],[.91,2],[.9,3],[.7,3],[1.001,0]])
      assert.equal(challengeStars('time-attack',first,challenge,result(challenge,ratio)),stars);
    assert.equal(challengeStars('time-attack',first,challenge,{...result(challenge,.7),disqualified:true}),0);
    const cutoff=campaignRankLimit(first);
    for(const [rank,stars] of [[cutoff,1],[cutoff-1,2],[1,3],[cutoff+1,0]])
      assert.equal(challengeStars('competition',first,challenge,result(challenge,.99,'competition',rank)),stars);
    const tough={...first,rating:5};
    assert.equal(challengeStars('competition',tough,challenge,result(challenge,.99,'competition',2)),1);
    assert.equal(challengeStars('competition',tough,challenge,result(challenge,.97,'competition',2)),2);
    assert.equal(challengeStars('competition',tough,challenge,result(challenge,1.1,'competition',1)),3);
  }
});
test('difficulty records and stars are independent, unlocks shared, bonus paid only once',()=>{
  const p=initialCampaign();
  const easy=completeCampaign(p,result('easy',.89));assert.equal(easy.stars,3);assert.ok(easy.firstClear);
  assert.equal(campaignStatus(p,'time-attack',TRACK_CATALOG[1]),'available');
  assert.equal(campaignStars(p,'time-attack',first,'easy'),3);
  assert.equal(campaignStars(p,'time-attack',first,'normal'),0);
  const hard=completeCampaign(p,result('hard',.99));assert.equal(hard.stars,1);assert.equal(hard.bonus,0);
  completeCampaign(p,result('easy',.99));assert.equal(campaignStars(p,'time-attack',first,'easy'),3);
  assert.equal(campaignStars(p,'time-attack',first,'hard'),1);
  assert.equal(campaignDifficultyProgress(p,'time-attack',first,'easy').attempts,2);
  assert.equal(campaignDifficultyProgress(p,'time-attack',first,'hard').attempts,1);
  assert.deepEqual(validateCampaign(p),p);
});
test('incidents lower stars but allow imperfect fast runs and never block a passing unlock',()=>{
  const fast=result('normal',.89), laps=first.laps;
  const rate=(collisions,offTrackExits)=>challengeStars('time-attack',first,'normal',{...fast,collisions,offTrackExits});
  assert.equal(rate(3*laps,1*laps),3); // 14 points per lap: below the 15-point allowance.
  assert.equal(rate(4*laps,1*laps),2);
  assert.equal(rate(6*laps,3*laps),1);
  assert.equal(challengeStars('competition',first,'normal',{...fast,collisions:8*laps}),2);
  assert.equal(challengeStars('time-attack',first,'normal',{...result(),offTrackExits:100}),1);
  const p=initialCampaign(),dirty={...fast,collisions:4*laps,offTrackExits:1*laps};
  assert.equal(completeCampaign(p,dirty).stars,2);
  assert.equal(campaignStatus(p,'time-attack',TRACK_CATALOG[1]),'available');
  let d=campaignDifficultyProgress(p,'time-attack',first);
  assert.equal(d.clearRecord.collisions,dirty.collisions);
  assert.equal(d.clearRecord.offTrackExits,dirty.offTrackExits);
  completeCampaign(p,{...result('normal',.90),collisions:0,offTrackExits:0});
  completeCampaign(p,{...result('normal',.70),collisions:20*laps,offTrackExits:10*laps});
  d=campaignDifficultyProgress(p,'time-attack',first);
  assert.equal(d.stars,3);assert.equal(d.clearRecord.collisions,0);
  assert.equal(d.records[`${first.revision}:normal`].offTrackExits,10*laps);
  assert.deepEqual(validateCampaign(p),p);
  for(const field of ['collisions','offTrackExits']) {
    assert.throws(()=>completeCampaign(p,{...fast,[field]:-1}));
    const invalid=structuredClone(p);invalid.modes['time-attack'][first.id].difficulties.normal.clearRecord[field]=1.5;
    assert.throws(()=>validateCampaign(invalid));
  }
});
test('legacy records migrate to normal without losing clear records or unlocking bonuses',()=>{
  const p=initialCampaign(),old=result();
  p.modes['time-attack'][first.id]={cleared:true,attempts:2,records:{[`${first.revision}:normal`]:{total:old.total,laps:old.laps,rank:1,assisted:false}}};
  assert.equal(campaignStars(p,'time-attack',first,'normal'),1);
  assert.equal(campaignDifficultyProgress(p,'time-attack',first,'easy'),undefined);
  const replay=completeCampaign(p,result('easy',.8));assert.equal(replay.bonus,0);
  assert.deepEqual(campaignDifficultyProgress(p,'time-attack',first).records[`${first.revision}:normal`].laps,old.laps);
  assert.equal(campaignStars(p,'time-attack',first,'easy'),3);
  const invalid=structuredClone(p);invalid.modes['time-attack'][first.id].difficulties.easy.stars=4;
  assert.throws(()=>validateCampaign(invalid));
  assert.throws(()=>completeCampaign(p,{...result('hard'),lapLimit:challengeLapLimit(first,'easy')}));
});
test('rank stars survive faster losing results and keep the strongest passing comparison',()=>{
  const p=initialCampaign();completeCampaign(p,result('normal',.9,'competition',1));
  completeCampaign(p,result('normal',.7,'competition',4));
  completeCampaign(p,result('normal',.6,'competition',5));
  const d=campaignDifficultyProgress(p,'competition',first);
  assert.equal(d.stars,3);assert.equal(d.clearRecord.rank,1);
  assert.equal(d.records[`${first.revision}:normal`].rank,5);
});
test('hard AI field has higher pace while mobile remains easier than desktop',()=>{
  const track=createCatalogTrack(first), craft=DRONE_CATALOG[0].configuration;
  const make=(challenge,platform)=>createRaceSession(track,craft,createRaceRecords({trackId:'challenge',configurationId:'test'}),0,'competition',()=>.5,platform,{laps:first.laps},first.rating,[],challenge);
  const easy=make('easy','desktop'),hard=make('hard','desktop'),touch=make('hard','touch');
  assert.equal(easy.rivals.length,7);
  assert.ok(hard.rivals.reduce((a,r)=>a+r.profile.pace,0)>easy.rivals.reduce((a,r)=>a+r.profile.pace,0));
  assert.ok(touch.rivals.every((r,i)=>r.profile.pace<hard.rivals[i].profile.pace));
});
