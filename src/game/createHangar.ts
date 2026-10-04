import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createRacingDrone, DRONE_VARIANTS } from './drone/createRacingDrone';
import { createThrusterEffect } from './drone/createThrusterEffect';
import { DEFAULT_DRONE_CONFIGURATION } from './drone/droneConfiguration';
import type { DroneConfiguration } from './drone/droneConfiguration';
import type { ThrustMode, ThrusterStyle } from './drone/createThrusterEffect';

export interface Hangar {
  setDrone(configuration: DroneConfiguration): void;
  setBloom(enabled: boolean): void;
  setAutoRotate(enabled: boolean): void;
  setThrustMode(mode: ThrustMode): void;
  setThrusterStyle(style: ThrusterStyle): void;
  setView(view: 'front' | 'rear' | 'reset'): void;
  dispose(): void;
}

export function createHangar(container: HTMLDivElement, onContextLost: () => void, configuration: DroneConfiguration = DEFAULT_DRONE_CONFIGURATION, trackPreview = false): Hangar {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setClearColor(0x080e14, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.setAttribute('aria-label', '네온 라인이 있는 탑승형 레이싱 드론');
  renderer.domElement.setAttribute('role', 'img');
  container.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x080e14, 0.048);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 80);
  const home = new THREE.Vector3(6.6, 3.6, -7.6);
  camera.position.copy(home);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.0, 0);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.enableZoom = false;
  // Keep vertical touch scrolling available over the preview; horizontal drag rotates it.
  renderer.domElement.style.touchAction = 'pan-y';
  controls.minDistance = 5.5;
  controls.maxDistance = 16;
  controls.minPolarAngle = 0.25;
  controls.maxPolarAngle = Math.PI / 2 - 0.06;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.65;
  controls.update();
  controls.saveState();

  scene.add(new THREE.HemisphereLight(0xc2dce8, 0x162332, 1.8));
  const keyLight = new THREE.DirectionalLight(0xe2f2ff, 3.5);
  keyLight.position.set(4, 7, -5);
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0x46d5d2, 0.8);
  rimLight.position.set(-4, 3, 3);
  scene.add(rimLight);

  let drone = createRacingDrone({ variant: configuration.modelVariant, thrusterIntensity: 0, neonBoost: 2.0 });
  drone.position.y = 1.05;
  scene.add(drone);
  let thrusters = createThrusterEffect(drone, scene, configuration.boostStyle);
  let thrustMode: ThrustMode = 'idle';
  const disposeDrone = () => {
    thrusters.dispose(); scene.remove(drone);
    const materials = new Set<THREE.Material>();
    drone.traverse((object) => {
      if (object instanceof THREE.Mesh) { object.geometry.dispose();
        (Array.isArray(object.material) ? object.material : [object.material]).forEach((m) => materials.add(m)); }
    });
    materials.forEach((m) => m.dispose());
  };

  const platform = new THREE.Mesh(
    new THREE.CylinderGeometry(3.1, 3.3, 0.15, 80),
    new THREE.MeshStandardMaterial({ color: 0x101c25, roughness: 0.7, metalness: 0.4 }),
  );
  platform.position.y = -0.1;
  scene.add(platform);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(3.11, 3.15, 100),
    new THREE.MeshBasicMaterial({ color: (DRONE_VARIANTS.find(v => v.id === configuration.modelVariant) ?? DRONE_VARIANTS[0]).neon, toneMapped: false, side: THREE.DoubleSide, transparent: true, opacity: 0.65 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -0.018;
  scene.add(ring);

  const grid = new THREE.GridHelper(36, 36, 0x28434b, 0x193039);
  grid.position.y = -0.19;
  const gridMaterial = grid.material as THREE.Material;
  gridMaterial.transparent = true;
  gridMaterial.opacity = 0.32;
  scene.add(grid);

  let preview: THREE.LineSegments | undefined;
  if (trackPreview) {
    const points: number[] = [];
    for (const x of [-3.7, 3.7]) points.push(x, -.02, -10, x, -.02, 10);
    for (let z = -10; z < 10; z += 2) points.push(0, -.02, z, 0, -.02, z + .8);
    preview = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(points, 3)), new THREE.LineBasicMaterial({ color: configuration.boostStyle.pulseColor }));
    scene.add(preview);
  }

  // Renderer antialiasing does not cover offscreen postprocessing targets.
  const renderTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, renderTarget);
  const renderPass = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.85, 0.32, 0.9);
  const output = new OutputPass();
  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(output);

  let disposed = false;
  let contextLost = false;
  let frame = 0;
  let previousTime = performance.now();
  let hoveringTime = 0;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const resize = () => {
    if (disposed || contextLost) return;
    const { width, height } = container.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    composer.setPixelRatio(pixelRatio);
    composer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  window.addEventListener('resize', resize);
  resize();

  const tick = (now: number) => {
    if (disposed || contextLost) return;
    const delta = Math.min((now - previousTime) / 1000, 0.05);
    previousTime = now;
    hoveringTime += delta;
    drone.position.y = 1.05 + (reducedMotion.matches ? 0 : Math.sin(hoveringTime * 1.15) * 0.035);
    thrusters.update(delta, reducedMotion.matches);
    controls.update(delta);
    composer.render(delta);
    frame = requestAnimationFrame(tick);
  };
  const onVisibilityChange = () => {
    cancelAnimationFrame(frame);
    if (!document.hidden && !disposed && !contextLost) {
      previousTime = performance.now();
      frame = requestAnimationFrame(tick);
    }
  };
  const onLost = (event: Event) => {
    event.preventDefault();
    contextLost = true;
    cancelAnimationFrame(frame);
    onContextLost();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  renderer.domElement.addEventListener('webglcontextlost', onLost);
  frame = requestAnimationFrame(tick);

  return {
    setDrone(next) {
      ring.material.color.setHex((DRONE_VARIANTS.find(v => v.id === next.modelVariant) ?? DRONE_VARIANTS[0]).neon);
      if (preview) (preview.material as THREE.LineBasicMaterial).color.set(next.boostStyle.pulseColor);
      disposeDrone();
      drone = createRacingDrone({ variant: next.modelVariant, thrusterIntensity: 0, neonBoost: 2 });
      drone.position.y = 1.05; scene.add(drone);
      thrusters = createThrusterEffect(drone, scene, next.boostStyle); thrusters.setMode(thrustMode);
    },
    setBloom(enabled) { bloom.enabled = enabled; },
    setAutoRotate(enabled) { controls.autoRotate = enabled; },
    setThrustMode(mode) { thrustMode = mode; thrusters.setMode(mode); },
    setThrusterStyle(style) { thrusters.setStyle(style); },
    setView(view) {
      // Consume pending drag momentum before applying an exact camera preset.
      const autoRotate = controls.autoRotate;
      controls.autoRotate = false;
      controls.enableDamping = false;
      controls.update();
      controls.reset();
      controls.target.set(0, 1.0, 0);
      if (view === 'front') camera.position.set(0, 2.8, -9.8);
      else if (view === 'rear') camera.position.set(0, 2.8, 9.8);
      else camera.position.copy(home);
      controls.update();
      controls.enableDamping = true;
      controls.autoRotate = autoRotate;
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      renderer.domElement.removeEventListener('webglcontextlost', onLost);
      controls.dispose();
      thrusters.dispose();
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
          geometries.add(object.geometry);
          (Array.isArray(object.material) ? object.material : [object.material]).forEach((m) => materials.add(m));
        }
      });
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      renderPass.dispose();
      bloom.dispose();
      output.dispose();
      composer.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
