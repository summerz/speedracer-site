import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACK_CATALOG, validateTrackCatalog } from '../output/test/game/track/trackCatalog.js';
import { CITY_CATALOG, DISTRICT_CITY, cityForDistrict, cityDefinition, campaignTracksForCity, MARINE_GATE_TRACK_ID } from '../output/test/game/track/cityCatalog.js';
import { FEATURE_TEST_TRACKS } from '../output/test/game/track/featureTestTracks.js';
import { initialProgress, applyCommand, validateProgress } from '../output/test/game/progression/progress.js';
import { campaignStatus, campaignCityStatus } from '../output/test/game/progression/campaign.js';
import { challengeLapLimit } from '../output/test/game/track/raceChallenge.js';
import { MARINE_ZONES } from '../output/test/game/environment/marineZones.js';
import { raceEnvironmentsForDistrict, selectRaceEnvironment, UNDERWATER_ENVIRONMENTS, NIGHT_ENVIRONMENTS } from '../output/test/game/environment/raceEnvironment.js';

const neon = campaignTracksForCity('neon'), marine = campaignTracksForCity('marine');
const modes = ['time-attack', 'competition'];
function clear(profile, track, mode, challenge = 'normal', raceId = `${mode}:${track.id}:${challenge}`) {
  return applyCommand(profile, { kind: 'campaign-result',
    input: { raceId, difficulty: 'beginner', collisions: 0, offTrackExits: 0, recoveries: 0, penaltyPoints: 0, cleanHalfLaps: 6, improvedExistingBest: false, assisted: false },
    outcome: { mode, trackId: track.id, revision: track.revision, total: 120, laps: [40,40,40], rank: 1, disqualified: false, assisted: false, challenge, lapLimit: challengeLapLimit(track, challenge) },
  });
}

test('city membership partitions the campaign and leaves feature tests outside it', () => {
  validateTrackCatalog(TRACK_CATALOG);
  assert.deepEqual(CITY_CATALOG.map(city => city.id), ['neon', 'marine']);
  assert.equal(neon.length, 32); assert.equal(marine.length, 16);
  assert.equal(MARINE_GATE_TRACK_ID, neon[31].id);
  assert.deepEqual(marine.map(track => track.order), Array.from({length:16}, (_, index) => 33 + index));
  assert.equal(marine[0].predecessor, null);
  for (let index=1; index<marine.length; index++) assert.equal(marine[index].predecessor, marine[index-1].id);
  for (const city of CITY_CATALOG) {
    assert.equal(cityDefinition(city.id), city);
    for (const district of city.districts) assert.equal(cityForDistrict(district), city.id);
    assert.ok(campaignTracksForCity(city.id).every(track => city.districts.includes(track.district)));
  }
  assert.equal(Object.keys(DISTRICT_CITY).length, 12);
  for (const district of cityDefinition('marine').districts) {
    const courses = marine.filter(track => track.district === district);
    assert.deepEqual(courses.map(track => track.rating), [1,2,3,4]);
    assert.deepEqual(courses.map(track => track.altitudeLevels), [2,2,3,4]);
    assert.ok(courses.every(track => /^[A-Z]+ [A-Z]+$/.test(track.name)));
    assert.ok(new Set(courses.map(track => track.layout.shape)).size >= 3);
  }
  assert.ok(FEATURE_TEST_TRACKS.every(testTrack => !TRACK_CATALOG.some(track => track.id === testTrack.id)));
});

test('either mode and every difficulty can open Marine City while its track progression remains per mode', () => {
  for (const gateMode of modes) for (const challenge of ['easy','normal','hard']) {
    let profile = initialProgress();
    for (const mode of modes) {
      assert.equal(campaignCityStatus(profile.campaign, mode, 'marine'), 'locked');
      assert.equal(campaignStatus(profile.campaign, mode, marine[0]), 'locked');
      assert.throws(() => clear(profile, marine[0], mode));
    }
    for (const track of neon.slice(0,-1)) profile = clear(profile, track, gateMode, challenge);
    assert.equal(campaignCityStatus(profile.campaign, gateMode, 'marine'), 'locked');
    profile = clear(profile, neon.at(-1), gateMode, challenge);
    for (const mode of modes) {
      assert.equal(campaignCityStatus(profile.campaign, mode, 'marine'), 'available');
      assert.equal(campaignStatus(profile.campaign, mode, marine[0]), 'available');
      assert.equal(campaignStatus(profile.campaign, mode, marine[1]), 'locked');
    }
    profile = clear(profile, marine[0], gateMode, challenge);
    assert.equal(campaignStatus(profile.campaign, gateMode, marine[1]), 'available');
    const otherMode = modes.find(mode => mode !== gateMode);
    assert.equal(campaignStatus(profile.campaign, otherMode, marine[1]), 'locked');
    assert.equal(campaignStatus(profile.campaign, otherMode, neon[1]), 'locked');
    assert.equal(profile.rewards[`${gateMode}:${marine[0].id}:${challenge}`].bonus, 125);
    profile = clear(profile, marine[0], gateMode, challenge, 'replay');
    assert.equal(profile.rewards.replay.bonus, 0);
    for (const track of marine.slice(1)) profile = clear(profile, track, gateMode, challenge);
    assert.equal(campaignCityStatus(profile.campaign, gateMode, 'marine'), 'cleared');
    assert.equal(campaignCityStatus(profile.campaign, otherMode, 'marine'), 'available');
    assert.deepEqual(JSON.parse(JSON.stringify(validateProgress(profile))), JSON.parse(JSON.stringify(profile)));
  }
});

test('old Neon saves retain currency, upgrades and records and immediately unlock both Marine entries', () => {
  let profile = initialProgress();
  for (const track of neon) profile = clear(profile, track, 'time-attack');
  profile.campaign.knownTracks = neon.map(track => track.id);
  // Old pre-difficulty clears are still valid gate evidence.
  delete profile.campaign.modes['time-attack'][MARINE_GATE_TRACK_ID].difficulties;
  const saved = JSON.parse(JSON.stringify(profile)), restored = validateProgress(saved);
  assert.deepEqual(restored, saved);
  for (const mode of modes) assert.equal(campaignStatus(restored.campaign, mode, marine[0]), 'available');
  assert.equal(campaignCityStatus(restored.campaign, 'time-attack', 'neon'), 'cleared');
});

test('every marine district uses the exact zone environment pool and never falls back to a night sky', () => {
  for (const district of cityDefinition('marine').districts) {
    const zone = MARINE_ZONES.find(zone => zone.id === (district === 'abyss' ? 'trench' : district));
    assert.equal(raceEnvironmentsForDistrict(district), zone.environments);
    for (const random of [0, .499, .5, .999, 1, NaN]) {
      const environment = selectRaceEnvironment(district, () => random);
      assert.ok(zone.environments.includes(environment));
      assert.equal(environment.underwater, true); assert.equal(environment.rain, false);
      assert.equal(environment.stars, 0); assert.equal(environment.celestial, 'none');
    }
  }
  assert.deepEqual(UNDERWATER_ENVIRONMENTS, MARINE_ZONES.flatMap(zone => zone.environments));
  for (const district of cityDefinition('neon').districts) assert.equal(raceEnvironmentsForDistrict(district), NIGHT_ENVIRONMENTS);
  assert.equal(raceEnvironmentsForDistrict('unknown'), NIGHT_ENVIRONMENTS);
});
