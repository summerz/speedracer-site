import { ALTITUDE_PROFILES } from './altitudeProfile.js';
import type { AltitudeProfile } from './altitudeProfile.js';

export type DifficultyId = 'beginner' | 'intermediate' | 'advanced';
export interface TrackLayout {
  readonly halfWidth: number;
  readonly helixTurns: number;
  readonly helixPitch: number;
  readonly corners: 'gentle' | 'normal' | 'technical';
}
export interface DifficultyPreset {
  readonly id: DifficultyId;
  readonly label: string;
  readonly description: string;
  readonly altitude: AltitudeProfile;
  readonly layout: TrackLayout;
  /** Safe height indices in the order encountered. */
  readonly obstacleLevels: readonly number[];
}
export const DIFFICULTIES = {
  beginner: { id: 'beginner', label: '초급', description: '넓고 완만한 코너 · 스프링 1회전 · 고도 2단계', altitude: ALTITUDE_PROFILES.beginner,
    layout: { halfWidth: 14, helixTurns: 1, helixPitch: 300, corners: 'gentle' }, obstacleLevels: [1, 0, 1, 0, 1, 0] },
  intermediate: { id: 'intermediate', label: '중급', description: '연속 코너 · 스프링 2회전 · 고도 3단계', altitude: ALTITUDE_PROFILES.intermediate,
    layout: { halfWidth: 11, helixTurns: 2, helixPitch: 260, corners: 'normal' }, obstacleLevels: [2, 0, 1, 2, 1, 0, 1, 2] },
  advanced: { id: 'advanced', label: '고급', description: '연속 S 코너 · 스프링 3회전 · 고도 4단계', altitude: ALTITUDE_PROFILES.advanced,
    layout: { halfWidth: 9, helixTurns: 3, helixPitch: 220, corners: 'technical' }, obstacleLevels: [3, 0, 1, 2, 3, 1, 2, 0, 2, 1, 3, 0] },
} as const satisfies Record<DifficultyId, DifficultyPreset>;
