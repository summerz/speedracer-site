import { RACE_CHALLENGES, challengeLapLimit, type RaceChallengeId } from '../track/raceChallenge';
import { createRaceWeather } from '../environment/createRaceWeather';
import { createNightSky } from '../environment/createNightSky';
import { NIGHT_ENVIRONMENTS } from '../environment/raceEnvironment';
import type { NightEnvironment } from '../environment/raceEnvironment';
import { createCatalogTrack } from '../track/trackRuntime';
import type { TrackDefinition } from '../track/trackCatalog';
import { createDistrictScenery } from '../track/createDistrictScenery';
import { RENDER_QUALITIES } from '../../platform/renderQuality';
import type { RenderQuality } from '../../platform/renderQuality';
import { createExhaustHaze } from './createExhaustHaze';
import { gamepadDriving } from '../../platform/gamepadInput';
import * as THREE from 'three';
import { createRaceViews, raceViewLayout, VIEW_LABELS } from './createRaceViews';
import type { RaceView, TrackDisplay, Viewport } from './createRaceViews';
import type { DifficultyPreset } from '../track/difficulty';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { DEFAULT_DRONE_CONFIGURATION, resolveDroneConfiguration } from '../drone/droneConfiguration';
import type { DroneConfiguration } from '../drone/droneConfiguration';
import { createRacingDrone } from '../drone/createRacingDrone';
import { createThrusterEffect } from '../drone/createThrusterEffect';
import { createTrack, createTrackFrame, createTrackVisual, upcomingHeightObstacle } from '../track/createTrack';
import { createSpeedLines } from './createSpeedLines';
import { createTouchControls } from './createTouchControls';
import { createBoostPulse } from './createBoostPulse';
import { createRaceAudio } from './createRaceAudio';
import { RACE_EFFECT_FILES } from '../audio/raceEffectFiles';
import { createRaceFeedback } from './createRaceFeedback';
import { createRaceSoundFeedback } from './createRaceSoundFeedback.js';
import type { RaceAnnouncement } from './createRaceFeedback';
import { createBoostHaptics } from './createBoostHaptics';
import { createBoostWarp } from './createBoostWarp';
import type { RivalItemId } from '../progression/catalog';
import { createRaceSession } from './createRaceSession';
import type { RaceMode, CompetitionSnapshot } from './createRaceSession';
import { createRivalVisuals } from './createRivalVisuals';
import type { RacePhase } from './createTimeAttack';
import { createRaceRecords } from './raceRecords';
import { createRaceGates } from '../track/createRaceGates';
import { forkAt, upcomingFork, physicalDistance, branchChoiceOpen } from '../track/trackBranches';
import type { DrivingState, DrivingInput } from './createDrivingModel';
import type { AltitudeProfile } from '../track/altitudeProfile';
import type { TrackFrame } from '../track/createTrack';
import { configureExtraObstacles, corridorCanPass, obstacleArrivalTime, resolveHeightObstacle, upcomingCorridor } from '../track/obstacleDynamics';

export type DrivingPhase = RacePhase;
export interface RaceSnapshot extends DrivingState {
  competition: CompetitionSnapshot | null;
  altitudeProfile: AltitudeProfile;
  announcement: RaceAnnouncement | null;
  phase: DrivingPhase;
  view: RaceView;
  trackDisplay: TrackDisplay;
  trackLength: number;
  boostStage2Seconds: number;
  upcomingCurvature: number;
  upcomingSection: TrackFrame['section'];
  fork: { kind: 'horizontal' | 'vertical'; names: readonly string[]; selected: string | null; distance: number } | null;
  heightObstacle: { kind: 'rise' | 'descend' | 'middle'; distance: number; minAltitude: number; maxAltitude: number } | null;
  corridor: { distance: number; lane: 'left' | 'center' | 'right'; safe: boolean } | null;
  timeAttack: ReturnType<ReturnType<typeof createRaceSession>['snapshot']>;
}
export interface Race {
  start(): void;
  togglePause(): void;
  restart(): void;
  useFocus(): boolean;
  useRivalItem(item: RivalItemId): boolean;
  recover(): void;
  toggleCockpit(): void;
  cycleTrack(): void;
  setBloom(enabled: boolean): void;
  setQuality(quality: RenderQuality): void;
  setExhaustHaze(enabled: boolean): void;
  setSoundEnabled(enabled: boolean): void;
  setMusicEnabled(enabled: boolean): void;
  setHapticsEnabled(enabled: boolean): void;
  dispose(): void;
}

export function createRace(
  container: HTMLDivElement, onUpdate: (snapshot: RaceSnapshot) => void, onError: () => void,
  configuration: DroneConfiguration = DEFAULT_DRONE_CONFIGURATION,
  altitudeProfile?: AltitudeProfile,
  difficulty?: DifficultyPreset,
  focusSlots = 0,
  mode: RaceMode = 'time-attack',
  course?: TrackDefinition,
  rivalSlots: readonly RivalItemId[] = [],
  environment: NightEnvironment = NIGHT_ENVIRONMENTS[0],
  challenge: RaceChallengeId = 'normal',
): Race {
  const config = resolveDroneConfiguration(configuration);
  const visuals = config.speedEffects;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setClearColor(environment.fog);
  container.dataset.environment = environment.id;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.setAttribute('aria-label', '순환 트랙을 달리는 드론의 추적 시점');
  container.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(environment.fog, environment.fogDensity);
  const ambient = new THREE.HemisphereLight(environment.ambient, 0x152435, environment.ambientIntensity); scene.add(ambient);
  const sun = new THREE.DirectionalLight(environment.light, environment.lightIntensity);
  sun.position.set(-50, 150, -100); scene.add(sun);
  const track = course ? createCatalogTrack(course, challenge) : configureExtraObstacles(createTrack(altitudeProfile, difficulty), challenge);
  const sky = createNightSky(environment, track.sample(0).tangent); scene.add(sky.object);
  const weather = createRaceWeather(!!environment.rain, track.length, Math.random, environment.rainIntensity); scene.add(weather.object);
  container.dataset.rainIntensity = environment.rain ? weather.intensity : 'none';
  const scenery = course ? createDistrictScenery(track, course) : undefined;
  if (scenery) scene.add(scenery.object);
  const trackVisual = createTrackVisual(track, config.boostStyle.pulseColor);
  scene.add(trackVisual.object);
  const drone = createRacingDrone({ variant: config.modelVariant, neonBoost: 1.7, thrusterIntensity: 0.35 });
  scene.add(drone);
  const thrusters = createThrusterEffect(drone, scene, config.boostStyle);
  const boostPulse = createBoostPulse(drone, config.boostStyle.pulseColor);
  const raceAudio = createRaceAudio(RACE_EFFECT_FILES);
  raceAudio.setRainIntensity(environment.rain ? weather.intensity : null);
  const feedback = createRaceFeedback();
  const soundFeedback = createRaceSoundFeedback(track, RACE_CHALLENGES[challenge].warningSeconds);
  const boostHaptics = createBoostHaptics(typeof navigator.vibrate === 'function' ? navigator.vibrate.bind(navigator) : undefined);
  const coarsePointer = window.matchMedia('(any-pointer: coarse)');
  let storage: Storage | undefined;
  try { storage = window.localStorage; } catch { /* Private browsing can deny storage. */ }
  const records = createRaceRecords({ laps: course?.laps, trackId: course ? `${course.id}:v${course.revision}` : `neon-circuit-v1:${difficulty?.id ?? 'beginner'}`, configurationId: JSON.stringify({ ...(challenge !== 'normal' ? { challenge } : {}), performance: config.performance, altitude: track.altitudeProfile, ...(focusSlots || rivalSlots.length ? { assisted: true } : {}), ...(mode === 'competition' ? { mode } : {}) }) }, storage);
  const timeAttack = createRaceSession(track, config, records, focusSlots, mode, Math.random, coarsePointer.matches ? 'touch' : 'desktop', course ? { laps: course.laps, ...(mode === 'time-attack' ? { lapLimit: challengeLapLimit(course, challenge) } : {}) } : {}, course?.rating, rivalSlots, challenge);
  const rivalVisuals = createRivalVisuals(scene, track, timeAttack.rivals);
  const model = timeAttack.model;
  const raceGates = createRaceGates(track, timeAttack.snapshot().gatesPerLap);
  scene.add(raceGates.object);
  const camera = new THREE.PerspectiveCamera(visuals.baseFov, 1, 0.1, 3200);
  const views = createRaceViews(camera, drone, scene, track, undefined, rivalVisuals.entries);
  const speedLines = createSpeedLines(visuals);
  camera.add(speedLines.object); scene.add(camera);
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
  const render = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.65, 0.25, 0.95);
  const exhaustHaze = createExhaustHaze(drone, camera);
  let renderQuality: RenderQuality = 'balanced';
  const output = new OutputPass();
  const boostWarp = createBoostWarp(visuals.boostWarpStrength);
  composer.addPass(render); composer.addPass(bloom); composer.addPass(exhaustHaze.pass); composer.addPass(boostWarp.pass); composer.addPass(output);
  composer.renderToScreen = false;
  const overviewComposer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
  const overviewRender = new RenderPass(scene, views.overviewCamera);
  const overviewOutput = new OutputPass();
  overviewComposer.addPass(overviewRender); overviewComposer.addPass(overviewOutput);
  overviewComposer.renderToScreen = false;
  // Both OutputPass targets already contain display-encoded colors. Blit without a second transform.
  const blitMaterial = new THREE.ShaderMaterial({
    uniforms: { image: { value: composer.readBuffer.texture } },
    vertexShader: 'varying vec2 uvOut; void main() { uvOut = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform sampler2D image; varying vec2 uvOut; void main() { gl_FragColor = texture2D(image, uvOut); }',
    depthTest: false, depthWrite: false, toneMapped: false,
  });
  const blitGeometry = new THREE.PlaneGeometry(2, 2);
  const blitScene = new THREE.Scene(); blitScene.add(new THREE.Mesh(blitGeometry, blitMaterial));
  const blitCamera = new THREE.Camera();
  const pipFrame = document.createElement('div'); pipFrame.className = 'race-pip-frame';
  pipFrame.setAttribute('aria-hidden', 'true'); container.append(pipFrame);
  const rendererSize = new THREE.Vector2();
  let layout = raceViewLayout(1, 1, 'hidden');
  const events = new AbortController();
  const listen = { signal: events.signal };
  const keys = new Set<string>();
  const input: DrivingInput = { throttle: false, brake: false, steer: 0, lift: 0, boost: false };
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const frame = createTrackFrame();
  const upcoming = createTrackFrame();
  const flightForward = new THREE.Vector3();
  const flightRight = new THREE.Vector3();
  const flightUp = new THREE.Vector3();
  const desiredCameraOffset = new THREE.Vector3();
  const cameraOffset = new THREE.Vector3();
  const lookAt = new THREE.Vector3();
  const poseBasis = new THREE.Matrix4();
  const backward = new THREE.Vector3();
  let disposed = false;
  let lost = false;
  let animation = 0;
  let previous = performance.now();
  let hudElapsed = 0;
  let cameraSnap = true;
  let cameraAltitude = model.altitudeProfile.levels[model.altitudeProfile.initialLevel];
  let bank = 0;
  let boostEntryAge = 1;
  let craftShake = 0;

  const notify = () => {
    track.sample(model.state.distance + Math.max(22, model.state.speed * 1.1), upcoming, model.state.routeId);
    const next = upcomingHeightObstacle(track, model.state.distance, model.state.routeId);
    const passage = upcomingCorridor(track, model.state.distance, model.state.routeId);
    const corridor = passage ? { distance: passage.distance, lane: passage.obstacle.lane,
      safe: corridorCanPass(model.state.offset, passage.obstacle) } : null;
    const heightObstacle = next && (!passage || next.distance < passage.distance) ? {
      ...resolveHeightObstacle(next.obstacle, model.altitudeProfile.levels,
        obstacleArrivalTime(track, model.state.elapsed, next.distance, model.state.speed, next.obstacle.depth, model.state.distance, model.state.routeId)),
      distance: Math.max(0, next.distance),
    } : null;
    const session = timeAttack.snapshot();
    const junction = forkAt(track, model.state.distance) ?? upcomingFork(track, model.state.distance, Math.max(170, model.state.speed * 2.5));
    const choosing = branchChoiceOpen(track, model.state.distance);
    const selected = choosing ? undefined : junction?.routes.find(r => r.id === model.state.routeId);
    const fork = junction ? { kind: junction.kind, names: junction.routes.map(r => r.name), selected: selected?.name ?? null,
      distance: physicalDistance(track, model.state.distance, (selected ? junction.end : junction.start + junction.junctionLength) - model.state.distance % track.length, model.state.routeId) } : null;
    onUpdate({ ...model.state, competition: session.competition, announcement: feedback.announcement, boostStage2Seconds: model.boostStage2Seconds, altitudeProfile: model.altitudeProfile, phase: timeAttack.phase, timeAttack: session, view: views.view, trackDisplay: views.trackDisplay, trackLength: track.length, upcomingCurvature: upcoming.curvature, upcomingSection: upcoming.section, heightObstacle, corridor, fork });
  };
  const heightRequests: { lift: number; targetAltitudeLevel?: number }[] = [];
  const touchControls = createTouchControls(container.parentElement ?? container, {
    lift(direction) { if (timeAttack.phase === 'running') heightRequests.push({ lift: direction }); },
    altitude() {
      const count = model.altitudeProfile.levels.length;
      const level = heightRequests.reduce((current, request) =>
        request.targetAltitudeLevel ?? THREE.MathUtils.clamp(current + Math.sign(request.lift), 0, count - 1), model.state.altitudeLevel);
      return { level, count };
    },
    selectAltitude(level) { if (timeAttack.phase === 'running') heightRequests.push({ lift: 0, targetAltitudeLevel: level }); },
    interact() { raceAudio.activate(); },
    releaseBoost() { if (!keys.has('Space')) { model.interruptBoost(); boostHaptics.stop(); notify(); } },
  });
  const clearInput = () => { keys.clear(); heightRequests.length = 0; touchControls.reset(); };
  const pause = () => {
    clearInput(); model.interruptBoost(); raceAudio.pause(); boostHaptics.stop(); boostPulse.reset(); boostWarp.reset(); boostEntryAge = 1;
    timeAttack.pause(); touchControls.setRunning(false); notify();
  };
  const start = () => {
    if (lost || disposed) return;
    clearInput(); raceAudio.activate();
    if (timeAttack.phase === 'ready' || timeAttack.phase === 'finished') { feedback.reset(); raceAudio.reset(); }
    const fresh = timeAttack.phase === 'ready' || timeAttack.phase === 'finished';
    timeAttack.start(); if (fresh) { soundFeedback.reset(); trackVisual.refreshObstacles(); weather.reset(); } touchControls.setRunning(timeAttack.phase === 'running'); previous = performance.now(); notify();
  };
  const togglePause = () => {
    if (timeAttack.phase === 'running' || timeAttack.phase === 'countdown') pause();
    else if (timeAttack.phase === 'paused') start();
  };
  const restart = () => {
    if (lost || disposed) return;
    clearInput(); feedback.reset(); soundFeedback.reset(); raceAudio.activate(); raceAudio.reset(); timeAttack.restart(); trackVisual.refreshObstacles(); weather.reset(); boostPulse.reset(); boostWarp.reset(); boostHaptics.stop(); boostEntryAge = 1; bank = 0; craftShake = 0; cameraSnap = true; touchControls.setRunning(false); previous = performance.now(); notify();
  };
  const recover = () => {
    if (lost || disposed) return;
    const recoveries = model.state.recoveries;
    clearInput(); timeAttack.recover(); boostPulse.reset(); boostWarp.reset(); boostHaptics.stop(); boostEntryAge = 1;
    if (timeAttack.phase === 'running' && model.state.recoveries > recoveries) raceAudio.play('recovery');
    cameraSnap = true; notify();
  };
  const toggleCockpit = () => {
    if (lost || disposed) return;
    views.toggleCockpit(); resize(); cameraSnap = true; camera.fov = visuals.baseFov; camera.updateProjectionMatrix(); boostWarp.reset();
    renderer.domElement.setAttribute('aria-label', `순환 트랙을 달리는 드론의 ${VIEW_LABELS[views.view]} 시점`); notify();
  };
  const cycleTrack = () => {
    if (lost || disposed) return;
    views.cycleTrack(); resize(); notify();
  };
  const controlCodes = new Set(['KeyS', 'KeyA', 'KeyD', 'ArrowDown', 'ArrowUp', 'Space', 'KeyR', 'KeyC', 'KeyX', 'Escape']);
  window.addEventListener('speedracer:pad-action', (event) => {
    if (lost || document.querySelector('dialog[open]')) return;
    const action = (event as CustomEvent<string>).detail;
    if (action === 'pause') { togglePause(); return; }
    if (timeAttack.phase !== 'running') return;
    if (action === 'up' || action === 'down') heightRequests.push({ lift: action === 'up' ? 1 : -1 });
    else if (action === 'cockpit') toggleCockpit();
    else if (action === 'track') cycleTrack();
    else if (action === 'focus') window.dispatchEvent(new CustomEvent('speedracer:focus-request'));
  }, listen);
  window.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || document.querySelector('dialog[open]')) return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
    if (!controlCodes.has(event.code) || lost) return;
    event.preventDefault();
    if (!event.repeat && event.code === 'KeyC') { toggleCockpit(); return; }
    if (!event.repeat && event.code === 'KeyX') { cycleTrack(); return; }
    if (!event.repeat && event.code === 'Escape') { togglePause(); return; }
    if (!event.repeat && event.code === 'KeyR') { window.dispatchEvent(new CustomEvent('speedracer:restart-request')); return; }
    if (timeAttack.phase !== 'running') return;
    raceAudio.activate();
    if (event.code === 'ArrowDown' || event.code === 'ArrowUp') {
      if (!event.repeat) heightRequests.push({ lift: event.code === 'ArrowUp' ? 1 : -1 });
      return;
    }
    keys.add(event.code);
  }, listen);
  window.addEventListener('keyup', (event) => {
    keys.delete(event.code);
    if (event.code === 'Space' && !touchControls.read().boost && !gamepadDriving.boost) { model.interruptBoost(); boostHaptics.stop(); notify(); }
  }, listen);
  window.addEventListener('blur', pause, listen);

  const resize = () => {
    if (disposed || lost) return;
    const { width, height } = container.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;
    const ratio = Math.min(window.devicePixelRatio || 1, RENDER_QUALITIES[renderQuality].pixelRatio);
    renderer.setPixelRatio(ratio); renderer.setSize(width, height, false);
    layout = raceViewLayout(width, height, views.trackDisplay, coarsePointer.matches);
    const driving = layout.driving;
    composer.setPixelRatio(ratio); composer.setSize(driving.width, driving.height);
    speedLines.setSize(driving.width, driving.height); boostWarp.setSize(driving.width, driving.height);
    camera.aspect = driving.width / driving.height; camera.updateProjectionMatrix();
    if (layout.track) {
      overviewComposer.setPixelRatio(ratio); overviewComposer.setSize(layout.track.width, layout.track.height);
      views.resize(layout.track.width, layout.track.height);
    }
    pipFrame.hidden = views.trackDisplay === 'hidden';
    Object.assign(pipFrame.style, { left: `${layout.inset.x}px`, bottom: `${layout.inset.y}px`, width: `${layout.inset.width}px`, height: `${layout.inset.height}px` });
    pipFrame.textContent = coarsePointer.matches
      ? views.trackDisplay === 'primary' ? VIEW_LABELS[views.view] : '전체 트랙'
      : views.trackDisplay === 'primary' ? `${VIEW_LABELS[views.view]} · C 전환 / X 닫기` : '전체 트랙 · X 자리 교환';
    if (mode === 'competition' && views.trackDisplay === 'pip') {
      const legend = document.createElement('span'); legend.className = 'race-map-legend';
      legend.textContent = '◎ 나 · ◆ AI'; pipFrame.append(legend);
    }
  };
  const observer = new ResizeObserver(resize); observer.observe(container);
  coarsePointer.addEventListener('change', resize, listen);
  window.addEventListener('resize', resize, listen); resize();

  const tick = (now: number) => {
    if (disposed || lost) return;
    const delta = Math.min((now - previous) / 1000, 0.1); previous = now;
    const oldRecoveries = model.state.recoveries;
    const oldCollisions = model.state.collisions;
    const oldExits = model.state.offTrackExits;
    const oldBoostStage = model.state.boostStage;
    const oldPhase = timeAttack.phase;
    let heightChanged = false;
    if (oldPhase === 'running' || oldPhase === 'countdown') {
      const touch = touchControls.read();
      input.brake = keys.has('KeyS') || touch.brake || gamepadDriving.brake;
      input.throttle = !input.brake;
      input.steer = THREE.MathUtils.clamp(Number(keys.has('KeyD')) - Number(keys.has('KeyA')) + touch.steer + gamepadDriving.steer, -1, 1);
      input.boost = keys.has('Space') || touch.boost || gamepadDriving.boost;
      for (const request of heightRequests) {
        const previousLevel = model.state.altitudeLevel;
        model.step(0, { ...input, ...request });
        heightChanged ||= model.state.altitudeLevel !== previousLevel;
      }
      heightRequests.length = 0;
      input.lift = 0; timeAttack.step(delta, input);
    }
    if (oldPhase === 'finished') timeAttack.step(delta, { throttle: false, brake: false, boost: false, steer: 0, lift: 0 });
    const phase = timeAttack.phase;
    rivalVisuals.update(delta, reducedMotion.matches);
    const cues = feedback.update({ ...timeAttack.snapshot(), phase, elapsed: model.state.elapsed });
    raceAudio.update(phase, model.state.boostStage, model.state.boostStageProgress, model.state.speed / visuals.referenceSpeed, input.brake);
    const sound = soundFeedback.update(phase, model.state);
    raceAudio.setAltitudeWarning(sound.warning);
    for (const cue of sound.cues) raceAudio.play(cue);
    for (const cue of cues) raceAudio.play(cue);
    if (cues.length) notify();
    if (heightChanged) raceAudio.play('height');
    if (model.state.collisions > oldCollisions) raceAudio.play(model.state.notice === 'height-collision' || model.state.notice === 'corridor-collision' ? 'electric-impact' : 'impact');
    if (model.state.offTrackExits > oldExits) raceAudio.play('off-track');
    if (model.state.recoveries > oldRecoveries) raceAudio.play('recovery');
    if (phase !== oldPhase) {
      touchControls.setRunning(phase === 'running');
      if (phase === 'finished') { clearInput(); boostHaptics.stop(); boostPulse.reset(); boostWarp.reset(); }
      notify();
    }
    if (oldRecoveries !== model.state.recoveries) { cameraSnap = true; boostPulse.reset(); boostWarp.reset(); boostEntryAge = 1; }
    const state = model.state;
    const simulationDelta = phase === 'running' ? delta : 0;
    boostEntryAge += simulationDelta;
    if (phase === 'running' && state.boostStage === 2 && oldBoostStage !== 2) { boostPulse.trigger(); boostEntryAge = 0; notify(); }
    if (state.collisions > oldCollisions && (state.notice === 'height-collision' || state.notice === 'corridor-collision')) {
      trackVisual.hit(state.distance, state.routeId); notify();
    }
    // Quick pullback, then a smooth catch-up over 450 ms. Release cancels the impulse.
    const entry = !reducedMotion.matches && state.boostStage === 2 && boostEntryAge < 0.45
      ? boostEntryAge < 0.055 ? boostEntryAge / 0.055 : (1 - (boostEntryAge - 0.055) / 0.395) ** 2 : 0;
    const targetFov = reducedMotion.matches ? visuals.baseFov : Math.min(100, visuals.baseFov + Math.min(state.speed / visuals.referenceSpeed, 2) * visuals.cruiseFovGain + (state.boosting ? visuals.boostFovGain : 0) + (state.boostStage === 2 ? visuals.boostStage2FovGain : 0) + entry * visuals.boostEntryFovGain);
    const fov = THREE.MathUtils.lerp(camera.fov, targetFov, 1 - Math.exp(-delta * (entry > 0 ? Math.max(18, visuals.fovResponse) : visuals.fovResponse)));
    if (Math.abs(camera.fov - fov) > 0.001) { camera.fov = fov; camera.updateProjectionMatrix(); }
    const cameraScale = Math.tan(THREE.MathUtils.degToRad(visuals.baseFov / 2)) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    track.sample(state.distance, frame, state.routeId);
    drone.position.copy(frame.position).addScaledVector(frame.right, state.offset).addScaledVector(frame.up, state.altitude);
    flightForward.copy(frame.tangent).multiplyScalar(Math.cos(state.heading)).addScaledVector(frame.right, Math.sin(state.heading));
    flightRight.copy(frame.right).multiplyScalar(Math.cos(state.heading)).addScaledVector(frame.tangent, -Math.sin(state.heading));
    flightUp.copy(frame.up);
    const targetBank = phase === 'running' ? -input.steer * 0.32 * Math.min(state.speed / 25, 1) : 0;
    bank = THREE.MathUtils.lerp(bank, reducedMotion.matches ? 0 : targetBank, 1 - Math.exp(-delta * 8));
    drone.quaternion.setFromRotationMatrix(poseBasis.makeBasis(flightRight, flightUp, backward.copy(flightForward).negate()));
    const shakeTarget = phase === 'running' && state.boosting && !reducedMotion.matches
      ? visuals.boostCraftShake * (state.boostStage === 2 ? 1.6 : 1) : 0;
    craftShake = THREE.MathUtils.lerp(craftShake, shakeTarget, 1 - Math.exp(-delta * 16));
    if (reducedMotion.matches) craftShake = 0;
    drone.rotateZ(bank + Math.sin(state.elapsed * 51) * craftShake);
    drone.rotateX(Math.sin(state.elapsed * 67 + 1) * craftShake * .5 + (reducedMotion.matches ? 0 : (state.targetAltitude - state.altitude) * -0.045));
    drone.rotateY(Math.sin(state.elapsed * 43) * craftShake * .35);
    desiredCameraOffset.copy(flightForward).multiplyScalar(-8.5).addScaledVector(flightUp, 3.5);
    const targetCameraAltitude = model.altitudeProfile.levels[0] + (state.altitude - model.altitudeProfile.levels[0]) * 0.62;
    cameraAltitude = cameraSnap ? targetCameraAltitude : THREE.MathUtils.lerp(cameraAltitude, targetCameraAltitude, 1 - Math.exp(-delta * (reducedMotion.matches ? 12 : 4)));
    if (cameraSnap) { cameraOffset.copy(desiredCameraOffset); cameraSnap = false; }
    else cameraOffset.lerp(desiredCameraOffset, 1 - Math.exp(-delta * 9));
    camera.position.copy(drone.position).addScaledVector(cameraOffset, cameraScale);
    camera.position.addScaledVector(flightUp, cameraAltitude - state.altitude);
    camera.position.addScaledVector(flightForward, -entry * visuals.boostEntryPullback);
    if (!reducedMotion.matches && state.boostStage === 2 && boostEntryAge < 0.22) {
      const shake = visuals.boostEntryShake * (1 - boostEntryAge / 0.22) ** 2;
      camera.position.addScaledVector(flightRight, Math.sin(boostEntryAge * 110) * shake)
        .addScaledVector(flightUp, Math.sin(boostEntryAge * 87 + 1) * shake);
    }
    lookAt.copy(drone.position).addScaledVector(flightForward, 9).addScaledVector(flightUp, cameraAltitude - state.altitude - 0.5); camera.up.copy(flightUp); camera.lookAt(lookAt);
    views.update(flightForward, flightUp, bank, state.elapsed, state.boosting, reducedMotion.matches, state.routeId);
    thrusters.setMode(state.boostStage === 2 ? 'boost-stage2' : phase === 'running' && state.boosting ? 'boost' : phase === 'running' && input.throttle && state.speed > 1 ? 'accelerate' : 'idle');
    thrusters.setBoostCharge(state.boostStageProgress);
    thrusters.update(simulationDelta, reducedMotion.matches);
    boostPulse.update(simulationDelta, reducedMotion.matches);
    boostWarp.update(simulationDelta, state.boostStage === 2, entry, reducedMotion.matches);
    boostHaptics.update(simulationDelta, state.boostStage, phase === 'running' && coarsePointer.matches && !reducedMotion.matches);
    if (heightChanged && coarsePointer.matches && !reducedMotion.matches) boostHaptics.altitudeStep();
    hudElapsed += delta;
    if (hudElapsed >= 0.08) { hudElapsed = 0; notify(); }
    trackVisual.update(track.obstacleTime ?? state.elapsed, reducedMotion.matches, state.distance, state.altitude, state.speed, state.offset, state.routeId);
    raceGates.update(timeAttack.snapshot().nextCheckpoint);
    speedLines.update(state.elapsed, state.speed, state.boosting, reducedMotion.matches, state.boostStage === 2);
    views.prepareDriving();
    scenery?.setOverview(false); scenery?.update(drone.position); sky.update(camera.position);
    const weatherFrame = weather.update(camera.position, state.distance, delta, phase === 'running', reducedMotion.matches);
    ambient.intensity = environment.ambientIntensity + weatherFrame.flash * 5;
    sun.intensity = environment.lightIntensity + weatherFrame.flash * 10;
    sky.setLightning(weatherFrame.flash);
    for (let i = 0; i < weatherFrame.thunders; i++) raceAudio.play('thunder');
    exhaustHaze.update(state.elapsed, state.boostStage, phase === 'running' && state.speed > 1, views.view === 'cockpit', reducedMotion.matches);
    composer.render(delta);
    if (layout.track) {
      const linesVisible = speedLines.object.visible;
      speedLines.object.visible = false;
      views.prepareOverview(); scenery?.setOverview(true); sky.setOverview(true); weather.setOverview(true); overviewComposer.render(delta); scenery?.setOverview(false); sky.setOverview(false); weather.setOverview(false);
      speedLines.object.visible = linesVisible;
      views.prepareDriving();
    }
    renderer.setRenderTarget(null); renderer.setScissorTest(false); renderer.clear();
    const blit = (rect: Viewport, texture: THREE.Texture) => {
      renderer.setViewport(rect.x, rect.y, rect.width, rect.height);
      renderer.setScissor(rect.x, rect.y, rect.width, rect.height); renderer.setScissorTest(true);
      blitMaterial.uniforms.image.value = texture; renderer.render(blitScene, blitCamera);
    };
    if (views.trackDisplay === 'primary' && layout.track) {
      blit(layout.track, overviewComposer.readBuffer.texture); blit(layout.driving, composer.readBuffer.texture);
    } else {
      blit(layout.driving, composer.readBuffer.texture);
      if (layout.track) blit(layout.track, overviewComposer.readBuffer.texture);
    }
    renderer.setScissorTest(false);
    renderer.getSize(rendererSize); renderer.setViewport(0, 0, rendererSize.x, rendererSize.y);
    animation = requestAnimationFrame(tick);
  };
  document.addEventListener('visibilitychange', () => {
    cancelAnimationFrame(animation);
    if (document.hidden) pause();
    else if (!disposed && !lost) { previous = performance.now(); animation = requestAnimationFrame(tick); }
  }, listen);
  renderer.domElement.addEventListener('webglcontextlost', (event) => {
    event.preventDefault(); lost = true; pause(); cancelAnimationFrame(animation); onError();
  }, listen);
  notify(); animation = requestAnimationFrame(tick);
  return {
    start, togglePause, restart, useFocus() { const used = timeAttack.useFocus(); if (used) notify(); return used; }, useRivalItem(item) { const used = timeAttack.useRivalItem(item); if (used) notify(); return used; }, recover, toggleCockpit, cycleTrack,
    setBloom(enabled) { bloom.enabled = enabled; },
    setQuality(quality) { scenery?.setQuality(quality); weather.setQuality(quality); renderQuality = quality; resize(); },
    setExhaustHaze(enabled) { exhaustHaze.setEnabled(enabled); },
    setSoundEnabled(enabled) { raceAudio.setEnabled(enabled); },
    setMusicEnabled(enabled) { raceAudio.setMusicEnabled(enabled); },
    setHapticsEnabled(enabled) { boostHaptics.setEnabled(enabled); },
    dispose() {
      disposed = true; cancelAnimationFrame(animation); events.abort(); observer.disconnect();
      touchControls.dispose(); rivalVisuals.dispose(); thrusters.dispose(); boostPulse.dispose(); raceAudio.dispose(); boostHaptics.dispose();
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      const signTextures = new Set<THREE.Texture>();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
          geometries.add(object.geometry);
          (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => {
            materials.add(material);
            if (object.name.startsWith('junction-sign-') && material instanceof THREE.MeshBasicMaterial && material.map) signTextures.add(material.map);
          });
          if (object instanceof THREE.InstancedMesh) object.dispose();
        }
      });
      geometries.forEach((geometry) => geometry.dispose()); materials.forEach((material) => material.dispose());
      signTextures.forEach(texture => texture.dispose());
      render.dispose(); bloom.dispose(); exhaustHaze.pass.dispose(); boostWarp.pass.dispose(); output.dispose(); composer.dispose();
      overviewRender.dispose(); overviewOutput.dispose(); overviewComposer.dispose();
      blitGeometry.dispose(); blitMaterial.dispose(); pipFrame.remove();
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); delete container.dataset.environment;
    },
  };
}
