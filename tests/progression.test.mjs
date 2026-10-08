import test from 'node:test';
import assert from 'node:assert/strict';
import { initialProgress, applyCommand, validateProgress, calculateReward, PLACEMENT_POINTS } from '../output/test/game/progression/progress.js';
import { upgradedConfiguration, STARTER_ID, emptyLevels } from '../output/test/game/progression/catalog.js';
import { createProgressStore } from '../output/test/game/progression/progressStore.js';
const input = { raceId: 'race-1', difficulty: 'beginner', collisions: 0, offTrackExits: 0, recoveries: 0, penaltyPoints: 0, cleanHalfLaps: 6, improvedExistingBest: false, assisted: false };
const funded = balance => ({ ...initialProgress(), balance });
test('competitive finish positions earn distinct bonuses, while time attacks and old receipts stay unchanged', () => {
  assert.deepEqual(PLACEMENT_POINTS, [80,55,35,20,12,8,4,0]);
  for (const [index, bonus] of PLACEMENT_POINTS.entries()) {
    const reward = calculateReward({...input, mode:'competition', rank:index+1});
    assert.equal(reward.placement, bonus); assert.equal(reward.total, 118+bonus);
  }
  assert.equal(calculateReward({...input, mode:'time-attack',rank:1}).total,118);
  assert.equal(calculateReward({...input, mode:'competition',rank:1,assisted:true}).total,178);
  for (const rank of [undefined,0,9,1.5,NaN]) assert.throws(()=>calculateReward({...input,mode:'competition',rank}));
  const paid=applyCommand(initialProgress(),{kind:'reward',input:{...input,mode:'competition',rank:2}});
  assert.equal(validateProgress(paid).balance,173);
  assert.deepEqual(applyCommand(paid,{kind:'reward',input:{...input,mode:'competition',rank:1}}),paid);
  const old=applyCommand(initialProgress(),{kind:'reward',input}); delete old.rewards[input.raceId].placement;
  assert.equal(validateProgress(old).balance,118);
  const corrupt=structuredClone(paid); corrupt.rewards[input.raceId].placement=80;
  assert.throws(()=>validateProgress(corrupt));
});
test('tier rewards, clean bonus, real best bonus and off-course deductions share one idempotent ledger', () => {
  for (const [difficulty, base] of [['beginner',100],['intermediate',150],['advanced',220]]) assert.equal(calculateReward({...input,difficulty}).total,base+18);
  assert.equal(calculateReward({...input,improvedExistingBest:true}).total,148);
  assert.equal(calculateReward({...input,offTrackExits:1,penaltyPoints:7,cleanHalfLaps:5}).total,108);
  assert.equal(calculateReward({...input,penaltyPoints:1000}).total,0);
  assert.equal(calculateReward({...input,assisted:true,improvedExistingBest:true}).total,98);
  const before=initialProgress(); const paid=applyCommand(before,{kind:'reward',input});
  assert.equal(before.balance,0); assert.equal(paid.balance,118);
  assert.deepEqual(applyCommand(paid,{kind:'reward',input:{...input,difficulty:'advanced'}}),paid);
});
test('ownership, affordability and three upgrade levels are enforced without mutating the profile', () => {
  const p=funded(3000); assert.throws(()=>applyCommand(p,{kind:'equip',id:'needle'}));
  const bought=applyCommand(p,{kind:'craft',id:'needle'}); assert.equal(bought.balance,1800);
  assert.throws(()=>applyCommand(bought,{kind:'craft',id:'needle'}));
  assert.equal(applyCommand(bought,{kind:'equip',id:'needle'}).equipped,'needle');
  assert.throws(()=>applyCommand(initialProgress(),{kind:'craft',id:'halo'}));
  let upgraded=bought; for(let i=0;i<3;i++) upgraded=applyCommand(upgraded,{kind:'upgrade',id:'needle',upgrade:'engine'});
  assert.equal(upgraded.balance,200); assert.equal(upgraded.upgrades.needle.engine,3);
  assert.throws(()=>applyCommand(upgraded,{kind:'upgrade',id:'needle',upgrade:'engine'}));
  assert.deepEqual(p,funded(3000));
});
test('upgrades are derived once from each base craft and affect boost, handling, brakes and battery', () => {
  const base=upgradedConfiguration(STARTER_ID,emptyLevels()); const upgraded=upgradedConfiguration(STARTER_ID,{engine:3,brakes:3,steering:3,stabilizer:3,battery:3});
  assert.equal(upgraded.performance.topSpeed,base.performance.topSpeed*1.12);
  assert.ok(Math.abs(upgraded.performance.boostStage2Speed-base.performance.boostStage2Speed*1.12)<1e-10);
  assert.ok(Math.abs(upgraded.performance.braking-base.performance.braking*1.36)<1e-10);
  assert.ok(upgraded.performance.maxYawRate>base.performance.maxYawRate);
  assert.equal(upgraded.performance.lateralBraking,base.performance.lateralBraking*1.75);
  assert.ok(upgraded.performance.highSpeedSteeringLoss<base.performance.highSpeedSteeringLoss);
  assert.ok(upgraded.performance.boostDrain<base.performance.boostDrain);
  assert.deepEqual(upgradedConfiguration(STARTER_ID,{engine:3,brakes:3,steering:3,stabilizer:3,battery:3}),upgraded);
});
test('old four-upgrade profiles gain a separate stabilizer without losing purchased levels or progress', () => {
  const old = applyCommand(funded(5000), {kind:'craft',id:'needle'});
  old.upgrades[STARTER_ID].engine = 2;
  old.upgrades.needle.steering = 3;
  for (const levels of Object.values(old.upgrades)) delete levels.stabilizer;
  const migrated = validateProgress(old);
  assert.equal(old.upgrades.needle.stabilizer, undefined, 'migration does not mutate the saved input');
  assert.equal(migrated.balance, old.balance);
  assert.deepEqual(migrated.campaign, old.campaign);
  assert.equal(migrated.upgrades[STARTER_ID].engine, 2);
  assert.equal(migrated.upgrades.needle.steering, 3);
  assert.equal(migrated.upgrades.needle.stabilizer, 0);
  let purchased = migrated;
  for (let i = 0; i < 3; i++) purchased = applyCommand(purchased, {kind:'upgrade',id:'needle',upgrade:'stabilizer'});
  assert.equal(purchased.balance, migrated.balance - 1600);
  assert.equal(purchased.upgrades.needle.stabilizer, 3);
  assert.equal(purchased.upgrades.needle.steering, 3);
  assert.throws(() => applyCommand(purchased, {kind:'upgrade',id:'needle',upgrade:'stabilizer'}));
  assert.deepEqual(validateProgress(JSON.parse(JSON.stringify(purchased))), purchased);
  delete old.upgrades.needle.engine;
  assert.throws(() => validateProgress(old), 'an incomplete old record still fails');
});
test('focus reserve/confirm/refund receipts prevent duplicate consumption and protect stock capacity',()=>{
  let p=applyCommand(funded(600),{kind:'focus'}); p=applyCommand(p,{kind:'slots',count:1});
  const reserve=applyCommand(p,{kind:'consume-focus',id:'r:1'}); assert.equal(reserve.focus,0);
  assert.deepEqual(applyCommand(reserve,{kind:'consume-focus',id:'r:1'}),reserve);
  const refund=applyCommand(reserve,{kind:'refund-focus',id:'r:1'}); assert.equal(refund.focus,1);
  assert.deepEqual(applyCommand(refund,{kind:'refund-focus',id:'r:1'}),refund);
  const use=applyCommand(refund,{kind:'consume-focus',id:'r:2'}); const confirmed=applyCommand(use,{kind:'confirm-focus',id:'r:2'});
  assert.equal(applyCommand(confirmed,{kind:'refund-focus',id:'r:2'}).focus,0);
  assert.throws(()=>applyCommand(confirmed,{kind:'slots',count:2}));
  const full=applyCommand({...funded(100),focus:99},{kind:'consume-focus',id:'full'});
  assert.throws(()=>applyCommand(full,{kind:'focus'})); assert.equal(applyCommand(full,{kind:'refund-focus',id:'full'}).focus,99);
});
test('invalid saved balances, craft IDs, upgrade levels and item quantities are rejected',()=>{
  for(const delta of [{balance:-1},{balance:.5},{focus:100},{owned:['unknown']},{equipped:'halo'},{upgrades:{[STARTER_ID]:{...emptyLevels(),engine:4}}}]) assert.throws(()=>validateProgress({...initialProgress(),...delta}));
  assert.throws(()=>calculateReward({...input,assisted:'true'}));
});
test('serialized purchases and rewards always read the committed profile; failures keep the prior balance',async()=>{
  let saved=funded(1400); let chain=Promise.resolve(); let fail=false;
  const repo={read:async()=>structuredClone(saved),close(){},transact(change){const operation=chain.then(()=>{if(fail)throw Error('quota');saved=change(saved);return structuredClone(saved);});chain=operation.catch(()=>{});return operation;}};
  const a=createProgressStore(repo),b=createProgressStore(repo);
  try{
    await Promise.all([a.refresh(),b.refresh()]);
    const purchases=await Promise.allSettled([a.command({kind:'craft',id:'needle'}),b.command({kind:'craft',id:'hammerhead'})]);
    assert.equal(purchases.filter(x=>x.status==='fulfilled').length,1);assert.equal(saved.balance,200);assert.equal(saved.owned.length,2);
    await Promise.all([a.command({kind:'reward',input}),b.command({kind:'reward',input})]); assert.equal(saved.balance,318);
    await b.refresh();assert.equal(b.snapshot().balance,318);
    fail=true;await assert.rejects(b.command({kind:'focus'}));assert.equal(b.snapshot().balance,318);assert.match(b.issue,/quota/);
  }finally{a.close();b.close();}
});

test('selling refunds 80% of the craft price, removes its upgrades and equips the starter if needed', () => {
  const bought = applyCommand(funded(3000), {kind:'craft',id:'needle'});
  const upgraded = applyCommand(bought, {kind:'upgrade',id:'needle',upgrade:'engine'});
  const equipped = applyCommand(upgraded, {kind:'equip',id:'needle'});
  const sold = applyCommand(equipped, {kind:'sell-craft',id:'needle'});
  assert.equal(sold.balance,2460); // 3000 - 1200 - 300 + 960
  assert.equal(sold.equipped,STARTER_ID);
  assert.deepEqual(sold.owned,[STARTER_ID]);
  assert.equal(sold.upgrades.needle,undefined);
  assert.deepEqual(sold.upgrades[STARTER_ID],emptyLevels());
  assert.equal(equipped.upgrades.needle.engine,1);
  assert.throws(() => applyCommand(sold,{kind:'sell-craft',id:'needle'}));
  assert.throws(() => applyCommand(sold,{kind:'sell-craft',id:STARTER_ID}));
  assert.throws(() => applyCommand(sold,{kind:'sell-craft',id:'unknown'}));
  const rebought=applyCommand(sold,{kind:'craft',id:'needle'});
  assert.equal(rebought.balance,1260);
  assert.deepEqual(rebought.upgrades.needle,emptyLevels());
});

test('selling an unequipped craft preserves the active craft and refunds exactly once across stores', async () => {
  let saved=applyCommand(applyCommand(funded(3000),{kind:'craft',id:'halo'}),{kind:'craft',id:'hammerhead'});
  saved=applyCommand(saved,{kind:'equip',id:'halo'});
  let chain=Promise.resolve();
  const repo={read:async()=>structuredClone(saved),close(){},transact(change){const op=chain.then(()=>{saved=change(saved);return structuredClone(saved);});chain=op.catch(()=>{});return op;}};
  const a=createProgressStore(repo),b=createProgressStore(repo);
  try {
    const results=await Promise.allSettled([a.command({kind:'sell-craft',id:'hammerhead'}),b.command({kind:'sell-craft',id:'hammerhead'})]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(saved.balance,1400);
    assert.equal(saved.equipped,'halo');
    assert.deepEqual(saved.owned,[STARTER_ID,'halo']);
  } finally { a.close();b.close(); }
});
