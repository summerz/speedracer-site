import test from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_TEST_TRACKS, resolveDriveTrack, isFeatureTestTrack, featureTestTrackHref } from '../output/test/game/track/featureTestTracks.js';
import { TRACK_CATALOG, DISTRICTS, trackDefinition, validateTrackCatalog } from '../output/test/game/track/trackCatalog.js';
import { createCatalogTrack } from '../output/test/game/track/trackRuntime.js';
import { selectRaceEnvironment, previewRaceEnvironment, raceEnvironmentsForDistrict, NIGHT_ENVIRONMENTS, UNDERWATER_ENVIRONMENTS, ABYSS_ENVIRONMENTS } from '../output/test/game/environment/raceEnvironment.js';
import { initialProgress, applyCommand } from '../output/test/game/progression/progress.js';
import { createTimeAttack } from '../output/test/game/driving/createTimeAttack.js';
import { createRaceRecords } from '../output/test/game/driving/raceRecords.js';
import { aiDrivingInput } from '../output/test/game/driving/createRaceSession.js';
import { DRONE_CATALOG } from '../output/test/game/drone/droneCatalog.js';

const definition = FEATURE_TEST_TRACKS[0];

test('abyss recipe is opt-in and never extends campaign identities or unlocks', () => {
  assert.equal(FEATURE_TEST_TRACKS.length, 1);
  assert.equal(definition.district, 'abyss');
  assert.equal(definition.laps, 1);
  assert.ok(DISTRICTS.abyss);
  assert.equal(TRACK_CATALOG.length, 48);
  assert.ok(TRACK_CATALOG.every(track => track.id !== definition.id));
  assert.doesNotThrow(() => validateTrackCatalog(FEATURE_TEST_TRACKS));
  assert.equal(trackDefinition(definition.id), undefined);
  assert.equal(resolveDriveTrack(definition.id, false), undefined);
  assert.equal(resolveDriveTrack(definition.id, true), definition);
  assert.equal(resolveDriveTrack('invalid', true), undefined);
  assert.equal(isFeatureTestTrack(definition.id), true);
  assert.equal(isFeatureTestTrack('voltage-yard'), false);
  assert.equal(resolveDriveTrack('voltage-yard', true), trackDefinition('voltage-yard'));
  assert.equal(resolveDriveTrack('window-run', false), TRACK_CATALOG[0]);
  const params = new URLSearchParams(featureTestTrackHref(definition.id).split('?')[1]);
  assert.equal(params.get('test'), '1');
  assert.equal(resolveDriveTrack(params.get('track'), params.get('test') === '1'), definition);
});

test('test recipe cannot be submitted as a rewarded campaign result', () => {
  const profile = initialProgress(), before = structuredClone(profile);
  assert.throws(() => applyCommand(profile, {
    kind: 'campaign-result',
    input: { raceId: 'abyss-test', difficulty: 'beginner', collisions: 0, offTrackExits: 0, recoveries: 0, penaltyPoints: 0, cleanHalfLaps: 2, improvedExistingBest: false, assisted: false },
    outcome: { mode: 'time-attack', trackId: definition.id, revision: 1, total: 40, laps: [40], rank: 1, disqualified: false, assisted: false, lapLimit: 60 },
  }));
  assert.deepEqual(profile, before);
  assert.throws(() => applyCommand(profile, { kind: 'campaign-select', trackId: definition.id, mode: 'time-attack' }));
});

test('abyss selects only underwater profiles and surface districts retain their five choices', () => {
  assert.equal(raceEnvironmentsForDistrict('abyss'), ABYSS_ENVIRONMENTS);
  assert.deepEqual(ABYSS_ENVIRONMENTS.map(e => e.id), ['abyss-shallow', 'abyss-deep']);
  for (const value of [-1, 0, .499, .5, .999, 1, 3, NaN, Infinity]) {
    const expected = Number.isFinite(value) && value >= .5 ? 'abyss-deep' : 'abyss-shallow';
    const environment = selectRaceEnvironment('abyss', () => value);
    assert.equal(environment.id, expected);
    assert.equal(environment.underwater, true);
    assert.equal(environment.rain, false);
    assert.equal(environment.stars, 0);
    assert.equal(environment.celestial, 'none');
  }
  for (const district of new Set(TRACK_CATALOG.filter(track => track.order <= 32).map(track => track.district))) {
    assert.equal(raceEnvironmentsForDistrict(district), NIGHT_ENVIRONMENTS);
    assert.equal(selectRaceEnvironment(district, () => .75).id, 'afterglow');
  }
  assert.equal(selectRaceEnvironment(undefined, () => { throw Error('not called'); }).id, 'midnight');
});

test('development weather preview preserves underwater profile identity on restart', () => {
  for (const environment of UNDERWATER_ENVIRONMENTS) {
    for (const rain of [true, false, undefined]) assert.equal(previewRaceEnvironment(environment, rain), environment);
  }
  assert.equal(previewRaceEnvironment(NIGHT_ENVIRONMENTS[0], true).id, 'storm-night');
  assert.equal(previewRaceEnvironment(NIGHT_ENVIRONMENTS[4], false).id, 'midnight');
  assert.equal(previewRaceEnvironment(NIGHT_ENVIRONMENTS[2], false), NIGHT_ENVIRONMENTS[2]);
});

test('underwater test lap is closed and every stock craft finishes without saving a record', () => {
  for (const challenge of ['easy', 'normal', 'hard']) {
    const track = createCatalogTrack(definition, challenge);
    assert.ok(track.sample(0).position.distanceTo(track.sample(track.length - .001).position) < .01);
    assert.equal(track.altitudeProfile.levels.length, 2);
    for (const craft of DRONE_CATALOG) {
      let writes = 0;
      const records = createRaceRecords({ trackId: definition.id, configurationId: craft.name, laps: 1 }, { getItem: () => null, setItem: () => { writes++; } });
      const racer = createTimeAttack(track, craft.configuration.performance, records, 0, { laps: 1, lapLimit: definition.lapLimit, practice: true });
      racer.start();
      for (let tick = 0; tick < 30 * 100 && racer.phase !== 'finished'; tick++) {
        racer.step(1 / 30, aiDrivingInput(track, craft.configuration, racer.model.state, 1, []));
      }
      assert.equal(racer.phase, 'finished', `${challenge}/${craft.name}`);
      assert.equal(racer.snapshot().completedLaps, 1);
      assert.equal(racer.model.state.offTrackExits, 0, `${challenge}/${craft.name}`);
      assert.equal(racer.snapshot().lapLimit, null);
      assert.equal(racer.snapshot().result, null);
      assert.equal(records.read(), null);
      assert.equal(writes, 0);
    }
  }
});
