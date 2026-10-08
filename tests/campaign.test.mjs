import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACK_CATALOG, DISTRICTS, campaignLapLimit, campaignRankLimit, validateTrackCatalog } from '../output/test/game/track/trackCatalog.js';
import { createCatalogTrack, trackMetrics } from '../output/test/game/track/trackRuntime.js';
import { initialProgress, validateProgress, applyCommand } from '../output/test/game/progression/progress.js';
import { initialCampaign, campaignStatus, nextCampaignTrack, validateCampaign, campaignClearRecord, completeCampaign } from '../output/test/game/progression/campaign.js';
import { createTimeAttack } from '../output/test/game/driving/createTimeAttack.js';
import { createRaceRecords } from '../output/test/game/driving/raceRecords.js';
import { aiDrivingInput } from '../output/test/game/driving/createRaceSession.js';
import { DRONE_CATALOG } from '../output/test/game/drone/droneCatalog.js';
import { NEUTRAL_INPUT } from '../output/test/game/driving/createDrivingModel.js';
import { createDistrictScenery } from '../output/test/game/track/createDistrictScenery.js';
import { disposeScenery } from '../output/test/game/track/createTrackLandmark.js';

const first = TRACK_CATALOG[0], second = TRACK_CATALOG[1];
const reward = id => ({ raceId: id, difficulty: 'beginner', collisions: 0, offTrackExits: 0, recoveries: 0, penaltyPoints: 0, cleanHalfLaps: 6, improvedExistingBest: false, assisted: false });
const outcome = (track = first, mode = 'time-attack', changes = {}) => ({ mode, trackId: track.id, revision: track.revision, total: 120, laps: [40,40,40], rank: 1, disqualified: false, assisted: false, lapLimit: campaignLapLimit(track), ...changes });
const complete = (p, id, result = outcome()) => applyCommand(p, { kind: 'campaign-result', input: reward(id), outcome: result });

test('new districts append eight varied courses without changing earlier campaign identities', () => {
  assert.equal(TRACK_CATALOG.length,32); assert.equal(Object.keys(DISTRICTS).length,8);
  assert.equal(TRACK_CATALOG[23].order,24);
  for (const district of ['harbor','desert']) {
    const courses=TRACK_CATALOG.filter(t=>t.district===district);
    assert.equal(courses.length,4); assert.ok(DISTRICTS[district].description.length>15);
    assert.ok(new Set(courses.map(t=>t.layout.shape)).size>=3);
    assert.ok(courses.every(t=>t.layout.stunts.length>=2));
    assert.equal(courses.filter(t=>t.branches?.length).length,2);
    assert.ok(courses[0].rating<courses.at(-1).rating);
  }
  let p=initialProgress(); for(const track of TRACK_CATALOG.slice(0,24)) p=complete(p,track.id,outcome(track));
  const restored=validateProgress(p);
  assert.equal(campaignStatus(restored.campaign,'time-attack',TRACK_CATALOG[23]),'cleared');
  assert.equal(campaignStatus(restored.campaign,'time-attack',TRACK_CATALOG[24]),'available');
  assert.equal(campaignStatus(restored.campaign,'time-attack',TRACK_CATALOG[25]),'locked');
  assert.equal(campaignStatus(restored.campaign,'competition',TRACK_CATALOG[24]),'locked');
});
test('campaign placement pays outside the qualification cut and cannot disagree with the saved result', () => {
  const lost=complete(initialProgress(),'last-place',outcome(first,'competition',{rank:5}));
  assert.equal(lost.rewards['last-place'].placement,12);
  assert.equal(lost.rewards['last-place'].bonus,0); assert.equal(lost.balance,130);
  const won=complete(lost,'winner',outcome(first,'competition',{rank:1}));
  assert.equal(won.rewards.winner.placement,80); assert.equal(won.rewards.winner.bonus,125);
  assert.equal(won.rewards.winner.total,323);
  assert.deepEqual(complete(won,'winner',outcome(first,'competition',{rank:1})),won);
  for(const delta of [{mode:'time-attack'},{mode:'competition',rank:2}]) {
    assert.throws(()=>applyCommand(initialProgress(),{kind:'campaign-result',input:{...reward('mismatch'),...delta},outcome:outcome(first,'competition')}));
  }
});

test('old shop saves migrate without losing money, ownership, upgrades or rewards', () => {
  const p = initialProgress(); p.balance = 5000; delete p.campaign;
  const migrated = validateProgress(p);
  assert.equal(migrated.balance, 5000); assert.deepEqual(migrated.owned, p.owned);
  assert.equal(campaignStatus(migrated.campaign, 'time-attack', first), 'available');
  assert.equal(campaignStatus(migrated.campaign, 'time-attack', second), 'locked');
});
test('modes unlock independently, replays remain available and the first-clear bonus is paid once', () => {
  const initial = initialProgress(), cleared = complete(initial, 'a');
  assert.equal(campaignStatus(cleared.campaign, 'time-attack', first), 'cleared');
  assert.equal(campaignStatus(cleared.campaign, 'time-attack', second), 'available');
  assert.equal(campaignStatus(cleared.campaign, 'competition', second), 'locked');
  assert.equal(cleared.rewards.a.bonus, 125); assert.deepEqual(complete(cleared, 'a'), cleared);
  const replayed = complete(cleared, 'b'); assert.equal(replayed.rewards.b.bonus, 0); assert.ok(replayed.rewards.b.total > 0);
  assert.equal(replayed.campaign.modes['time-attack'][first.id].attempts, 2);
  assert.equal(initial.campaign.modes['time-attack'][first.id], undefined);
  const lost = complete(replayed, 'c', outcome(first, 'competition', { rank: 5 }));
  assert.equal(campaignStatus(lost.campaign, 'competition', second), 'locked');
  const won = complete(lost, 'd', outcome(first, 'competition'));
  assert.equal(campaignStatus(won.campaign, 'competition', second), 'available');
});
test('DQ gives no reward or best, and invalid/locked results never mutate progress', () => {
  const p = initialProgress(), dq = complete(p, 'dq', outcome(first, 'time-attack', { total: 10, laps: [], disqualified: true }));
  assert.equal(dq.balance, 0); assert.equal(dq.rewards.dq.total, 0);
  assert.deepEqual(dq.campaign.modes['time-attack'][first.id].records, {});
  assert.equal(campaignStatus(dq.campaign, 'time-attack', second), 'locked');
  for (const invalid of [outcome(second), outcome(first,'time-attack',{ lapLimit: 100000 }), outcome(first,'time-attack',{ total: 200 }), outcome(first,'time-attack',{ revision: 999 })]) assert.throws(() => complete(p, 'bad', invalid));
  assert.equal(p.balance, 0); assert.deepEqual(p.campaign, initialCampaign());
});
test('adding a track preserves old/retired progress and makes it available after its predecessor', () => {
  let p = initialProgress(); for (const track of TRACK_CATALOG) p = complete(p, track.id, outcome(track));
  const extended = [...TRACK_CATALOG, { ...first, id: 'new-district', order: TRACK_CATALOG.length + 1, predecessor: TRACK_CATALOG.at(-1).id }];
  validateTrackCatalog(extended);
  assert.equal(nextCampaignTrack(p.campaign, 'time-attack', extended).id, 'new-district');
  assert.equal(campaignStatus(p.campaign, 'time-attack', extended.at(-1)), 'available');
  p.campaign.modes['time-attack']['retired-track'] = structuredClone(p.campaign.modes['time-attack'][first.id]);
  assert.ok(validateCampaign(p.campaign).modes['time-attack']['retired-track']);
  assert.equal(validateProgress(p).campaign.knownTracks.includes('new-district'), false);
  assert.throws(() => validateTrackCatalog([...TRACK_CATALOG, first]));
  assert.throws(() => validateTrackCatalog([{ ...first, predecessor: first.id }]));
});

test('lap deadline ends immediately, pauses freeze it, retry resets it, and no best is written', () => {
  const track = { length: 500, halfWidth: 12, checkpointSpacing: 50, heightObstacles: [], sample: () => ({ curvature: 0 }) };
  const records = createRaceRecords({ trackId: 'deadline', configurationId: 'stock' });
  const race = createTimeAttack(track, DRONE_CATALOG[0].configuration.performance, records, 1, { lapLimit: 1 });
  race.start(); for(let i=0;i<30;i++) race.step(.1, NEUTRAL_INPUT);
  race.step(.1, NEUTRAL_INPUT); race.pause(); const paused = race.model.state.elapsed;
  for(let i=0;i<100;i++) race.step(.1, NEUTRAL_INPUT); assert.equal(race.model.state.elapsed, paused);
  race.start(); assert.equal(race.useFocus(), true);
  for(let i=0;i<20;i++) race.step(.1, NEUTRAL_INPUT);
  assert.equal(race.snapshot().disqualified, true); assert.equal(race.model.state.elapsed, 1);
  assert.equal(race.snapshot().result, null); assert.equal(records.read(), null);
  race.start(); assert.equal(race.snapshot().disqualified, false); assert.equal(race.model.state.elapsed, 0);
});
test('crossing the finish exactly at the limit is valid and a millisecond less disqualifies', () => {
  const track = { length: 50, halfWidth: 12, checkpointSpacing: 10, heightObstacles: [], sample: () => ({ curvature: 0 }) };
  const make = limit => createTimeAttack(track, DRONE_CATALOG[0].configuration.performance, createRaceRecords({ trackId: 'equality', configurationId: 'stock', laps: 1 }), 0, { laps: 1, lapLimit: limit });
  const finish = race => { race.start(); for (let i=0;i<1000 && race.phase !== 'finished';i++) race.step(.1, { ...NEUTRAL_INPUT, throttle: true }); return race; };
  const normal = finish(make(undefined)), deadline = normal.snapshot().finishTime;
  assert.equal(finish(make(deadline)).snapshot().disqualified, false);
  assert.equal(finish(make(deadline-.001)).snapshot().disqualified, true);
});

for (const definition of TRACK_CATALOG) test(`${definition.name}: five stock craft clear easy static fields under the limit with continuous orthogonal frames`, () => {
  const track = createCatalogTrack(definition, 'easy'), metrics = trackMetrics(track), limit = campaignLapLimit(definition, track.length);
  assert.ok(metrics.length > 1000); assert.equal(track.altitudeProfile.levels.length, definition.altitudeLevels);
  for (let d=0;d<track.length;d+=13) {
    const f=track.sample(d);
    assert.ok([...f.position.toArray(),...f.tangent.toArray(),...f.up.toArray()].every(Number.isFinite));
    assert.ok(Math.abs(f.tangent.dot(f.up)) < 1e-6); assert.ok(Math.abs(f.tangent.length()-1) < 1e-6);
  }
  const start = track.sample(0), seam = track.sample(track.length-.001);
  assert.ok(start.position.distanceTo(seam.position) < .01); assert.ok(start.tangent.dot(seam.tangent) > .999);
  for (const craft of DRONE_CATALOG) {
    const racer = createTimeAttack(track, craft.configuration.performance, createRaceRecords({ trackId: definition.id, configurationId: craft.name }), 0, { lapLimit: limit });
    racer.start();
    for(let tick=0;tick<30*(limit*3+4) && racer.phase !== 'finished';tick++) racer.step(1/30, aiDrivingInput(track, craft.configuration, racer.model.state, 1, []));
    assert.equal(racer.snapshot().disqualified, false, `${craft.name}: ${racer.model.state.distance}/${track.length} at ${limit}s`);
    assert.equal(racer.phase, 'finished', craft.name); assert.equal(racer.snapshot().completedLaps, 3);
    assert.equal(racer.model.state.offTrackExits, 0, craft.name);
    assert.equal(racer.model.state.collisions, 0, craft.name);
  }
});
test('district scenery is deterministic, instanced and omitted in the track overview', () => {
  for(const definition of TRACK_CATALOG.filter(t => t.order % 4 === 1)) {
    const track = createCatalogTrack(definition), a = createDistrictScenery(track, definition), b = createDistrictScenery(track, definition);
    assert.equal(a.object.children.length, 6); assert.ok(a.counts.buildings > 20); assert.ok(a.counts.windows > 50);
    assert.deepEqual(a.object.children[0].instanceMatrix.array, b.object.children[0].instanceMatrix.array);
    a.setOverview(true); assert.equal(a.object.visible,false); a.setOverview(false); assert.equal(a.object.visible,true);
    a.setQuality('low'); assert.ok(a.object.children[1].count < b.object.children[1].count);
    for(const scenery of [a,b]) disposeScenery(scenery.object);
  }
});

test('closed footprints include nine shapes and elevated crossings, with different course recipes', () => {
  const layouts = TRACK_CATALOG.map(t => t.layout).filter(Boolean);
  assert.equal(new Set(layouts.map(l => l.shape)).size, 9);
  assert.equal(new Set(layouts.map(l => JSON.stringify(l))).size, layouts.length);
  assert.ok(layouts.some(l => l.stunts.some(s => s.kind === 'loop')));
  assert.ok(layouts.some(l => l.stunts.some(s => s.kind === 'helix' && s.turns >= 4)));
  assert.ok(layouts.some(l => l.stunts.some(s => s.kind === 'roll' && s.turns === 2)));
  for(const def of TRACK_CATALOG.filter(t => t.layout?.shape === 'eight')) {
    const track=createCatalogTrack(def), a=track.sample(0);
    let b=track.sample(track.length/2), gap=Infinity;
    for(let d=track.length*.35;d<track.length*.65;d+=1) { const f=track.sample(d), next=Math.hypot(a.position.x-f.position.x,a.position.z-f.position.z); if(next<gap) { gap=next;b=f; } }
    assert.ok(Math.hypot(a.position.x-b.position.x,a.position.z-b.position.z) < 2);
    assert.ok(Math.abs(a.position.y-b.position.y) >= 65);
  }
});
test('non-adjacent road corridors stay apart and roll normals remain continuous', () => {
  for(const def of TRACK_CATALOG) {
    const track=createCatalogTrack(def), points=[];
    for(let d=0;d<track.length;d+=20)points.push(track.sample(d).position);
    for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++) {
      const arc=(j-i)*20;if(Math.min(arc,track.length-arc)<160)continue;
      assert.ok(points[i].distanceTo(points[j]) > track.halfWidth*2+12, `${def.name}: roads overlap at ${i*20}/${j*20}`);
    }
    for(let d=0;d<track.length;d+=2)assert.ok(track.sample(d).up.dot(track.sample(d+2).up) > .95, `${def.name}: abrupt roll at ${d}`);
  }
});
test('geometry revisions preserve completed access and older records while starting a new record slot', () => {
  let p=complete(initialProgress(),'first');p=complete(p,'second',outcome(second));
  const changed={...second,revision:second.revision+1};
  assert.equal(campaignStatus(p.campaign,'time-attack',changed),'cleared');
  assert.ok(p.campaign.modes['time-attack'][second.id].records[`${second.revision}:normal`]);
  assert.equal(p.campaign.modes['time-attack'][second.id].records[`${changed.revision}:normal`],undefined);
  for(const invalid of [{...second,lapLimit:0},{...second,laps:11},{...second,rating:NaN},{...second,halfWidth:Infinity},{...second,layout:{...second.layout,stunts:[{kind:'loop',start:.9,span:.2,radius:100,turns:1}]}}])assert.throws(()=>validateTrackCatalog([first,invalid]));
});

test('campaign keeps varied lap lengths, early stunts and difficulty relief between districts', () => {
  assert.deepEqual(TRACK_CATALOG.slice(0,4).map(t => t.id), ['window-run','terrace-flow','block-sprint','neon-circuit']);
  const lengths=TRACK_CATALOG.map(t => createCatalogTrack(t).length);
  assert.ok(Math.min(...lengths) < 3000);assert.ok(Math.max(...lengths)>5000);
  for(const n of lengths)assert.ok(n>=2000 && n<6000, `lap length ${n}`);
  assert.ok(lengths.at(-1)<lengths[18]*1.3);
  for(const t of TRACK_CATALOG)assert.ok(t.layout ? t.layout.stunts.length>=1 : createCatalogTrack(t).sections.length>=2);
  assert.deepEqual(new Set(TRACK_CATALOG[0].layout.stunts.map(s=>s.kind)),new Set(['loop','helix','roll']));
  assert.ok(TRACK_CATALOG[2].layout.stunts.length>=4);assert.ok(TRACK_CATALOG.at(-1).layout.stunts.length>=6);
  for(let i=4;i<TRACK_CATALOG.length;i+=4)assert.ok(TRACK_CATALOG[i].rating<TRACK_CATALOG[i-1].rating);
  for(let i=1;i<TRACK_CATALOG.length;i++)assert.ok(TRACK_CATALOG[i].rating-TRACK_CATALOG[i-1].rating<=1);
  assert.ok(Math.max(...TRACK_CATALOG.map(t=>t.rating))<=4);
  for(const t of TRACK_CATALOG)assert.ok(t.lapLimit>0);
  assert.ok(TRACK_CATALOG[12].rating>TRACK_CATALOG[0].rating && lengths[12]<lengths[0]);
});


test('a faster defeat or replay cannot overwrite the saved campaign passing result', () => {
  const progress = initialCampaign();
  const result = { mode: 'competition', trackId: first.id, revision: first.revision, total: 150, laps: [50,50,50], rank: 1, disqualified: false, assisted: true, lapLimit: campaignLapLimit(first) };
  completeCampaign(progress, result);
  completeCampaign(progress, { ...result, total: 120, laps: [40,40,40], rank: 5 });
  completeCampaign(progress, { ...result, total: 135, laps: [45,45,45] });
  const saved = validateCampaign(JSON.parse(JSON.stringify(progress)));
  assert.equal(saved.modes.competition[first.id].records[`${first.revision}:assisted`].rank, 5);
  assert.deepEqual(campaignClearRecord(saved, 'competition', first), { revision: first.revision, total: 150, laps: [50,50,50], rank: 1, assisted: true });
});

test('legacy clears display only verified passing records and all eight ranks persist', () => {
  const progress = initialCampaign();
  progress.modes.competition[first.id] = { cleared: true, attempts: 1, records: { [`${first.revision}:normal`]: { total: 120, laps: [40,40,40], rank: 8, assisted: false } } };
  assert.equal(campaignClearRecord(validateCampaign(progress), 'competition', first), undefined);
  progress.modes.competition[first.id].records[`${first.revision}:normal`].rank = 1;
  assert.equal(campaignClearRecord(progress, 'competition', first).rank, 1);
  progress.modes.competition[first.id].records[`${first.revision}:normal`].rank = 9;
  assert.throws(() => validateCampaign(progress));
});

test('eighth-place campaign results are accepted but do not unlock the next course', () => {
  const progress = initialCampaign();
  const result = { mode: 'competition', trackId: first.id, revision: first.revision, total: 120, laps: [40,40,40], rank: 8, disqualified: false, assisted: false, lapLimit: campaignLapLimit(first) };
  assert.equal(completeCampaign(progress, result).passed, false);
  assert.equal(campaignStatus(progress, 'competition', second), 'locked');
  assert.equal(validateCampaign(progress).modes.competition[first.id].records[`${first.revision}:normal`].rank, 8);
  assert.throws(() => completeCampaign(progress, { ...result, rank: 9 }));
  progress.modes.competition[first.id].clearRecord = { ...result, revision: first.revision };
  assert.throws(() => validateCampaign(progress));
});

test('a recoverable legacy winning record survives a faster losing replay', () => {
  const progress = initialCampaign();
  const old = { total: 150, laps: [50,50,50], rank: 1, assisted: false };
  progress.modes.competition[first.id] = { cleared: true, attempts: 1, records: { [`${first.revision}:normal`]: old } };
  completeCampaign(progress, { mode: 'competition', trackId: first.id, revision: first.revision, total: 120, laps: [40,40,40], rank: 5, disqualified: false, assisted: false, lapLimit: campaignLapLimit(first) });
  const saved = validateCampaign(JSON.parse(JSON.stringify(progress)));
  assert.equal(saved.modes.competition[first.id].records[`${first.revision}:normal`].rank, 5);
  assert.deepEqual(campaignClearRecord(saved, 'competition', first), { ...old, revision: first.revision });
});


test('Competition qualifying ranks follow difficulty and persist without losing first-clear history', () => {
  assert.deepEqual([1,2,3,4,5,6].map(rating => campaignRankLimit({ rating })), [4,4,3,3,2,2]);
  for (const rating of [1,2,3,4]) {
    const track = TRACK_CATALOG.find(t => t.rating === rating);
    const progress = initialCampaign();
    if (track.predecessor) progress.modes.competition[track.predecessor] = { cleared: true, attempts: 1, records: {} };
    const limit = campaignRankLimit(track);
    assert.equal(completeCampaign(progress, outcome(track, 'competition', { rank: limit, disqualified: true })).passed, false);
    assert.throws(() => completeCampaign(progress, outcome(track, 'competition', { rank: limit, total: 80, laps: [40,40] })), /랩 합계/);
    assert.equal(completeCampaign(progress, outcome(track, 'competition', { rank: limit + 1 })).passed, false);
    const result = completeCampaign(progress, outcome(track, 'competition', { rank: limit }));
    assert.equal(result.passed, true);
    assert.equal(result.firstClear, true);
    const next = TRACK_CATALOG.find(t => t.predecessor === track.id);
    assert.equal(campaignStatus(progress, 'competition', next), 'available');
    const saved = validateCampaign(JSON.parse(JSON.stringify(progress)));
    assert.equal(campaignClearRecord(saved, 'competition', track).rank, limit);
    const replay = completeCampaign(saved, outcome(track, 'competition'));
    assert.equal(replay.passed, true);
    assert.equal(replay.bonus, 0);
    assert.equal(campaignClearRecord(saved, 'competition', track).rank, limit);
  }
});
