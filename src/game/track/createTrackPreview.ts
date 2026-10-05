import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { overviewPose } from '../driving/createRaceViews';
import type { Track } from './createTrack';
import type { TrackDefinition } from './trackCatalog';
import { createTrackLandmark, describeTrackLandmark, disposeScenery } from './createTrackLandmark';

/** One lightweight WebGL context for the entire course selection screen. */
export function createTrackPreview(container: HTMLElement) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); container.append(renderer.domElement);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 1, 10, 30000);
  let route: Line2 | undefined, track: Track | undefined;
  let landmark: THREE.Group | undefined;
  const start = new THREE.Mesh(new THREE.SphereGeometry(12, 12, 8), new THREE.MeshBasicMaterial({ color: '#ffbe58', depthTest: false }));
  scene.add(start); start.renderOrder = 2;
  const render = () => {
    const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
    if (track) { const pose = overviewPose(track, camera.aspect); camera.position.copy(pose.center).add(pose.position.clone().sub(pose.center).multiplyScalar(1.12)); camera.lookAt(pose.center); }
    route?.material.resolution.set(width, height); renderer.render(scene, camera);
  };
  const observer = new ResizeObserver(render); observer.observe(container);
  return {
    setTrack(value: Track, color: string, definition?: TrackDefinition) {
      if (route) { scene.remove(route); route.geometry.dispose(); route.material.dispose(); }
      if (landmark) { disposeScenery(landmark); landmark = undefined; }
      if (definition) { landmark = createTrackLandmark(describeTrackLandmark(value, definition), true); scene.add(landmark); }
      track = value; const points: number[] = [], colors: number[] = [];
      const normal = new THREE.Color(color);
      const { h, s, l } = normal.getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace);
      // Keep the district hue; stunts use a deeper, more saturated shade.
      const special = new THREE.Color().setHSL(h, Math.min(1, s + .45), Math.max(.42, l - .24), THREE.SRGBColorSpace);
      container.style.setProperty('--stunt-color', `#${special.getHexString()}`);
      const addPoint = (distance: number) => {
        const frame = track!.sample(distance);
        points.push(...frame.position.toArray());
        colors.push(...(frame.section !== 'course' ? special : normal).toArray());
      };
      for (let d = 0; d < track.length; d += 4) addPoint(d);
      addPoint(0);
      route = new Line2(new LineGeometry().setPositions(points).setColors(colors), new LineMaterial({ vertexColors: true, linewidth: 3, toneMapped: false }));
      scene.add(route); start.position.copy(track.sample(0).position); render();
    },
    dispose() { observer.disconnect(); if (landmark) disposeScenery(landmark); route?.geometry.dispose(); route?.material.dispose(); start.geometry.dispose(); start.material.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); },
  };
}
