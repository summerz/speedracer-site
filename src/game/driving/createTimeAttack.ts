import { createDrivingModel } from './createDrivingModel.js';
import type { DrivingInput } from './createDrivingModel.js';
import type { DronePerformance } from '../drone/droneConfiguration.js';
import type { Track } from '../track/createTrack.js';
import { createRaceProgress, RACE_LAPS } from './raceProgress.js';
import { createRaceRecords } from './raceRecords.js';
import type { RecordResult } from './raceRecords.js';

export type RacePhase = 'ready' | 'countdown' | 'running' | 'paused' | 'finished';

/** Owns race timing and transitions; the renderer only steps and displays it. */
export function createTimeAttack(track: Track, performance: DronePerformance, records: ReturnType<typeof createRaceRecords>) {
  const model = createDrivingModel(track, performance);
  const progress = createRaceProgress(track.length, Math.ceil(track.length / track.checkpointSpacing));
  let phase: RacePhase = 'ready';
  let resumePhase: 'countdown' | 'running' = 'running';
  let countdownRemaining = 3;
  let result: RecordResult | null = null;
  const reset = () => { model.reset(); progress.reset(); countdownRemaining = 3; result = null; };
  const start = () => {
    if (phase === 'paused') phase = resumePhase;
    else if (phase === 'ready' || phase === 'finished') { reset(); phase = 'countdown'; }
  };
  return {
    model,
    get phase() { return phase; },
    snapshot() {
      const p = progress.snapshot();
      return { ...p, phase, totalLaps: RACE_LAPS, countdown: Math.max(1, Math.ceil(countdownRemaining - 1e-8)),
        lapElapsed: model.state.elapsed - p.lapTimes.reduce((sum, time) => sum + time, 0),
        offTrackExits: model.state.offTrackExits, penaltyPoints: model.state.penaltyPoints,
        bestRecord: records.read(), result };
    },
    start,
    restart() { reset(); phase = 'countdown'; },
    pause() {
      if (phase === 'running' || phase === 'countdown') { resumePhase = phase; phase = 'paused'; model.interruptBoost(); }
    },
    recover() { if (phase === 'running' || phase === 'paused' && resumePhase === 'running') model.recover(); },
    step(delta: number, input: DrivingInput) {
      let remaining = Math.max(0, Math.min(Number.isFinite(delta) ? delta : 0, 0.1));
      if (phase === 'countdown') {
        const used = Math.min(remaining, countdownRemaining);
        countdownRemaining -= used; remaining -= used;
        if (countdownRemaining <= 1e-8) { countdownRemaining = 0; phase = 'running'; }
      }
      if (phase !== 'running' || remaining === 0) return;
      model.step(remaining, input, segment => {
        const finish = progress.cross(segment);
        model.state.checkpoint = progress.checkpoint;
        if (finish === null) return false;
        // Interpolate the final gate within the physics step; no extra frame is charged.
        model.state.distance = track.length * RACE_LAPS;
        model.state.elapsed = finish;
        model.state.speed = 0; model.interruptBoost(); phase = 'finished';
        const laps = progress.snapshot().lapTimes;
        result = records.save(finish, laps);
        return true;
      });
    },
  };
}
