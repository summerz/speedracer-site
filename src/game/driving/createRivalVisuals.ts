import * as THREE from 'three';
import { createRacingDrone } from '../drone/createRacingDrone.js';
import { createThrusterEffect } from '../drone/createThrusterEffect.js';
import { createTrackFrame } from '../track/createTrack.js';
import type { Track } from '../track/createTrack.js';
import type { createRaceSession } from './createRaceSession.js';

/** Opponent silhouettes keep their catalog geometry with distinct AI neon liveries. */
export function createRivalVisuals(scene: THREE.Scene, track: Track, rivals: ReturnType<typeof createRaceSession>['rivals']) {
  const entries = rivals.map(rival => {
    const object = createRacingDrone({ variant: rival.configuration.modelVariant,
      neonColor: rival.color, accentColor: rival.color, neonBoost: 1.7, thrusterIntensity: .35 });
    object.name = `rival-${rival.id}`; scene.add(object);
    return { object, color: rival.color, thrusters: createThrusterEffect(object, scene, rival.configuration.boostStyle), rival };
  });
  const frame = createTrackFrame(), forward = new THREE.Vector3(), right = new THREE.Vector3(), back = new THREE.Vector3();
  const basis = new THREE.Matrix4(), bankAxis = new THREE.Vector3(0, 0, 1);
  return {
    entries,
    update(delta: number, reduced: boolean) {
      for (const entry of entries) {
        const state = entry.rival.controller.model.state;
        const finished = entry.rival.controller.phase === 'finished';
        // Keep the overview position, but clear the finish line for active racers.
        entry.object.visible = !finished;
        track.sample(state.distance, frame);
        entry.object.position.copy(frame.position).addScaledVector(frame.right, state.offset).addScaledVector(frame.up, state.altitude);
        forward.copy(frame.tangent).multiplyScalar(Math.cos(state.heading)).addScaledVector(frame.right, Math.sin(state.heading));
        right.copy(frame.right).multiplyScalar(Math.cos(state.heading)).addScaledVector(frame.tangent, -Math.sin(state.heading));
        basis.makeBasis(right, frame.up, back.copy(forward).negate());
        entry.object.quaternion.setFromRotationMatrix(basis);
        if (!reduced) entry.object.rotateOnAxis(bankAxis, -state.heading * .35);
        entry.thrusters.setMode(state.boostStage === 2 ? 'boost-stage2' : state.boosting ? 'boost' : state.speed > 1 ? 'accelerate' : 'idle');
        entry.thrusters.setBoostCharge(state.boostStageProgress);
        entry.thrusters.update(entry.rival.controller.phase === 'running' ? delta : 0, reduced || finished);
      }
    },
    dispose() { entries.forEach(entry => entry.thrusters.dispose()); },
  };
}
