import type { RacePhase } from './createTimeAttack.js';

export type RaceCue = 'countdown' | 'start' | 'half-lap' | 'lap' | 'final-lap' | 'finish';
export interface RaceAnnouncement {
  id: number;
  kind: 'half-lap' | 'lap' | 'final-lap';
  title: string;
  detail: string;
  startedAt: number;
  duration: number;
}
interface Progress {
  phase: RacePhase;
  elapsed: number;
  countdown: number;
  completedLaps: number;
  gatesPassed: number;
  gatesPerLap: number;
  totalLaps: number;
}

/** Checkpoint progress, not position: recovery and pause cannot replay lap cues. */
export function createRaceFeedback() {
  let passed = 0;
  let previousPhase: RacePhase = 'ready';
  let countdown = 0;
  let sequence = 0;
  let announcement: RaceAnnouncement | null = null;
  let expires = 0;
  const reset = () => {
    passed = 0; previousPhase = 'ready'; countdown = 0;
    announcement = null; expires = 0;
  };
  return {
    reset,
    get announcement() { return announcement; },
    update(progress: Progress): RaceCue[] {
      const cues: RaceCue[] = [];
      if (progress.phase === 'countdown' && progress.countdown !== countdown) {
        countdown = progress.countdown;
        cues.push('countdown');
      }
      if (progress.phase === 'running' && previousPhase === 'countdown') cues.push('start');
      if (progress.phase === 'finished' && previousPhase !== 'finished') cues.push('finish');
      previousPhase = progress.phase;
      const nowPassed = progress.completedLaps * progress.gatesPerLap + progress.gatesPassed;
      for (let lap = 1; lap <= progress.totalLaps; lap++) {
        const half = (lap - 1) * progress.gatesPerLap + Math.ceil(progress.gatesPerLap / 2);
        if (passed < half && nowPassed >= half && half < lap * progress.gatesPerLap) {
          cues.push('half-lap');
          announcement = { id: ++sequence, kind: 'half-lap', title: `LAP ${lap} · 50%`, detail: lap === progress.totalLaps ? '마지막 반 랩, 끝까지!' : '반 랩 통과', startedAt: progress.elapsed, duration: 2.4 };
          expires = progress.elapsed + 2.4;
        }
        const end = lap * progress.gatesPerLap;
        if (passed < end && nowPassed >= end && lap < progress.totalLaps) {
          const final = lap + 1 === progress.totalLaps;
          cues.push(final ? 'final-lap' : 'lap');
          announcement = { id: ++sequence, kind: final ? 'final-lap' : 'lap', title: final ? 'FINAL LAP' : `LAP ${lap} COMPLETE`, detail: final ? `${lap}랩 완료 · 마지막 랩 시작!` : `${lap + 1} / ${progress.totalLaps} 랩 시작`, startedAt: progress.elapsed, duration: final ? 3.4 : 2.8 };
          expires = progress.elapsed + (final ? 3.4 : 2.8);
        }
      }
      passed = Math.max(passed, nowPassed);
      if (progress.elapsed >= expires || progress.phase === 'finished') announcement = null;
      return cues;
    },
  };
}
