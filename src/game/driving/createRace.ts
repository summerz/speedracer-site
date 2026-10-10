import { upcomingTrackJump, type JumpCue } from '../track/trackJump.js';
import { createTutorialTrack, createTutorialRuntime } from './scriptedTutorial';
import type { createDrivingTutorial, TutorialSnapshot, TutorialStatus } from './drivingTutorial';
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
import { createAutomaticQuality } from '../../platform/automaticQuality';
import type { QualityPreference, QualityStatus } from '../../platform/automaticQuality';
import { createExhaustHaze } from './createExhaustHaze';
import { gamepadDriving } from '../../platform/gamepadInput';
import * as THREE from 'three';
import { createRaceViews, overviewPose, raceViewLayout, VIEW_LABELS } from './createRaceViews';
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
import { createOverdriveEffect } from '../drone/createOverdriveEffect';
import { createAwakeningCoreVisual } from './createAwakeningCoreVisual';
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
import { createGhostRecorder, ghostDelta, ghostKey, loadGhost, saveGhost, shouldSaveGhost } from './raceGhost';
import { createGhostVisual } from './createGhostVisual';
import { INTRO_SECONDS, SWING_SECONDS, cinematicSeconds, finishSwing, finishTimeScale, introProgress, replayShot, showcaseAt, showcasePlan } from './raceCinematic';
import type { CinematicKind, CinematicShot, ShowcaseAt } from './raceCinematic';
import { createReplayBuffer } from './raceReplay';
import type { ReplayPose } from './raceReplay';
import { DRONE_CATALOG } from '../drone/droneCatalog';
import { createOvertakeCallouts, isPerfectStart, PERFECT_START_SPEED, PERFECT_START_WINDOW } from './raceCallouts';
import type { Callout } from './raceCallouts';
import { createRaceGates } from '../track/createRaceGates';
import { forkAt, upcomingFork, physicalDistance, branchChoiceOpen, verticalThreshold } from '../track/trackBranches';
import type { DrivingState, DrivingInput } from './createDrivingModel';
import type { AltitudeProfile } from '../track/altitudeProfile';
import type { TrackFrame } from '../track/createTrack';
import { arcRailGuide, boostRingGuide } from '../track/arcRail';
import { boostPadGuide, configureExtraObstacles, corridorCanPass, mineFieldGuide, obstacleArrivalTime, resolveHeightObstacle, upcomingCorridor } from '../track/obstacleDynamics';

export type DrivingPhase = RacePhase;
export interface RaceSnapshot extends DrivingState {
  jump: JumpCue | null;
  tutorial: TutorialSnapshot | null;
  tutorialStatus: TutorialStatus | null;
  tutorialTargetScreen: { x: number; y: number; visible: boolean } | null;
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
  fork: { kind: 'horizontal' | 'vertical'; names: readonly string[]; level: number; selected: string | null; distance: number } | null;
  heightObstacle: { kind: 'rise' | 'descend' | 'middle'; distance: number; minAltitude: number; maxAltitude: number } | null;
  corridor: { distance: number; lane: 'left' | 'center' | 'right'; safe: boolean } | null;
  mineField: { distance: number; hint: 'left' | 'center' | 'right' | null } | null;
  boostPad: { distance: number; lane: 'left' | 'center' | 'right'; safe: boolean } | null;
  arcRail: { distance: number; side: -1 | 1; safe: boolean } | null;
  boostRing: { distance: number; side: 'left' | 'right'; safe: boolean } | null;
  timeAttack: ReturnType<ReturnType<typeof createRaceSession>['snapshot']>;
  cinematic: { kind: CinematicKind; reduced: boolean; seconds: number; shot?: CinematicShot } | null;
  callout: Callout | null;
  /** Seconds behind (+) / ahead (-) of the stored best run at the current distance; null without a ghost. */
  ghostDelta: number | null;
}
export interface Race {
  continueTutorial(): boolean;
  start(): void;
  togglePause(): void;
  restart(): void;
  skipTutorial(): void;
  skipAllTutorial(): void;
  skipCinematic(): void;
  useFocus(): boolean;
  useAwakening(): boolean;
  useRivalItem(item: RivalItemId): boolean;
  recover(): void;
  toggleCockpit(): void;
  cycleTrack(): void;
  setBloom(enabled: boolean): void;
  setQuality(preference: QualityPreference): void;
  onQualityChange(listener: (status: QualityStatus) => void): () => void;
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
  intro = false,
  guidance: { tutorial?: ReturnType<typeof createDrivingTutorial>; practice?: boolean } = {},
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
  const baseTrack = course ? createCatalogTrack(course, challenge) : configureExtraObstacles(createTrack(altitudeProfile, difficulty), challenge, difficulty?.id);
  const track = guidance.tutorial ? createTutorialTrack(baseTrack) : baseTrack;
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
  const overdrive = createOverdriveEffect(drone, config.boostStyle.pulseColor);
  overdrive.setStrength(0); overdrive.update(0);
  let awakeningStrength = 0;
  const boostPulse = createBoostPulse(drone, config.boostStyle.pulseColor);
  const raceAudio = createRaceAudio(RACE_EFFECT_FILES);
  raceAudio.setRainIntensity(environment.rain ? weather.intensity : null);
  const feedback = createRaceFeedback();
  const soundFeedback = createRaceSoundFeedback(track, RACE_CHALLENGES[challenge].warningSeconds);
  const boostHaptics = createBoostHaptics(typeof navigator.vibrate === 'function' ? navigator.vibrate.bind(navigator) : undefined);
  const coarsePointer = window.matchMedia('(any-pointer: coarse)');
  let storage: Storage | undefined;
  try { storage = window.localStorage; } catch { /* Private browsing can deny storage. */ }
  const trackId = course ? `${course.id}:v${course.revision}` : `neon-circuit-v1:${difficulty?.id ?? 'beginner'}`;
  const records = createRaceRecords({ laps: course?.laps, trackId, configurationId: JSON.stringify({ ...(challenge !== 'normal' ? { challenge } : {}), performance: config.performance, altitude: track.altitudeProfile, ...(focusSlots || rivalSlots.length ? { assisted: true } : {}), ...(mode === 'competition' ? { mode } : {}) }) }, storage);
  const training = !!guidance.practice || !!guidance.tutorial;
  const timeAttack = createRaceSession(track, config, records, focusSlots, mode, Math.random, coarsePointer.matches ? 'touch' : 'desktop', { practice: training, ...(course ? { laps: course.laps, ...(mode === 'time-attack' ? { lapLimit: challengeLapLimit(course, challenge) } : {}) } : {}) }, course?.rating, rivalSlots, challenge);
  const rivalVisuals = createRivalVisuals(scene, track, timeAttack.rivals);
  const ghostStorageKey = ghostKey(trackId, challenge);
  const ghost = mode === 'time-attack' && !guidance.tutorial ? loadGhost(storage, ghostStorageKey) : null;
  const ghostVisual = ghost && createGhostVisual(scene, track, ghost, config.modelVariant);
  const ghostRecorder = createGhostRecorder();
  const model = timeAttack.model;
  const tutorialRuntime = guidance.tutorial && createTutorialRuntime(track, timeAttack, guidance.tutorial);
  const tutorialFrozen = () => !!guidance.tutorial?.snapshot()?.frozen;
  const targetPoint = new THREE.Vector3();
  const tutorialTargetScreen = () => {
    const target = guidance.tutorial?.snapshot()?.target; if (!target || views.trackDisplay === 'primary') return null;
    const d = layout.driving; targetPoint.set(target.worldPosition.x, target.worldPosition.y, target.worldPosition.z).project(camera);
    return { x: d.x + (targetPoint.x + 1) / 2 * d.width, y: d.height - (targetPoint.y + 1) / 2 * d.height, visible: targetPoint.z < 1 && Math.abs(targetPoint.x) < 1.1 && Math.abs(targetPoint.y) < 1.1 };
  };
  const coreVisual = createAwakeningCoreVisual(track, model); scene.add(coreVisual.object);
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
  const autoQuality = createAutomaticQuality('auto');
  let hapticCollisions = 0, hapticNearMisses = 0;
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
  const craftEntry = DRONE_CATALOG.find(c => c.configuration.modelVariant === config.modelVariant);
  const newCinematic = (kind: CinematicKind) => {
    const reduced = reducedMotion.matches, plan = showcasePlan(kind === 'intro' ? timeAttack.rivals.length : 0, reduced);
    const infos: CinematicShot[] = plan.shots.map((shot, i) => {
      const rival = shot.kind === 'rival' ? timeAttack.rivals[shot.index] : null;
      return rival ? { kind: 'rival', name: rival.name, color: rival.color, detail: `${rival.craftName.toUpperCase()} · ${rival.style} · ★${rival.rating}`, index: i, total: plan.shots.length }
        : { kind: 'player', name: (craftEntry?.name ?? 'PLAYER').toUpperCase(), color: craftEntry?.lineColor, index: i, total: plan.shots.length };
    });
    return { kind, t: 0, reduced, duration: cinematicSeconds(kind, reduced, kind === 'intro' ? timeAttack.rivals.length : 0), plan, infos };
  };
  let cinematic: ReturnType<typeof newCinematic> | null = intro ? newCinematic('intro') : null;
  let padArmed = false;
  // Perfect start: seconds left until GO when boost was pressed (null = not pressed), and whether the launch window is settled.
  let untilGo = 3, pressAt: number | null = null, launched = false, spaceHeld = false, boostHeld = false;
  let callout: Callout | null = null;
  const overtakes = createOvertakeCallouts();
  const armStart = () => { untilGo = 3; pressAt = null; launched = false; boostHeld = false; overtakes.reset(); };
  const say = (kind: Callout['kind'], text: string, icon?: Callout['icon']) => { callout = { id: (callout?.id ?? 0) + 1, kind, text, icon }; notify(); };
  const swallowed = new Set<string>();
  const introPos = new THREE.CatmullRomCurve3([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]);
  const introLook = new THREE.CatmullRomCurve3([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]);
  const introTarget = new THREE.Vector3(), worldUp = new THREE.Vector3(0, 1, 0);
  let introAspect = 0;
  const shotAt: ShowcaseAt = { shot: 0, u: 0, blend: 0 }, noteAt: ShowcaseAt = { shot: 0, u: 0, blend: 0 };
  const shotPos = new THREE.Vector3(), shotLook = new THREE.Vector3(), shotF = new THREE.Vector3(), shotR = new THREE.Vector3(), shotU = new THREE.Vector3();
  const currentShot = () => cinematic?.kind === 'intro' && !cinematic.reduced && cinematic.t >= INTRO_SECONDS && showcaseAt(cinematic.plan, cinematic.t - INTRO_SECONDS, noteAt) ? cinematic.infos[noteAt.shot] : undefined;
  // Finish replay: the last seconds of running, looped behind the result screen with three hard-cut camera shots.
  const replayBuffer = createReplayBuffer(), replayPose: ReplayPose = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, speed: 0, mode: 0 }, replayAnchor: ReplayPose = { ...replayPose };
  const replayPick = { shot: 0 as 0 | 1 | 2, u: 0, v: 0 }, replayQuat = new THREE.Quaternion(), replayShotFov = [38, 56, 56] as const;
  // Portrait screens widen the vertical field so the craft is not cropped.
  const fitFov = (fov: number) => THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov / 2)) * Math.min(2, Math.max(1, 1.3 / camera.aspect))));
  const SHOWCASE_FOV = 42, REPLAY_MODES = ['idle', 'accelerate', 'boost', 'boost-stage2'] as const;
  let replayClock = 0, replayT = 0, replaying = false;

  const notify = () => {
    track.sample(model.state.distance + Math.max(22, model.state.speed * 1.1), upcoming, model.state.routeId);
    const next = upcomingHeightObstacle(track, model.state.distance, model.state.routeId);
    const passage = upcomingCorridor(track, model.state.distance, model.state.routeId);
    const corridor = passage ? { distance: passage.distance, lane: passage.obstacle.lane, safe: corridorCanPass(model.state.offset, passage.obstacle) } : null;
    const nearestHazard = Math.min(passage?.distance ?? Infinity, next?.distance ?? Infinity);
    const mineField = mineFieldGuide(track, model.state.distance, model.state.speed, model.state.routeId, nearestHazard < Infinity ? nearestHazard : null, challenge === 'easy');
    const heightObstacle = !mineField && next && (!passage || next.distance < passage.distance) ? {
      ...resolveHeightObstacle(next.obstacle, model.altitudeProfile.levels,
        obstacleArrivalTime(track, model.state.elapsed, next.distance, model.state.speed, next.obstacle.depth, model.state.distance, model.state.routeId)),
      distance: Math.max(0, next.distance),
    } : null;
    const hazards = [passage?.distance, heightObstacle?.distance, mineField?.distance].filter((d): d is number => d !== undefined);
    const arcRail = arcRailGuide(track, model.state.distance, model.state.offset, model.state.speed, model.state.routeId, hazards.length ? Math.min(...hazards) : null);
    if (arcRail) hazards.push(arcRail.distance);
    const boostPad = boostPadGuide(track, model.state.distance, model.state.offset, model.state.routeId, hazards.length ? Math.min(...hazards) : null);
    const boostRing = boostRingGuide(track, model.state.distance, model.state.offset, model.state.routeId, hazards.length ? Math.min(...hazards) : null);
    const session = timeAttack.snapshot();
    const junction = forkAt(track, model.state.distance) ?? upcomingFork(track, model.state.distance, Math.max(170, model.state.speed * 2.5));
    const choosing = branchChoiceOpen(track, model.state.distance);
    const selected = choosing ? undefined : junction?.routes.find(r => r.id === model.state.routeId);
    const fork = junction ? { kind: junction.kind, names: junction.routes.map(r => r.name), level: verticalThreshold(track) + 1, selected: selected?.name ?? null,
      distance: physicalDistance(track, model.state.distance, (selected ? junction.end : junction.start + junction.junctionLength) - model.state.distance % track.length, model.state.routeId) } : null;
    onUpdate({ ...model.state, jump: upcomingTrackJump(track, model.state.distance, model.state.routeId), tutorial: timeAttack.phase === 'finished' ? null : guidance.tutorial?.snapshot() ?? null, tutorialStatus: guidance.tutorial?.status() ?? null, tutorialTargetScreen: timeAttack.phase === 'finished' ? null : tutorialTargetScreen(), competition: session.competition, announcement: feedback.announcement, boostStage2Seconds: model.boostStage2Seconds, altitudeProfile: model.altitudeProfile, phase: timeAttack.phase, timeAttack: session, cinematic: cinematic && { kind: cinematic.kind, reduced: cinematic.reduced, seconds: cinematic.duration, shot: currentShot() }, callout, ghostDelta: ghost && timeAttack.phase !== 'finished' && model.state.elapsed > 0 ? ghostDelta(ghost, model.state.elapsed, model.state.distance) : null, view: views.view, trackDisplay: views.trackDisplay, trackLength: track.length, upcomingCurvature: upcoming.curvature, upcomingSection: upcoming.section, heightObstacle, corridor, mineField, boostPad, arcRail, boostRing, fork });
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
    releaseBoost() { if (!tutorialFrozen() && !keys.has('Space')) { model.interruptBoost(); boostHaptics.stop(); notify(); } },
  });
  const clearInput = () => { keys.clear(); heightRequests.length = 0; touchControls.reset(); };
  const pause = () => {
    clearInput(); model.interruptBoost(); raceAudio.pause(); boostHaptics.stop(); boostPulse.reset(); boostWarp.reset(); boostEntryAge = 1;
    timeAttack.pause(); touchControls.setRunning(false); notify();
  };
  const finishGhost = () => {
    if (training) return;
    const { result, disqualified } = timeAttack.snapshot();
    if (result && shouldSaveGhost({ mode, disqualified, isNewBest: result.isNewBest })) saveGhost(storage, ghostStorageKey, ghostRecorder.finish(model.state, model.state.elapsed, model.state.distance));
  };
  const endCinematic = () => { if (cinematic) { cinematic = null; notify(); } };
  const start = () => {
    if (lost || disposed) return;
    if (cinematic) { endCinematic(); return; }
    clearInput(); raceAudio.activate();
    if (timeAttack.phase === 'ready' || timeAttack.phase === 'finished') { feedback.reset(); raceAudio.reset(); }
    const fresh = timeAttack.phase === 'ready' || timeAttack.phase === 'finished';
    timeAttack.start(); if (fresh) { ghostRecorder.reset(); replayBuffer.reset(); replayClock = 0; replayT = 0; armStart(); soundFeedback.reset(); trackVisual.refreshObstacles(); raceGates.refresh(); weather.reset(); hapticCollisions = 0; hapticNearMisses = 0; } touchControls.setRunning(timeAttack.phase === 'running'); previous = performance.now(); notify();
  };
  const togglePause = () => {
    if (timeAttack.phase === 'running' || timeAttack.phase === 'countdown') pause();
    else if (timeAttack.phase === 'paused') start();
  };
  const restart = () => {
    if (lost || disposed) return;
    clearInput(); feedback.reset(); soundFeedback.reset(); raceAudio.activate(); raceAudio.reset(); timeAttack.restart(); hapticCollisions = 0; hapticNearMisses = 0; ghostRecorder.reset(); replayBuffer.reset(); replayClock = 0; replayT = 0; armStart(); trackVisual.refreshObstacles(); raceGates.refresh(); weather.reset(); boostPulse.reset(); boostWarp.reset(); boostHaptics.stop(); boostEntryAge = 1; bank = 0; craftShake = 0; cameraSnap = true; touchControls.setRunning(false); previous = performance.now(); notify();
  };
  const recover = () => {
    if (lost || disposed || guidance.tutorial?.snapshot()) return;
    const recoveries = model.state.recoveries;
    clearInput(); timeAttack.recover(); boostPulse.reset(); boostWarp.reset(); boostHaptics.stop(); boostEntryAge = 1;
    if (timeAttack.phase === 'running' && model.state.recoveries > recoveries) raceAudio.play('recovery');
    cameraSnap = true; notify();
  };
  const useAwakening = () => {
    if (lost || disposed || guidance.tutorial?.snapshot() || !timeAttack.useAwakening()) return false;
    clearInput(); raceAudio.activate(); boostPulse.trigger();
    say('perfect', '코어 각성', 'awakening'); notify(); return true;
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
  const continueTutorial = () => { if (timeAttack.phase !== 'running') return false; const continued = guidance.tutorial?.continue() ?? false; if (continued) notify(); return continued; };
  const controlCodes = new Set(['KeyS', 'KeyA', 'KeyD', 'KeyW', 'ArrowDown', 'ArrowUp', 'Space', 'KeyR', 'KeyC', 'KeyX', 'Escape', 'Enter']);
  window.addEventListener('speedracer:pad-action', (event) => {
    if (lost || document.querySelector('dialog[open]')) return;
    const action = (event as CustomEvent<string>).detail;
    if (action === 'confirm' && guidance.tutorial?.snapshot()) { continueTutorial(); return; }
    if (action === 'pause') { togglePause(); return; }
    if (timeAttack.phase !== 'running') return;
    if (action === 'up' || action === 'down') heightRequests.push({ lift: action === 'up' ? 1 : -1 });
    else if (action === 'cockpit') toggleCockpit();
    else if (action === 'track') cycleTrack();
    else if (action === 'focus') window.dispatchEvent(new CustomEvent('speedracer:focus-request'));
  }, listen);
  // Any key, tap or pad button skips a cinematic and is consumed, so it cannot also press the start button.
  window.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || (!cinematic && !swallowed.has(event.code))) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (cinematic) { swallowed.add(event.code); endCinematic(); }
  }, { ...listen, capture: true });
  window.addEventListener('keyup', (event) => {
    if (swallowed.delete(event.code)) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, { ...listen, capture: true });
  window.addEventListener('click', (event) => {
    if (cinematic) { event.preventDefault(); event.stopImmediatePropagation(); endCinematic(); }
  }, { ...listen, capture: true });
  window.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || document.querySelector('dialog[open]')) return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
    if (!controlCodes.has(event.code) || lost) return;
    event.preventDefault();
    if (!event.repeat && event.code === 'KeyC') { toggleCockpit(); return; }
    if (!event.repeat && event.code === 'KeyX') { cycleTrack(); return; }
    if (event.code === 'Enter') { if (!event.repeat) continueTutorial(); return; }
    if (!event.repeat && event.code === 'Escape') { togglePause(); return; }
    if (!event.repeat && event.code === 'KeyR') { window.dispatchEvent(new CustomEvent('speedracer:restart-request')); return; }
    if (event.code === 'KeyW') { if (!event.repeat) useAwakening(); return; }
    if (event.code === 'Space') {
      spaceHeld = true;
      if (!event.repeat && !launched && (timeAttack.phase === 'countdown' || timeAttack.phase === 'running')) pressAt = untilGo;
    }
    if (timeAttack.phase !== 'running') return;
    raceAudio.activate();
    if (event.code === 'ArrowDown' || event.code === 'ArrowUp') {
      if (!event.repeat) heightRequests.push({ lift: event.code === 'ArrowUp' ? 1 : -1 });
      return;
    }
    keys.add(event.code);
  }, listen);
  window.addEventListener('keyup', (event) => {
    keys.delete(event.code); if (event.code === 'Space') spaceHeld = false;
    if (event.code === 'Space' && !tutorialFrozen() && !touchControls.read().boost && !gamepadDriving.boost) { model.interruptBoost(); boostHaptics.stop(); notify(); }
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
      legend.textContent = '◎ 나 · ◆ 상대'; pipFrame.append(legend);
    }
  };
  const observer = new ResizeObserver(resize); observer.observe(container);
  coarsePointer.addEventListener('change', resize, listen);
  window.addEventListener('resize', resize, listen); resize();

  const tick = (now: number) => {
    if (disposed || lost) return;
    const rawFrameMs = now - previous, delta = Math.min(rawFrameMs / 1000, 0.1); previous = now;
    const qualityReport = autoQuality.sample(rawFrameMs, timeAttack.phase === 'running' && !tutorialFrozen() && !document.hidden);
    if (import.meta.env.DEV && qualityReport?.metrics) console.info('[race-performance]', { trackId, preference: qualityReport.preference, appliedQuality: qualityReport.quality, ...qualityReport.metrics });
    const oldRecoveries = model.state.recoveries;
    const oldCollisions = model.state.collisions, oldPads = model.state.boostPads, oldRings = model.state.boostRings;
    const oldExits = model.state.offTrackExits;
    const oldBoostStage = model.state.boostStage;
    const oldPhase = timeAttack.phase;
    const oldNearMisses = model.state.nearMisses;
    const oldCores = model.state.coresCollected;
    const oldAwakening = model.state.awakeningRemaining;
    let heightChanged = false, worldDelta = 0;
    if (cinematic) {
      const pressed = Array.from(navigator.getGamepads?.() ?? []).some(pad => pad?.buttons.some(button => button.pressed));
      if (!pressed) padArmed = true; else if (padArmed) endCinematic();
    } else padArmed = false;
    replaying = !training && oldPhase === 'finished' && !cinematic && !reducedMotion.matches && replayBuffer.seconds() >= .5;
    const slow = cinematic?.kind === 'finish' ? finishTimeScale(cinematic.t, cinematic.reduced) : 1;
    if (oldPhase === 'running' || oldPhase === 'countdown') {
      const touch = touchControls.read();
      input.brake = keys.has('KeyS') || touch.brake || gamepadDriving.brake;
      input.throttle = !input.brake;
      input.steer = THREE.MathUtils.clamp(Number(keys.has('KeyD')) - Number(keys.has('KeyA')) + touch.steer + gamepadDriving.steer, -1, 1);
      input.boost = keys.has('Space') || touch.boost || gamepadDriving.boost;
      const padBoost = touch.boost || gamepadDriving.boost;
      if (padBoost && !boostHeld && !launched) pressAt = untilGo;
      boostHeld = padBoost;
      if (tutorialRuntime) {
        const applied = tutorialRuntime.step(delta, input, heightRequests);
        Object.assign(input, applied.input); heightChanged = applied.altitudeChanged; worldDelta = applied.simulationDelta;
      } else {
        for (const request of heightRequests) {
          const previousLevel = model.state.altitudeLevel;
          model.step(0, { ...input, ...request });
          heightChanged ||= model.state.altitudeLevel !== previousLevel;
        }
        input.lift = 0; timeAttack.step(delta, input); worldDelta = delta;
      }
      heightRequests.length = 0;
    }
    if (oldPhase === 'finished') timeAttack.step(delta * slow, { throttle: false, brake: false, boost: false, steer: 0, lift: 0 });
    const phase = timeAttack.phase;
    if (oldPhase === 'countdown' || oldPhase === 'running') untilGo = Math.max(-1, untilGo - delta);
    if (phase === 'running' && !launched) {
      if (!guidance.tutorial && isPerfectStart(pressAt)) {
        launched = true; model.launch(config.performance.topSpeed * PERFECT_START_SPEED); if (spaceHeld) keys.add('Space');
        raceAudio.play('boost-full'); say('perfect', 'PERFECT START');
      } else if (untilGo < -PERFECT_START_WINDOW) launched = true;
    }
    if (mode === 'competition' && phase === 'running') {
      const rank = timeAttack.snapshot().competition?.playerRank, move = rank ? overtakes.update(rank, model.state.elapsed) : null;
      if (move) say(move.gained ? 'gain' : 'loss', `P${move.from} → P${move.to}`);
    }
    if (model.state.nearMisses > oldNearMisses) { raceAudio.play('boost-full'); boostPulse.trigger(); notify(); }
    if (model.state.coresCollected > oldCores) { raceAudio.play('boost-full'); say('pickup', '각성 코어 획득'); }
    if (oldAwakening > 0 && model.state.awakeningRemaining === 0 && phase === 'running') { raceAudio.play('boost-complete'); notify(); }
    rivalVisuals.update((guidance.tutorial ? worldDelta : delta) * slow, reducedMotion.matches);
    if (!training && mode === 'time-attack' && timeAttack.phase === 'running') ghostRecorder.sample(model.state);
    ghostVisual?.update(model.state.elapsed, cinematic?.kind !== 'intro' && phase !== 'finished' && model.state.elapsed > 0);
    const cues = feedback.update({ ...timeAttack.snapshot(), phase, elapsed: model.state.elapsed });
    raceAudio.update(phase === 'running' && tutorialFrozen() ? 'paused' : phase, model.state.awakeningRemaining > 0 ? 2 : model.state.boostStage,
      model.state.awakeningRemaining > 0 ? 1 : model.state.boostStageProgress,
      model.state.speed / visuals.referenceSpeed, model.state.awakeningRemaining === 0 && input.brake);
    const sound = soundFeedback.update(phase, model.state);
    raceAudio.setAltitudeWarning(model.state.awakeningRemaining > 0 ? null : sound.warning);
    if (model.state.awakeningRemaining === 0) for (const cue of sound.cues) raceAudio.play(cue);
    for (const cue of cues) raceAudio.play(cue);
    if (cues.length) notify();
    if (heightChanged) raceAudio.play('height');
    if (model.state.collisions > oldCollisions) raceAudio.play(model.state.notice === 'height-collision' || model.state.notice === 'corridor-collision' ? 'electric-impact' : 'impact');
    if (model.state.boostRings > oldRings) { raceAudio.play('boost-full'); trackVisual.hitRing(model.state.distance, model.state.routeId); say('pickup', '부스트 링 획득'); }
    if (model.state.boostPads > oldPads) { raceAudio.play('boost-full'); trackVisual.hitPad(model.state.distance, model.state.routeId); say('pickup', '부스트 패드 획득'); }
    if (model.state.offTrackExits > oldExits) raceAudio.play('off-track');
    if (model.state.recoveries > oldRecoveries) raceAudio.play('recovery');
    if (phase !== oldPhase) {
      touchControls.setRunning(phase === 'running');
      if (phase === 'finished') { clearInput(); boostHaptics.stop(); boostPulse.reset(); boostWarp.reset(); cinematic = guidance.tutorial ? null : newCinematic('finish'); finishGhost(); }
      notify();
    }
    if (cinematic && (cinematic.t += delta) >= cinematic.duration) endCinematic();
    if (oldRecoveries !== model.state.recoveries) { cameraSnap = true; boostPulse.reset(); boostWarp.reset(); boostEntryAge = 1; }
    const state = model.state;
    const awake = state.awakeningRemaining > 0;
    const simulationDelta = phase === 'running' ? worldDelta : 0;
    const sceneDelta = tutorialFrozen() && phase === 'running' ? 0 : delta;
    boostEntryAge += simulationDelta;
    if (phase === 'running' && state.boostStage === 2 && oldBoostStage !== 2) { boostPulse.trigger(); boostEntryAge = 0; notify(); }
    if (state.collisions > oldCollisions && (state.notice === 'height-collision' || state.notice === 'corridor-collision')) {
      trackVisual.hit(state.distance, state.routeId); notify();
    }
    // Quick pullback, then a smooth catch-up over 450 ms. Release cancels the impulse.
    const entry = !reducedMotion.matches && state.boostStage === 2 && boostEntryAge < 0.45
      ? boostEntryAge < 0.055 ? boostEntryAge / 0.055 : (1 - (boostEntryAge - 0.055) / 0.395) ** 2 : 0;
    const targetFov = reducedMotion.matches ? visuals.baseFov : Math.min(100, visuals.baseFov + Math.min(state.speed / visuals.referenceSpeed, 2) * visuals.cruiseFovGain + (state.boosting ? visuals.boostFovGain : 0) + (state.boostStage === 2 ? visuals.boostStage2FovGain : 0) + entry * visuals.boostEntryFovGain);
    const fov = replaying || (cinematic?.kind === 'intro' && !cinematic.reduced && cinematic.t >= INTRO_SECONDS) ? camera.fov : THREE.MathUtils.lerp(camera.fov, targetFov, 1 - Math.exp(-sceneDelta * (entry > 0 ? Math.max(18, visuals.fovResponse) : visuals.fovResponse)));
    if (Math.abs(camera.fov - fov) > 0.001) { camera.fov = fov; camera.updateProjectionMatrix(); }
    const cameraScale = Math.tan(THREE.MathUtils.degToRad(visuals.baseFov / 2)) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    track.sample(state.distance, frame, state.routeId);
    drone.position.copy(frame.position).addScaledVector(frame.right, state.offset).addScaledVector(frame.up, state.altitude);
    flightForward.copy(frame.tangent).multiplyScalar(Math.cos(state.heading)).addScaledVector(frame.right, Math.sin(state.heading));
    flightRight.copy(frame.right).multiplyScalar(Math.cos(state.heading)).addScaledVector(frame.tangent, -Math.sin(state.heading));
    flightUp.copy(frame.up);
    const targetBank = phase === 'running' && !awake ? -input.steer * 0.32 * Math.min(state.speed / 25, 1) : 0;
    bank = THREE.MathUtils.lerp(bank, reducedMotion.matches ? 0 : targetBank, 1 - Math.exp(-sceneDelta * 8));
    drone.quaternion.setFromRotationMatrix(poseBasis.makeBasis(flightRight, flightUp, backward.copy(flightForward).negate()));
    const shakeTarget = phase === 'running' && state.boosting && !reducedMotion.matches
      ? visuals.boostCraftShake * (state.boostStage === 2 ? 1.6 : 1) : 0;
    craftShake = THREE.MathUtils.lerp(craftShake, shakeTarget, 1 - Math.exp(-sceneDelta * 16));
    if (reducedMotion.matches) craftShake = 0;
    drone.rotateZ(bank + Math.sin(state.elapsed * 51) * craftShake);
    drone.rotateX(Math.sin(state.elapsed * 67 + 1) * craftShake * .5 + (reducedMotion.matches ? 0 : (state.targetAltitude - state.altitude) * -0.045));
    drone.rotateY(Math.sin(state.elapsed * 43) * craftShake * .35);
    if (!training && oldPhase === 'running') {
      replayClock += delta;
      replayBuffer.record(replayClock, drone.position.x, drone.position.y, drone.position.z, drone.quaternion.x, drone.quaternion.y, drone.quaternion.z, drone.quaternion.w,
        state.speed, awake || state.boostStage === 2 ? 3 : state.boosting ? 2 : input.throttle && state.speed > 1 ? 1 : 0, phase !== 'running');
    }
    if (replaying) {
      replayT += delta; replayShot(replayT, replayBuffer.seconds(), replayPick); replayBuffer.sample(replayPick.v, replayPose);
      drone.position.set(replayPose.x, replayPose.y, replayPose.z); drone.quaternion.set(replayPose.qx, replayPose.qy, replayPose.qz, replayPose.qw);
      flightForward.set(0, 0, -1).applyQuaternion(drone.quaternion); flightRight.set(1, 0, 0).applyQuaternion(drone.quaternion); flightUp.set(0, 1, 0).applyQuaternion(drone.quaternion);
    } else replayT = 0;
    desiredCameraOffset.copy(flightForward).multiplyScalar(-8.5).addScaledVector(flightUp, 3.5);
    const targetCameraAltitude = model.altitudeProfile.levels[0] + (state.altitude - model.altitudeProfile.levels[0]) * 0.62;
    cameraAltitude = cameraSnap ? targetCameraAltitude : THREE.MathUtils.lerp(cameraAltitude, targetCameraAltitude, 1 - Math.exp(-sceneDelta * (reducedMotion.matches ? 12 : 4)));
    if (cameraSnap) { cameraOffset.copy(desiredCameraOffset); cameraSnap = false; }
    else cameraOffset.lerp(desiredCameraOffset, 1 - Math.exp(-sceneDelta * 9));
    camera.position.copy(drone.position).addScaledVector(cameraOffset, cameraScale);
    camera.position.addScaledVector(flightUp, cameraAltitude - state.altitude);
    camera.position.addScaledVector(flightForward, -entry * visuals.boostEntryPullback);
    if (!reducedMotion.matches && state.boostStage === 2 && boostEntryAge < 0.22) {
      const shake = visuals.boostEntryShake * (1 - boostEntryAge / 0.22) ** 2;
      camera.position.addScaledVector(flightRight, Math.sin(boostEntryAge * 110) * shake)
        .addScaledVector(flightUp, Math.sin(boostEntryAge * 87 + 1) * shake);
    }
    lookAt.copy(drone.position).addScaledVector(flightForward, 9).addScaledVector(flightUp, cameraAltitude - state.altitude - 0.5); camera.up.copy(flightUp); camera.lookAt(lookAt);
    const introActive = cinematic?.kind === 'intro' && !cinematic.reduced && cinematic.t < INTRO_SECONDS;
    if (introActive) {
      const s = introProgress(cinematic!.t, INTRO_SECONDS);
      if (introAspect !== camera.aspect) {
        introAspect = camera.aspect;
        const overview = overviewPose(track, camera.aspect, camera.fov), landmark = scenery?.landmark;
        introPos.points[0].copy(overview.position); introLook.points[0].copy(overview.center);
        if (landmark) {
          const away = introTarget.copy(track.sample(0).position).sub(landmark.position).setY(0).normalize();
          introPos.points[1].copy(landmark.position).addScaledVector(away, landmark.radius * 1.4 + 50).setY(landmark.position.y + landmark.height * .55);
          introLook.points[1].copy(landmark.position).setY(landmark.position.y + landmark.height * .5);
        } else {
          const mid = track.sample(track.length * .5);
          introPos.points[1].copy(mid.position).addScaledVector(mid.up, 70).addScaledVector(mid.right, 90); introLook.points[1].copy(mid.position);
        }
      }
      introPos.points[2].copy(camera.position); introLook.points[2].copy(lookAt);
      introPos.getPoint(s, camera.position); introLook.getPoint(s, introTarget);
      camera.up.lerpVectors(worldUp, flightUp, s).normalize(); camera.lookAt(introTarget);
      if (scene.fog instanceof THREE.FogExp2) scene.fog.density = environment.fogDensity * (.12 + .88 * introProgress(s - .35, .55));
    } else if (scene.fog instanceof THREE.FogExp2) scene.fog.density = environment.fogDensity * (replaying ? .4 : 1);
    const far = introActive ? 9000 : 3200;
    if (camera.far !== far) { camera.far = far; camera.updateProjectionMatrix(); }
    const showcase = introActive || cinematic?.kind !== 'intro' || cinematic.reduced || cinematic.t < INTRO_SECONDS ? null : showcaseAt(cinematic.plan, cinematic.t - INTRO_SECONDS, shotAt);
    if (showcase) {
      const info = cinematic!.infos[showcase.shot], rival = info.kind === 'rival' ? rivalVisuals.entries[cinematic!.plan.shots[showcase.shot].index]?.object : undefined, u = showcase.u;
      if (rival) {
        shotF.set(0, 0, -1).applyQuaternion(rival.quaternion); shotR.set(1, 0, 0).applyQuaternion(rival.quaternion); shotU.set(0, 1, 0).applyQuaternion(rival.quaternion);
        const side = shotLook.copy(rival.position).sub(drone.position).dot(flightRight) < 0 ? -1 : 1, a = side * (1.1 - u * .1), radius = 7.5 - u * 1.2;
        shotPos.copy(rival.position).addScaledVector(shotF, Math.cos(a) * radius).addScaledVector(shotR, Math.sin(a) * radius).addScaledVector(shotU, .7);
        shotLook.copy(rival.position).addScaledVector(shotU, .2);
      } else {
        const a = .35 + u * .26, radius = 7 - u * .6;
        shotPos.copy(drone.position).addScaledVector(flightForward, Math.cos(a) * radius).addScaledVector(flightRight, Math.sin(a) * radius).addScaledVector(flightUp, .3);
        shotLook.copy(drone.position).addScaledVector(flightUp, .1);
      }
      camera.position.lerpVectors(shotPos, camera.position, showcase.blend); shotLook.lerp(lookAt, showcase.blend);
      camera.up.copy(flightUp); camera.lookAt(shotLook);
      const lens = THREE.MathUtils.lerp(fitFov(SHOWCASE_FOV), targetFov, showcase.blend);
      if (Math.abs(camera.fov - lens) > .01) { camera.fov = lens; camera.updateProjectionMatrix(); }
    }
    if (replaying) {
      const shot = replayPick.shot, p = drone.position;
      if (shot === 0) {
        replayBuffer.sample(.65, replayAnchor); replayQuat.set(replayAnchor.qx, replayAnchor.qy, replayAnchor.qz, replayAnchor.qw);
        shotR.set(1, 0, 0).applyQuaternion(replayQuat); shotU.set(0, 1, 0).applyQuaternion(replayQuat);
        camera.position.set(replayAnchor.x, replayAnchor.y, replayAnchor.z).addScaledVector(shotR, 6).addScaledVector(shotU, 1.2);
        camera.up.copy(shotU);
      } else if (shot === 1) {
        camera.position.copy(p).addScaledVector(flightForward, -8).addScaledVector(flightUp, 1.6); camera.up.copy(flightUp).lerp(worldUp, .6).normalize();
      } else {
        const a = 2.4 + replayPick.u * .9;
        camera.position.copy(p).addScaledVector(flightUp, 8.5).addScaledVector(flightForward, Math.cos(a) * 6).addScaledVector(flightRight, Math.sin(a) * 6); camera.up.copy(flightUp);
      }
      // Craft sits a little above centre so the hero text above and the cards below stay clear.
      lookAt.copy(p).addScaledVector(camera.up, -camera.position.distanceTo(p) * .05); if (shot === 1) lookAt.addScaledVector(flightForward, 2);
      camera.lookAt(lookAt);
      const lens = fitFov(replayShotFov[shot]);
      if (camera.fov !== lens) { camera.fov = lens; camera.updateProjectionMatrix(); }
    } else if (phase === 'finished' && !reducedMotion.matches) {
      const swing = finishSwing(cinematic?.kind === 'finish' ? cinematic.t : SWING_SECONDS, false);
      camera.position.copy(drone.position).addScaledVector(flightForward, Math.cos(swing.azimuth) * swing.radius)
        .addScaledVector(flightRight, Math.sin(swing.azimuth) * swing.radius).addScaledVector(flightUp, swing.height);
      lookAt.copy(drone.position).addScaledVector(flightUp, .4); camera.up.copy(flightUp); camera.lookAt(lookAt);
    }
    bloom.strength = replaying ? .3 : .65;
    views.update(flightForward, flightUp, bank, state.elapsed, state.boosting, reducedMotion.matches, state.routeId);
    thrusters.setMode(replaying ? REPLAY_MODES[replayPose.mode] : awake || state.boostStage === 2 ? 'boost-stage2' : phase === 'running' && state.boosting ? 'boost' : phase === 'running' && input.throttle && state.speed > 1 ? 'accelerate' : 'idle');
    thrusters.setBoostCharge(replaying ? replayPose.mode / 3 : awake ? 1 : state.boostStageProgress);
    thrusters.update(replaying ? delta : simulationDelta, reducedMotion.matches);
    boostPulse.update(simulationDelta, reducedMotion.matches);
    boostWarp.update(simulationDelta, awake || state.boostStage === 2, entry, reducedMotion.matches);
    awakeningStrength = THREE.MathUtils.lerp(awakeningStrength, awake ? 1 : 0, 1 - Math.exp(-delta * 12));
    if (awakeningStrength < .001) awakeningStrength = 0;
    overdrive.setStrength(awakeningStrength); overdrive.update(simulationDelta, reducedMotion.matches);
    coreVisual.update(state.elapsed, reducedMotion.matches);
    const hapticActive = phase === 'running' && !tutorialFrozen() && coarsePointer.matches && !reducedMotion.matches;
    boostHaptics.update(simulationDelta, state.boostStage, hapticActive);
    if (hapticActive) { if (state.collisions > hapticCollisions) boostHaptics.collision(); if (state.nearMisses > hapticNearMisses) boostHaptics.nearMiss(); }
    hapticCollisions = state.collisions; hapticNearMisses = state.nearMisses;
    if (heightChanged && coarsePointer.matches && !reducedMotion.matches) boostHaptics.altitudeStep();
    hudElapsed += delta;
    if (hudElapsed >= 0.08) { hudElapsed = 0; notify(); }
    trackVisual.update(track.obstacleTime ?? state.elapsed, reducedMotion.matches, state.distance, state.altitude, state.speed, state.offset, state.routeId);
    raceGates.update(timeAttack.snapshot().nextCheckpoint);
    if (replaying) speedLines.update(replayClock + replayT, replayPose.speed, replayPick.shot === 1 && replayPose.mode >= 2, reducedMotion.matches, replayPose.mode === 3);
    else speedLines.update(state.elapsed, state.speed, awake || state.boosting, reducedMotion.matches, awake || state.boostStage === 2);
    views.prepareDriving();
    scenery?.setOverview(false); scenery?.update(drone.position, reducedMotion.matches ? 0 : performance.now() / 1000); sky.update(camera.position);
    const weatherFrame = weather.update(camera.position, state.distance, (guidance.tutorial ? worldDelta : delta) * slow, phase === 'running' && !tutorialFrozen(), reducedMotion.matches);
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
  const applyQuality = (quality: RenderQuality) => { scenery?.setQuality(quality); weather.setQuality(quality); renderQuality = quality; resize(); };
  const unsubscribeQuality = autoQuality.onChange(status => applyQuality(status.quality));
  notify(); animation = requestAnimationFrame(tick);
  return {
    start, togglePause, restart, continueTutorial, skipTutorial() { guidance.tutorial?.skip(); notify(); }, skipAllTutorial() { guidance.tutorial?.skipAll(); notify(); }, skipCinematic: endCinematic, useAwakening, useFocus() { if (guidance.tutorial?.snapshot()) return false; const used = timeAttack.useFocus(); if (used) notify(); return used; }, useRivalItem(item) { if (guidance.tutorial?.snapshot()) return false; const used = timeAttack.useRivalItem(item); if (used) notify(); return used; }, recover, toggleCockpit, cycleTrack,
    setBloom(enabled) { bloom.enabled = enabled; },
    setQuality(preference) { autoQuality.setPreference(preference); },
    onQualityChange(listener) { return autoQuality.onChange(listener); },
    setExhaustHaze(enabled) { exhaustHaze.setEnabled(enabled); },
    setSoundEnabled(enabled) { raceAudio.setEnabled(enabled); },
    setMusicEnabled(enabled) { raceAudio.setMusicEnabled(enabled); },
    setHapticsEnabled(enabled) { boostHaptics.setEnabled(enabled); },
    dispose() {
      disposed = true; unsubscribeQuality(); cancelAnimationFrame(animation); events.abort(); observer.disconnect();
      touchControls.dispose(); rivalVisuals.dispose(); thrusters.dispose(); overdrive.dispose(); coreVisual.dispose(); boostPulse.dispose(); raceAudio.dispose(); boostHaptics.dispose();
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
