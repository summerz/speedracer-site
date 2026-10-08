import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACK_CATALOG } from '../output/test/game/track/trackCatalog.js';
import { createCatalogTrack } from '../output/test/game/track/trackRuntime.js';
import { DRONE_CATALOG } from '../output/test/game/drone/droneCatalog.js';
import { createRaceSession, aiDrivingInput } from '../output/test/game/driving/createRaceSession.js';
import { createRaceRecords } from '../output/test/game/driving/raceRecords.js';

// Regression: a weakly damped rival (needle) once overshot the road edge sliding onto a mine field's safe line behind a height obstacle.
const definition = TRACK_CATALOG.find(track => track.id === 'dockside-run');
for (const platform of ['touch', 'desktop']) for (const seed of [.55, .2, .9]) {
  test(`dockside-run ${platform} seed ${seed}: no rival leaves the track`, () => {
    const track = createCatalogTrack(definition), configuration = DRONE_CATALOG[0].configuration;
    const race = createRaceSession(track, configuration, createRaceRecords({ trackId: definition.id, configurationId: 'ai-off-track', laps: definition.laps }),
      0, 'competition', () => seed, platform, { laps: definition.laps }, definition.rating);
    race.start();
    for (let ticks = 0; !race.snapshot().competition.complete && ticks < 30 * 600; ticks++)
      race.step(1 / 30, aiDrivingInput(track, configuration, race.model.state, 1, race.rivals.map(rival => rival.controller.model.state)));
    assert.deepEqual(race.rivals.map(rival => rival.controller.model.state.offTrackExits), race.rivals.map(() => 0));
  });
}
