import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ARC_RAILS_PER_TRACK, BOOSTS_PER_KM, HAZARD_CATALOG, HAZARD_GAP, boostKindFor } from '../output/test/game/track/hazardCatalog.js';
import { isAuthoredForkRoute } from '../output/test/game/track/authoredForkLayout.js';
import { stuntSections } from '../output/test/game/track/arcRail.js';
import { TRACK_CATALOG } from '../output/test/game/track/trackCatalog.js';
import { createCatalogTrack } from '../output/test/game/track/trackRuntime.js';

test('docs/HAZARDS.md lists exactly the catalog ids', () => {
  const doc = readFileSync(new URL('../docs/HAZARDS.md', import.meta.url), 'utf8');
  const documented = doc.split('\n').filter(line => line.startsWith('|')).flatMap(line => [...line.split('|')[1].matchAll(/`([a-z-]+)`/g)].map(m => m[1]));
  assert.deepEqual([...documented].sort(), HAZARD_CATALOG.map(h => h.id).sort());
  for (const h of HAZARD_CATALOG) {
    const row = doc.split('\n').find(line => line.startsWith('|') && line.split('|')[1].includes(`\`${h.id}\``));
    assert.ok(row.split('|')[1].includes(h.name), `${h.id}: name`);
    assert.ok(row.includes(h.enabled ? '| 사용 |' : '| 보류 |'), `${h.id}: status`);
  }
});

test('catalog entries are unique and minefields are on hold', () => {
  assert.equal(new Set(HAZARD_CATALOG.map(h => h.id)).size, HAZARD_CATALOG.length);
  assert.equal(HAZARD_CATALOG.find(h => h.id === 'minefield').enabled, false);
});

test('each track keeps one random boost kind alongside authored fork pads, both kinds occur and ids are stable', () => {
  const kinds = { pad: 0, ring: 0 };
  for (const definition of TRACK_CATALOG) for (const challenge of ['easy', 'normal', 'hard']) {
    const track = createCatalogTrack(definition, challenge);
    assert.equal(track.boostKind, boostKindFor(definition.id), definition.name);
    assert.ok(track.boostKind === 'ring' ? track.boostPads.filter(p => !isAuthoredForkRoute(track, p.routeId)).length === 0 : track.boostRings.length === 0, `${definition.name}/${challenge}: only one boost kind`);
    track.randomizeObstacles(() => .37);
    assert.ok(track.boostKind === 'ring' ? track.boostPads.filter(p => !isAuthoredForkRoute(track, p.routeId)).length === 0 : track.boostRings.length === 0, `${definition.name}/${challenge}: only one boost kind after a roll`);
    if (challenge === 'normal') kinds[track.boostKind]++;
  }
  assert.ok(kinds.pad > 0 && kinds.ring > 0 && Math.abs(kinds.pad - kinds.ring) <= TRACK_CATALOG.length * .2, JSON.stringify(kinds));
});

test('catalog averages match the density targets: gap, boosts per km and rails per track', () => {
  const average = { easy: [450, 1], normal: [360, .8], hard: [290, .6] };
  for (const challenge of ['easy', 'normal', 'hard']) {
    let length = 0, fields = 0, boosts = 0, rails = 0;
    for (const definition of TRACK_CATALOG) {
      const track = createCatalogTrack(definition, challenge);
      length += track.length; fields += track.heightObstacles.length + track.corridorObstacles.length; boosts += track.boostPads.length + track.boostRings.length;
      rails += track.arcRails.length;
      assert.equal(track.arcRails.length, Math.min(ARC_RAILS_PER_TRACK[challenge], stuntSections(track).length));
    }
    assert.ok(length / fields <= average[challenge][0] && length / fields >= HAZARD_GAP[challenge] * .8, `${challenge}: gap ${length / fields}`);
    assert.ok(Math.abs(boosts / length * 1000 - BOOSTS_PER_KM[challenge]) < .2, `${challenge}: boosts/km ${boosts / length * 1000}`);
  }
});
