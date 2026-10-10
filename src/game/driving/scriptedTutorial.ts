import type { Track } from '../track/createTrack.js';
import { createTrackFrame } from '../track/createTrack.js';
import { DRIVING_TUNING } from './createDrivingModel.js';
import type { DrivingInput } from './createDrivingModel.js';
import type { createRaceSession } from './createRaceSession.js';
import type { createDrivingTutorial, TutorialFrame, TutorialTarget } from './drivingTutorial.js';
import { TUTORIAL_SPEED_SCALE } from './drivingTutorial.js';

export const TUTORIAL_HAZARD_DISTANCE = 240;
export const TUTORIAL_NEAR_MISS_DISTANCE = 400;
/** Keep the first course's geometry, replace its procedural gameplay with two teaching targets. */
export function createTutorialTrack(base: Track): Track {
  const altitude = base.altitudeProfile.levels[1];
  return { ...base, awakeningCoresEnabled: false,
    heightObstacles: [{ distance: TUTORIAL_HAZARD_DISTANCE, depth: 12, kind: 'rise',
      visual: 'discharge-arcs', speedRetention: .6, minAltitude: altitude - .9, maxAltitude: altitude + .9 }],
    corridorObstacles: [{ distance: TUTORIAL_NEAR_MISS_DISTANCE, depth: 12,
      safeCenter: 0, safeWidth: 8, lane: 'center', speedRetention: .6 }],
    branches: [], mineFields: [], arcRails: [], boostPads: [], boostRings: [],
    obstacleTime: 0, randomizeObstacles: undefined, rollObstacleLayout: undefined,
  };
}

export interface TutorialHeightRequest { lift: number; targetAltitudeLevel?: number }
export function createTutorialRuntime(track: Track, session: ReturnType<typeof createRaceSession>, tutorial: ReturnType<typeof createDrivingTutorial>) {
  const model = session.model;
  const hazard = track.heightObstacles[0], corridor = track.corridorObstacles![0];
  const approach = hazard.distance - hazard.depth / 2 - DRIVING_TUNING.craftHalfLength - 20;
  const nearOffset = corridor.safeCenter + corridor.safeWidth / 2 - DRIVING_TUNING.craftHalfWidth - .6;
  const target = (kind: TutorialTarget['kind'], distance: number, offset: number): TutorialTarget => {
    const frame = track.sample(distance, createTrackFrame());
    const altitude = model.altitudeProfile.levels[1];
    return { kind, distance, offset, altitude, altitudeLevel: 1, worldPosition: {
      x: frame.position.x + frame.right.x * offset + frame.up.x * altitude,
      y: frame.position.y + frame.right.y * offset + frame.up.y * altitude,
      z: frame.position.z + frame.right.z * offset + frame.up.z * altitude,
    } };
  };
  tutorial.setTargets({ hazard: target('hazard', hazard.distance, 0),
    'near-miss': target('near-miss', corridor.distance, corridor.safeCenter + corridor.safeWidth / 2) });
  let explainedNearMiss = false;
  const readFrame = (input: DrivingInput, altitudeChanged = false): TutorialFrame => ({
    phase: session.phase, speed: model.state.speed, steer: input.steer, brake: input.brake,
    distance: model.state.distance, altitudeLevel: model.state.altitudeLevel, altitudeChanged,
    boosting: model.state.boosting, obstaclesPassed: model.state.obstaclesPassed,
    collisions: model.state.collisions, nearMisses: model.state.nearMisses,
    atTarget: tutorial.snapshot()?.step === 'hazard' ? model.state.distance >= approach - 1e-8
      : model.state.distance >= corridor.distance - 1e-8,
  });
  return {
    step(delta: number, raw: DrivingInput, requests: readonly TutorialHeightRequest[] = []) {
      let input: DrivingInput = { ...raw, lift: 0, guidedSpeedScale: TUTORIAL_SPEED_SCALE };
      let altitudeChanged = false, simulationDelta = 0;
      let lesson = tutorial.snapshot();
      let heightRequests = requests;
      if (session.phase === 'running' && lesson?.phase === 'await') {
        heightRequests = [];
        const action = { steer: raw.steer, brake: raw.brake, boost: raw.boost };
        if (!requests.length) tutorial.acceptInput(action, readFrame(raw));
        for (const request of requests) {
          const requestedAltitudeLevel = Math.max(0, Math.min(model.altitudeProfile.levels.length - 1,
            request.targetAltitudeLevel ?? model.state.altitudeLevel + Math.sign(request.lift)));
          if (tutorial.acceptInput({ ...action, requestedAltitudeLevel }, readFrame(raw))) {
            heightRequests = [request]; break;
          }
        }
        lesson = tutorial.snapshot();
      }
      if (lesson?.step === 'near-miss' && lesson.phase === 'freeze') explainedNearMiss = true;
      if (session.phase === 'countdown' || session.phase === 'running' && lesson && !lesson.frozen) {
        const id = lesson?.step;
        const manualSteer = id === 'steer' && lesson?.phase === 'act';
        const manualBoost = id === 'boost' && lesson?.phase === 'act';
        const manualBrake = id === 'brake' && lesson?.phase === 'act';
        input = { throttle: !manualBrake || !raw.brake, brake: manualBrake && raw.brake,
          boost: manualBoost && raw.boost, steer: manualSteer ? raw.steer : 0, lift: 0,
          guidedSpeedScale: TUTORIAL_SPEED_SCALE,
          ...(!manualSteer ? { guidedOffset: id === 'near-miss' ? nearOffset : 0 } : {}),
          guidedStopDistance: id === 'hazard' ? lesson?.phase === 'demo' ? approach : undefined
            : id === 'near-miss' ? explainedNearMiss ? undefined : corridor.distance : approach - 35,
        };
        if (id === 'hazard' || id === 'near-miss') input.targetAltitudeLevel = id === 'hazard' && lesson?.phase === 'demo' ? 0 : 1;
        if (lesson?.phase === 'act' && (id === 'altitude' || id === 'boost' || id === 'hazard')) {
          for (const request of heightRequests) {
            const before = model.state.altitudeLevel;
            model.step(0, { ...input, ...request });
            altitudeChanged ||= model.state.altitudeLevel !== before;
          }
        }
        session.step(delta, input);
        simulationDelta = session.phase === 'running' ? delta : 0;
      }
      tutorial.update(delta, readFrame(input, altitudeChanged));
      // Capture the transition before the UI can immediately continue this frame.
      if (tutorial.snapshot()?.phase === 'freeze') explainedNearMiss = true;
      if (tutorial.status().outcome) session.finishPractice();
      return { input, altitudeChanged, simulationDelta };
    },
  };
}
