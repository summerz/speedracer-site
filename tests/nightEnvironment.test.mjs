import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { NIGHT_ENVIRONMENTS, selectRaceEnvironment } from '../output/test/game/environment/raceEnvironment.js';
import { createNightSky } from '../output/test/game/environment/createNightSky.js';
import { TRACK_CATALOG } from '../output/test/game/track/trackCatalog.js';
import { createCatalogTrack } from '../output/test/game/track/trackRuntime.js';
import { describeTrackLandmarks, createTrackLandmark, disposeScenery, sceneryRoute } from '../output/test/game/track/createTrackLandmark.js';
import { createDistrictScenery } from '../output/test/game/track/createDistrictScenery.js';
import { cityForDistrict } from '../output/test/game/track/cityCatalog.js';
import { roadPoints } from '../output/test/game/track/trackBranches.js';

test('Neon City districts select five night environments; free driving keeps its default', () => {
  assert.deepEqual([0, .2, .4, .6, .8, 1].map(n => selectRaceEnvironment('residential', () => n).id), ['midnight', 'deep-night', 'predawn', 'afterglow', 'storm-night', 'storm-night']);
  for (const district of new Set(TRACK_CATALOG.filter(t => t.order <= 32).map(t => t.district))) assert.equal(selectRaceEnvironment(district, () => .75).id, 'afterglow');
  assert.equal(selectRaceEnvironment(undefined, () => { throw Error('random should not be called'); }).id, 'midnight');
  assert.equal(selectRaceEnvironment('residential', () => NaN).id, 'midnight');
  assert.equal(new Set(NIGHT_ENVIRONMENTS.map(e => e.horizon)).size, 5);
});

test('sky follows position with world-fixed orientation, hides in overview and releases GPU assets', () => {
  for (const environment of NIGHT_ENVIRONMENTS) {
    const sky = createNightSky(environment, new THREE.Vector3(0, 0, -1));
    sky.update(new THREE.Vector3(100, 20, 30));
    assert.deepEqual(sky.object.position.toArray(), [100, 20, 30]);
    assert.deepEqual(sky.object.rotation.toArray().slice(0, 3), [0, 0, 0]);
    assert.equal(sky.object.children.length, 1, 'planet, atmosphere and rings share one sky draw');
    const mesh = sky.object.getObjectByName('celestial-sky');
    assert.equal(mesh.userData.celestial, environment.celestial);
    assert.equal(mesh.material.uniforms.ringed.value, environment.celestial === 'ringed-planet' ? 1 : 0);
    assert.ok(environment.celestialRadius * 2 > Math.PI / 3, 'apparent diameter exceeds 60 degrees');
    assert.ok(environment.celestialElevation < environment.celestialRadius, 'body straddles the horizon');
    assert.equal(mesh.material.depthWrite, false);
    assert.ok(sky.object.children.every(o => o.material.fog === false));
    sky.setOverview(true); assert.equal(sky.object.visible, false);
    sky.setOverview(false); assert.equal(sky.object.visible, true);
    let disposed = 0;
    sky.object.children.forEach(o => { o.geometry.addEventListener('dispose', () => disposed++); o.material.addEventListener('dispose', () => disposed++); });
    const expected = sky.object.children.length * 2; disposeScenery(sky.object); assert.equal(disposed, expected);
  }
});

test('each campaign course has three safe, separated landmarks with sustained forward-view encounters', () => {
  for (const definition of TRACK_CATALOG) {
    const track = createCatalogTrack(definition), route = sceneryRoute(track), descriptors = describeTrackLandmarks(track, definition, route);
    assert.equal(descriptors.length, 3); assert.ok(descriptors[0].height >= 300);
    assert.deepEqual(descriptors, describeTrackLandmarks(track, { ...definition, name: 'renamed' }, route));
    for (const [index, descriptor] of descriptors.entries()) {
      assert.ok(route.every(p => Math.hypot(p.x - descriptor.position.x, p.z - descriptor.position.z) >= descriptor.radius + track.halfWidth + 36));
      assert.ok(descriptors.slice(index + 1).every(d => Math.hypot(d.position.x - descriptor.position.x, d.position.z - descriptor.position.z) >= d.radius + descriptor.radius));
      let consecutive = 0, longest = 0;
      for (let d = 0; d < track.length; d += 10) {
        const frame = track.sample(d), target = descriptor.position.clone().add(new THREE.Vector3(0, descriptor.height * .45, 0)).sub(frame.position);
        const distance = target.length(), alignment = target.normalize().dot(frame.tangent);
        consecutive = frame.up.y > .65 && alignment > .70 && distance < 1000 && descriptor.height / distance > .18 ? consecutive + 10 : 0;
        longest = Math.max(longest, consecutive);
      }
      assert.ok(longest >= 100, `${definition.id}:${index} should remain prominent ahead for at least 100m, got ${longest}`);
      const underwater = cityForDistrict(definition.district) === 'marine';
      const race = createTrackLandmark(descriptor, false, underwater), preview = createTrackLandmark(descriptor, true, underwater);
      const light = race.getObjectByName('landmark-lights').material.color;
      assert.ok(light.r * .2126 + light.g * .7152 + light.b * .0722 > .95, 'every district accent crosses the bloom threshold');
      assert.deepEqual(race.children[0].geometry.attributes.position.array, preview.children[0].geometry.attributes.position.array);
      race.updateMatrixWorld(true);
      for (const mesh of race.children) {
        const attribute = mesh.geometry.attributes.position;
        for (let i = 0; i < attribute.count; i++) {
          const vertex = new THREE.Vector3().fromBufferAttribute(attribute, i).applyMatrix4(mesh.matrixWorld);
          assert.ok(Math.hypot(vertex.x - descriptor.position.x, vertex.z - descriptor.position.z) <= descriptor.radius + .01);
        }
      }
      disposeScenery(race); disposeScenery(preview);
    }
    const city = createDistrictScenery(track, definition);
    city.setQuality('low'); city.update(descriptors[0].position.clone().add(new THREE.Vector3(1000, 0, 0)));
    assert.ok(city.object.getObjectByName(descriptors[0].id).visible, 'hero silhouette survives beyond ordinary building LOD');
    disposeScenery(city.object);
  }
});

test('Marine City megastructures leave a readable open strip beyond their footprint and every road edge', () => {
  for (const definition of TRACK_CATALOG.filter(d => cityForDistrict(d.district) === 'marine')) {
    const track = createCatalogTrack(definition), route = roadPoints(track, 2);
    for (const descriptor of describeTrackLandmarks(track, definition)) {
      const gap = Math.min(...route.map(p => Math.hypot(p.x - descriptor.position.x, p.z - descriptor.position.z)))
        - descriptor.radius - track.halfWidth;
      const minimum = descriptor.scale >= 3 ? 100 : descriptor.scale >= 2 ? 75 : 60;
      assert.ok(gap >= minimum, `${definition.id}:${descriptor.id} open strip ${gap.toFixed(1)}m should exceed ${minimum}m`);
    }
  }
});
