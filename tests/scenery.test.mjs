import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TRACK_CATALOG } from '../output/test/game/track/trackCatalog.js';
import { createCatalogTrack } from '../output/test/game/track/trackRuntime.js';
import { createDistrictScenery } from '../output/test/game/track/createDistrictScenery.js';
import { createTrackLandmark, describeTrackLandmark, disposeScenery, sceneryRoute } from '../output/test/game/track/createTrackLandmark.js';

test('all 24 course landmarks are reproducible, unique and outside the full swept route', () => {
  const ids = new Set(), kinds = new Set();
  for (const definition of TRACK_CATALOG) {
    const track = createCatalogTrack(definition), route = sceneryRoute(track);
    const descriptor = describeTrackLandmark(track, definition, route);
    assert.deepEqual(descriptor, describeTrackLandmark(track, { ...definition, name: definition.name, order: 90 }, route));
    const renamed = describeTrackLandmark(track, { ...definition, name: 'RENAMED', order: 90 }, route);
    assert.deepEqual(renamed.position, descriptor.position); assert.equal(renamed.kind, descriptor.kind); assert.equal(renamed.scale, descriptor.scale);
    ids.add(descriptor.id); kinds.add(descriptor.kind);
    assert.ok(route.every(p => Math.hypot(p.x - descriptor.position.x, p.z - descriptor.position.z) >= descriptor.radius + track.halfWidth + 36));
    const race = createTrackLandmark(descriptor), preview = createTrackLandmark(descriptor, true);
    assert.equal(race.children.length, 3, 'static landmark pieces are batched by material');
    assert.deepEqual(race.position, preview.position); assert.deepEqual(race.scale, preview.scale);
    assert.deepEqual(race.children[0].geometry.attributes.position.array, preview.children[0].geometry.attributes.position.array);
    race.updateMatrixWorld(true);
    for (const mesh of race.children) {
      const attribute = mesh.geometry.attributes.position;
      for (let i = 0; i < attribute.count; i++) {
        const vertex = new THREE.Vector3().fromBufferAttribute(attribute, i).applyMatrix4(mesh.matrixWorld);
        assert.ok(Math.hypot(vertex.x - descriptor.position.x, vertex.z - descriptor.position.z) <= descriptor.radius + .01, definition.id);
      }
    }
    disposeScenery(race); disposeScenery(preview);
  }
  assert.equal(ids.size, 24); assert.equal(kinds.size, 7);
});

test('city LOD removes distant instances, reduces low-quality windows and avoids per-frame uploads', () => {
  const definition = TRACK_CATALOG[0], track = createCatalogTrack(definition), city = createDistrictScenery(track, definition);
  const [bodies, windows, crowns, landmark] = city.object.children;
  const start = track.sample(0).position;
  city.setQuality('high'); city.update(start);
  const highWindows = windows.count, initialVersion = windows.instanceMatrix.version;
  assert.ok(highWindows > 20); assert.ok(landmark.visible);
  city.update(start.clone().add(new THREE.Vector3(1, 0, 0)));
  assert.equal(windows.instanceMatrix.version, initialVersion);
  city.setQuality('low'); assert.ok(windows.count < highWindows);
  city.update(new THREE.Vector3(100000, 100000, 100000));
  assert.equal(bodies.count + windows.count + crowns.count, 0); assert.equal(landmark.visible, false);
  city.update(start); assert.ok(bodies.count > 0); assert.ok(landmark.visible);
  city.setOverview(true); assert.equal(city.object.visible, false);
  city.setOverview(false); assert.equal(city.object.visible, true);
  const geometries = new Set(), materials = new Set();
  city.object.traverse(o => { if (o instanceof THREE.Mesh) { geometries.add(o.geometry); materials.add(o.material); } });
  let disposedGeometries = 0, disposedMaterials = 0;
  geometries.forEach(g => g.addEventListener('dispose', () => disposedGeometries++));
  materials.forEach(m => m.addEventListener('dispose', () => disposedMaterials++));
  disposeScenery(city.object);
  assert.equal(disposedGeometries, geometries.size); assert.equal(disposedMaterials, materials.size);
});

test('city buildings leave the route and its landmark clear on every course', () => {
  const matrix = new THREE.Matrix4(), point = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion();
  for (const definition of TRACK_CATALOG) {
    const track = createCatalogTrack(definition), route = sceneryRoute(track), city = createDistrictScenery(track, definition);
    city.setQuality('high');
    const seen = new Set();
    for (let d = 0; d < track.length; d += 160) {
      city.update(track.sample(d).position);
      const bodies = city.object.children[0];
      for (let i = 0; i < bodies.count; i++) {
        bodies.getMatrixAt(i, matrix); matrix.decompose(point, rotation, scale);
        const key = `${point.x},${point.y},${point.z},${scale.x},${scale.z}`; if (seen.has(key)) continue; seen.add(key);
        const radius = Math.hypot(scale.x, scale.z) / 2;
        assert.ok(route.every(p => Math.hypot(p.x - point.x, p.z - point.z) >= radius + track.halfWidth + 20), definition.id);
        assert.ok(Math.hypot(city.landmark.position.x - point.x, city.landmark.position.z - point.z) >= radius + city.landmark.radius, definition.id);
      }
    }
    assert.ok(seen.size > 20, definition.id); disposeScenery(city.object);
  }
});
