import test from 'node:test';
import assert from 'node:assert/strict';
import { authorClosedTrack } from '../output/test/game/track/trackAuthoring.js';
import { createTrack } from '../output/test/game/track/createTrack.js';
import { TRACK_CATALOG, validateTrackCatalog } from '../output/test/game/track/trackCatalog.js';

const layout = (kind, direction) => ({ shape: 'ring', radiusX: 500, radiusZ: 500, elevation: 0, waves: 1, rotation: 0, bank: 0,
  stunts: [{ kind, start: .2, span: kind === 'loop' ? .085 : .15, radius: kind === 'roll' ? 0 : 80, turns: 1, direction }] });

test('downward loops mirror vertical motion, invert the road and stay above the city floor', () => {
  const up = authorClosedTrack(layout('loop', 1)), down = authorClosedTrack(layout('loop', -1));
  const lift = down[0].position.y - up[0].position.y;
  assert.ok(lift > 150, 'approach is raised to make space for the hanging loop');
  for (let i = 0; i < up.length; i++) {
    assert.ok(Math.abs(up[i].position.x - down[i].position.x) < 1e-8);
    assert.ok(Math.abs(up[i].position.z - down[i].position.z) < 1e-8);
    assert.ok(Math.abs((up[i].position.y - up[0].position.y) + (down[i].position.y - down[0].position.y)) < 1e-8);
  }
  const track = createTrack(undefined, undefined, down);
  let inverted = false, descending = false, ascending = false;
  for (let d = 0; d < track.length; d += 2) {
    const f = track.sample(d), next = track.sample(d + 2);
    assert.ok(f.position.y > 20, 'interpolated road also clears the floor');
    assert.ok(Math.abs(f.up.dot(f.tangent)) < 1e-8);
    assert.ok(f.up.dot(next.up) > .95, `abrupt downward loop roll at ${d}`);
    if (f.section === 'vertical-loop') {
      inverted ||= f.up.y < -.95;
      descending ||= f.tangent.y < -.8;
      ascending ||= f.tangent.y > .8;
    }
  }
  assert.ok(inverted && descending && ascending);
});

test('helix and road rolls reverse their winding without changing their turn count', () => {
  for (const kind of ['helix', 'roll']) {
    const a = authorClosedTrack(layout(kind, 1)), b = authorClosedTrack(layout(kind, -1));
    const base = authorClosedTrack({ ...layout(kind, 1), stunts: [] });
    let reversed = false;
    for (let i = 0; i < a.length; i++) {
      assert.ok(Math.abs(a[i].position.y - b[i].position.y) < 1e-8);
      assert.ok(Math.abs(a[i].up.y - b[i].up.y) < 1e-8);
      assert.ok(Math.abs(a[i].up.x + b[i].up.x) < 1e-8);
      assert.ok(Math.abs(a[i].up.z + b[i].up.z) < 1e-8);
      assert.ok(Math.abs(a[i].position.x + b[i].position.x - 2 * base[i].position.x) < 1e-8);
      assert.ok(Math.abs(a[i].position.z + b[i].position.z - 2 * base[i].position.z) < 1e-8);
      reversed ||= a[i].up.dot(b[i].up) < 0;
    }
    assert.ok(reversed, `${kind} has visibly opposite winding`);
  }
});

test('both directions appear early and remain balanced across campaign districts', () => {
  for (const kind of ['loop', 'helix', 'roll']) {
    const signs = TRACK_CATALOG.flatMap(t => t.layout?.stunts.filter(s => s.kind === kind).map(s => s.direction) ?? []);
    assert.ok(Math.abs(signs.filter(s => s === 1).length - signs.filter(s => s === -1).length) <= 1);
    const early = TRACK_CATALOG.slice(0, 4).flatMap(t => t.layout?.stunts.filter(s => s.kind === kind).map(s => s.direction) ?? []);
    assert.deepEqual(new Set(early), new Set([1, -1]));
    for (const district of new Set(TRACK_CATALOG.map(t => t.district))) {
      const local = TRACK_CATALOG.filter(t => t.district === district).flatMap(t => t.layout?.stunts.filter(s => s.kind === kind).map(s => s.direction) ?? []);
      assert.ok(Math.abs(local.filter(s => s === 1).length - local.filter(s => s === -1).length) <= 1, `${district} ${kind}`);
    }
  }
  const first = TRACK_CATALOG[0];
  const bad = { ...first, layout: { ...first.layout, stunts: [{ ...first.layout.stunts[0], direction: 0 }] } };
  assert.throws(() => validateTrackCatalog([bad]), /Invalid course stunt/);
});
