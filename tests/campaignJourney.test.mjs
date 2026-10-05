import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACK_CATALOG, campaignLapLimit, campaignRankLimit } from '../output/test/game/track/trackCatalog.js';
import { createCatalogTrack, trackPreset } from '../output/test/game/track/trackRuntime.js';
import { DRONE_CATALOG } from '../output/test/game/drone/droneCatalog.js';
import { createRaceSession, aiDrivingInput } from '../output/test/game/driving/createRaceSession.js';
import { createRaceRecords } from '../output/test/game/driving/raceRecords.js';
import { initialProgress, applyCommand, validateProgress } from '../output/test/game/progression/progress.js';
import { campaignStatus } from '../output/test/game/progression/campaign.js';

// Exercise the running session and use its actual result, rather than inventing lap times/ranks.
function runCourse(definition, configuration, mode, platform, slowStart = false) {
  const track = createCatalogTrack(definition);
  const race = createRaceSession(track, configuration,
    createRaceRecords({ trackId: definition.id, configurationId: `${platform}-${mode}`, laps: definition.laps }),
    0, mode, () => .55, platform,
    { laps: definition.laps, ...(mode === 'time-attack' ? { lapLimit: campaignLapLimit(definition) } : {}) },
    definition.rating);
  race.start();
  let ticks = 0;
  const step = () => {
    const controls = aiDrivingInput(track, configuration, race.model.state, 1,
      race.rivals.map(rival => rival.controller.model.state));
    if (slowStart && race.model.state.elapsed < 90) { controls.brake = true; controls.boost = false; }
    race.step(1 / 30, controls);
    ticks++;
  };
  while (race.phase !== 'finished' && ticks < 30 * 600) step();
  const snapshot = race.snapshot();
  assert.equal(race.phase, 'finished', `${definition.name}: player must finish`);
  assert.equal(snapshot.disqualified, false, definition.name);
  assert.equal(snapshot.completedLaps, definition.laps, definition.name);
  const command = {
    kind: 'campaign-result',
    input: {
      raceId: snapshot.raceId, difficulty: trackPreset(definition).id,
      collisions: race.model.state.collisions, offTrackExits: race.model.state.offTrackExits,
      recoveries: race.model.state.recoveries, penaltyPoints: race.model.state.penaltyPoints, cleanHalfLaps: snapshot.cleanHalfLaps,
      improvedExistingBest: !!snapshot.result?.improvedExistingBest, assisted: snapshot.assisted,
    },
    outcome: {
      mode, trackId: definition.id, revision: definition.revision,
      total: race.model.state.elapsed, laps: snapshot.lapTimes,
      rank: snapshot.competition?.playerRank ?? 1, disqualified: snapshot.disqualified,
      assisted: snapshot.assisted, lapLimit: snapshot.lapLimit ?? 1,
    },
  };
  if (mode === 'competition') {
    // The UI saves at the player's finish, while the remaining AI continue as ghosts.
    while (!race.snapshot().competition.complete && ticks < 30 * 600) step();
    const final = race.snapshot().competition;
    assert.equal(final.complete, true, `${definition.name}: all AI must finish`);
    assert.equal(final.playerRank, command.outcome.rank, 'finishing AI cannot change the saved rank');
    assert.ok(final.standings.every(entry => entry.completedLaps === definition.laps && entry.finishTime > 0));
    assert.ok(race.rivals.every(rival => rival.controller.model.state.offTrackExits === 0));
  }
  return command;
}

for (const platform of ['desktop', 'touch']) {
  test(`${platform}: earn points across 24 time attacks, buy a craft, clear 24 races and reload/replay safely`, () => {
    let progress = initialProgress();
    const starter = DRONE_CATALOG[0].configuration;
    for (const definition of TRACK_CATALOG) {
      assert.equal(campaignStatus(progress.campaign, 'time-attack', definition), 'available');
      const command = runCourse(definition, starter, 'time-attack', platform);
      const before = progress.balance;
      progress = applyCommand(progress, command);
      assert.equal(campaignStatus(progress.campaign, 'time-attack', definition), 'cleared');
      assert.equal(progress.rewards[command.input.raceId].bonus, 100 + definition.rating * 25);
      assert.ok(progress.balance > before);
      assert.deepEqual(applyCommand(progress, command), progress, 'retrying a save must not pay twice');
      progress = validateProgress(JSON.parse(JSON.stringify(progress)));
    }
    assert.equal(campaignStatus(progress.campaign, 'competition', TRACK_CATALOG[1]), 'locked');
    const needle = DRONE_CATALOG.find(craft => craft.configuration.modelVariant === 'needle').configuration;
    progress = applyCommand(progress, { kind: 'craft', id: needle.id });
    progress = applyCommand(progress, { kind: 'equip', id: needle.id });
    assert.equal(progress.equipped, needle.id);

    const loss = runCourse(TRACK_CATALOG[0], starter, 'competition', platform, true);
    assert.ok(loss.outcome.rank > campaignRankLimit(TRACK_CATALOG[0]), 'a slow start must finish below the qualification cutoff');
    const beforeLoss = progress.balance;
    progress = applyCommand(progress, loss);
    assert.ok(progress.balance > beforeLoss, 'a completed losing race still pays a finish reward');
    assert.equal(progress.rewards[loss.input.raceId].bonus, 0);
    assert.equal(campaignStatus(progress.campaign, 'competition', TRACK_CATALOG[1]), 'locked');

    for (const definition of TRACK_CATALOG) {
      assert.equal(campaignStatus(progress.campaign, 'competition', definition), 'available');
      const command = runCourse(definition, needle, 'competition', platform);
      assert.ok(command.outcome.rank <= campaignRankLimit(definition), `${definition.name}: finish within the qualification cutoff`);
      progress = applyCommand(progress, command);
      assert.equal(campaignStatus(progress.campaign, 'competition', definition), 'cleared');
      assert.equal(progress.rewards[command.input.raceId].bonus, 100 + definition.rating * 25);
      assert.deepEqual(applyCommand(progress, command), progress);
      progress = validateProgress(JSON.parse(JSON.stringify(progress)));
    }
    for (const mode of ['time-attack', 'competition']) {
      const command = runCourse(TRACK_CATALOG[0], needle, mode, platform);
      const before = progress.balance;
      progress = applyCommand(progress, command);
      assert.ok(progress.balance > before);
      assert.equal(progress.rewards[command.input.raceId].bonus, 0, 'replays pay no second first-clear bonus');
      assert.ok(TRACK_CATALOG.every(track => campaignStatus(progress.campaign, mode, track) === 'cleared'));
    }
    const reloaded = validateProgress(JSON.parse(JSON.stringify(progress)));
    assert.deepEqual(reloaded, progress);
    assert.equal(reloaded.equipped, needle.id);
    assert.ok(reloaded.owned.includes(needle.id));
  });
}
