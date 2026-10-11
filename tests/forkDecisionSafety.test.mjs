import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACK_CATALOG } from '../output/test/game/track/trackCatalog.js';
import { createCatalogTrack } from '../output/test/game/track/trackRuntime.js';
import { physicalDistance, advanceTrackDistance } from '../output/test/game/track/trackBranches.js';
import { forkDecisionPlacementClear } from '../output/test/game/track/forkDecisionSafety.js';
import { readForkCue } from '../output/test/game/track/forkCue.js';
import { mulberry32 } from '../output/test/game/track/obstacleLayout.js';

test('all altitude forks keep the entire electrical/corridor field outside guidance and 200m recovery, across 30 runs and all challenges', () => {
  let audited = 0;
  for (const definition of TRACK_CATALOG) for (const challenge of ['easy', 'normal', 'hard']) {
    const t = createCatalogTrack(definition, challenge), forks = t.branches?.filter(f => f.kind === 'vertical') ?? [];
    if (!forks.length) continue;
    audited += forks.length;
    for (let seed = 0; seed <= 30; seed++) {
      if (seed) t.randomizeObstacles(mulberry32(seed * 917));
      const fields = [...t.heightObstacles, ...t.corridorObstacles];
      for (const f of forks) for (const o of fields) {
        const relative = o.distance - f.start;
        const radius = o.depth / 2 + 3;
        if (relative + radius < -500) continue;
        if (relative - radius <= f.junctionLength) {
          assert.fail(`${t.id}/${challenge}/${seed}: field overlaps altitude decision at ${o.distance}`);
        }
        if (o.routeId && !f.routes.some(r => r.id === o.routeId)) continue;
        const gap = physicalDistance(t, f.start + f.junctionLength, relative - radius - f.junctionLength, o.routeId);
        assert.ok(gap >= 200 - 1e-6, `${t.id}/${challenge}/${seed}: only ${gap}m recovery`);
      }
    }
  }
  assert.equal(audited, 27, '9 altitude forks, each on three challenges');
});

test('altitude clearance includes field edges, route physical scale and the previous lap', () => {
  const t = createCatalogTrack(TRACK_CATALOG.find(d => d.id === 'voltage-yard'));
  const f = t.branches[0], routeId = f.routes[1].id, lock = f.start + f.junctionLength;
  assert.equal(forkDecisionPlacementClear(t, f.start - 510, null, 15), false);
  assert.equal(forkDecisionPlacementClear(t, f.start - 520, null, 15), true);
  assert.equal(forkDecisionPlacementClear(t, advanceTrackDistance(t, lock, 190, routeId), routeId), false);
  assert.equal(forkDecisionPlacementClear(t, advanceTrackDistance(t, lock, 210, routeId), routeId), true);
  const seam = { ...t, length: 3000, branches: [{ ...f, start: 100, end: 1000 }] };
  assert.equal(forkDecisionPlacementClear(seam, 2950), false);
  assert.equal(forkDecisionPlacementClear(seam, 2950 + seam.length), false);
});

test('even boosted preview never begins outside its protected 500m window', () => {
  const t = createCatalogTrack(TRACK_CATALOG.find(d => d.id === 'voltage-yard'));
  const pose = { offset: 0, altitudeLevel: 1, speed: 250 };
  assert.equal(readForkCue(t, { ...pose, distance: t.branches[0].start - 501 }), null);
  assert.equal(readForkCue(t, { ...pose, distance: t.branches[0].start - 499 }).phase, 'approach');
});
