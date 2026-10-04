import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import type { Track } from '../track/createTrack.js';

export type RaceView = 'chase' | 'cockpit';
export type TrackDisplay = 'hidden' | 'pip' | 'primary';
export const VIEW_LABELS: Record<RaceView, string> = { chase: '추적', cockpit: '콕핏' };
export const TRACK_DISPLAY_LABELS: Record<TrackDisplay, string> = { hidden: '트랙 보기', pip: '트랙 PIP', primary: '트랙 메인' };

export interface Viewport { x: number; y: number; width: number; height: number }
/** CSS pixels, with bottom-left origin for WebGL viewport/scissor. */
export function raceViewLayout(width: number, height: number, display: TrackDisplay, compact = width < 600 || height < 500) {
  const full = { x: 0, y: 0, width, height };
  const margin = width < 600 ? 16 : 24;
  const insetWidth = Math.min(420, width * (width < 600 ? .4 : .3));
  const insetHeight = Math.min(insetWidth * .625, height * .3);
  const top = Math.min(compact ? margin + 22 : 80, Math.max(margin, height - insetHeight - margin));
  const inset = { x: width - insetWidth - margin, y: height - top - insetHeight, width: insetWidth, height: insetHeight };
  return { driving: display === 'primary' ? inset : full, track: display === 'hidden' ? null : display === 'pip' ? inset : full, inset };
}
export interface CockpitSettings { rollStrength: number; shakeStrength: number }
export const DEFAULT_COCKPIT_SETTINGS: CockpitSettings = { rollStrength: 0.35, shakeStrength: 0.008 };

/** Overview fits the sampled road and arches, independently of the scenery plane. */
export function overviewPose(track: Track, aspect: number, fov = 50) {
  const bounds = new THREE.Box3();
  for (let d = 0; d < track.length; d += 8) bounds.expandByPoint(track.sample(d).position);
  bounds.expandByScalar(track.halfWidth + 18);
  const center = bounds.getCenter(new THREE.Vector3());
  const radius = bounds.getSize(new THREE.Vector3()).length() / 2;
  const halfVertical = THREE.MathUtils.degToRad(fov / 2);
  const halfHorizontal = Math.atan(Math.tan(halfVertical) * aspect);
  const distance = radius / Math.sin(Math.min(halfVertical, halfHorizontal)) * 1.08;
  return { center, position: center.clone().addScaledVector(new THREE.Vector3(.55, 1, .75).normalize(), distance) };
}

export function createRaceViews(camera: THREE.PerspectiveCamera, drone: THREE.Group, scene: THREE.Scene, track: Track,
  cockpit: CockpitSettings = DEFAULT_COCKPIT_SETTINGS) {
  const mount = drone.getObjectByName('cockpitCameraMount');
  if (!mount) throw new Error('Drone cockpit camera mount is missing.');
  const canopy = drone.getObjectByName('canopy');
  const panel = drone.getObjectByName('instrumentPanel') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | undefined;
  const panelColor = panel?.material.color.clone();
  const fog = scene.fog;
  const marker = new THREE.Group(); marker.name = 'overviewPlayer';
  const core = new THREE.Mesh(new THREE.SphereGeometry(7, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, toneMapped: false }));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(15, 2.2, 6, 32), new THREE.MeshBasicMaterial({ color: 0xffac52, depthTest: false, toneMapped: false }));
  marker.add(core, ring); marker.renderOrder = 20; core.renderOrder = ring.renderOrder = 20;
  scene.add(marker);
  // Pixel-width overview route remains readable when world-space neon tubes become subpixel.
  const positions: number[] = [];
  for (let d = 0; d < track.length; d += 3) {
    const frame = track.sample(d);
    positions.push(...frame.position.clone().addScaledVector(frame.up, .1).toArray());
  }
  positions.push(...track.sample(0).position.toArray());
  const route = new Line2(new LineGeometry().setPositions(positions),
    new LineMaterial({ color: 0x159b9b, linewidth: 2.2, toneMapped: false }));
  route.name = 'overviewRoute'; scene.add(route);
  // Small cockpit instruments remain below the clear forward sightline.
  const instruments = new THREE.Group(); instruments.name = 'cockpitInstruments';
  const mat = new THREE.MeshBasicMaterial({ color: 0x67dcca, depthTest: false });
  for (const sign of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(.008, .22, .008), mat);
    rail.position.set(sign * .31, -.24, -.55); rail.rotation.z = sign * -.4; instruments.add(rail);
  }
  const dash = new THREE.Mesh(new THREE.BoxGeometry(.25, .006, .008), mat); dash.position.set(0, -.28, -.55); instruments.add(dash);
  camera.add(instruments);
  let view: RaceView = 'chase';
  let trackDisplay: TrackDisplay = 'hidden';
  // A distant camera needs a farther near plane to keep road/route depth precise.
  const overviewCamera = new THREE.PerspectiveCamera(50, 1, 10, 10000);
  let overviewHeight = 1;
  const up = new THREE.Vector3(), forward = new THREE.Vector3(), target = new THREE.Vector3();
  const prepareDriving = () => {
    marker.visible = route.visible = false;
    instruments.visible = view === 'cockpit';
    if (canopy) canopy.visible = view !== 'cockpit';
    if (panel && panelColor) panel.material.color.copy(panelColor).multiplyScalar(view === 'cockpit' ? .08 : 1);
    scene.fog = fog;
  };
  prepareDriving();
  return {
    overviewCamera,
    get view() { return view; },
    get trackDisplay() { return trackDisplay; },
    toggleCockpit() { view = view === 'chase' ? 'cockpit' : 'chase'; prepareDriving(); return view; },
    cycleTrack() { trackDisplay = trackDisplay === 'hidden' ? 'pip' : trackDisplay === 'pip' ? 'primary' : 'hidden'; return trackDisplay; },
    resize(width: number, height: number) {
      overviewHeight = height;
      overviewCamera.aspect = width / height;
      const pose = overviewPose(track, overviewCamera.aspect);
      overviewCamera.position.copy(pose.position); overviewCamera.lookAt(pose.center); overviewCamera.updateProjectionMatrix();
      route.material.resolution.set(width, height);
    },
    prepareDriving,
    prepareOverview() {
      marker.visible = route.visible = true; instruments.visible = false;
      if (canopy) canopy.visible = true;
      if (panel && panelColor) panel.material.color.copy(panelColor);
      scene.fog = null;
    },
    update(flightForward: THREE.Vector3, flightUp: THREE.Vector3, bank: number, time: number, boost: boolean, reduced: boolean) {
      marker.position.copy(drone.position);
      marker.scale.setScalar(overviewCamera.position.distanceTo(marker.position) * 2 * Math.tan(THREE.MathUtils.degToRad(25)) / overviewHeight * 6 / 15);
      ring.quaternion.copy(overviewCamera.quaternion);
      if (view === 'cockpit') {
        drone.updateWorldMatrix(true, true); mount.getWorldPosition(camera.position);
        forward.copy(flightForward).normalize();
        up.copy(flightUp).applyAxisAngle(forward, reduced ? 0 : bank * cockpit.rollStrength);
        if (boost && !reduced) camera.position.addScaledVector(up, Math.sin(time * 73) * cockpit.shakeStrength);
        camera.up.copy(up); target.copy(camera.position).addScaledVector(forward, 30); camera.lookAt(target);
      }
    },
  };
}
