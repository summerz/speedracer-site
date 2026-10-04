/** Heights are measured from the local road; Q/E selects an adjacent level. */
export interface AltitudeProfile {
  readonly levels: readonly number[];
  readonly initialLevel: number;
  readonly transitionSeconds: number;
}

export const ALTITUDE_PROFILES = {
  beginner: { levels: [1.8, 6.2], initialLevel: 0, transitionSeconds: 0.2 },
  intermediate: { levels: [1.8, 4, 6.2], initialLevel: 0, transitionSeconds: 0.2 },
  advanced: { levels: [1.8, 3.2, 4.7, 6.2], initialLevel: 0, transitionSeconds: 0.2 },
} as const satisfies Record<string, AltitudeProfile>;

export function resolveAltitudeProfile(profile: AltitudeProfile = ALTITUDE_PROFILES.beginner): AltitudeProfile {
  if (profile.levels.length < 2 || profile.levels.some((height, i) =>
    !Number.isFinite(height) || height <= 0 || (i > 0 && height <= profile.levels[i - 1]))) {
    throw new Error('Altitude levels must contain at least two positive, strictly increasing heights.');
  }
  if (!Number.isInteger(profile.initialLevel) || profile.initialLevel < 0 || profile.initialLevel >= profile.levels.length
    || !Number.isFinite(profile.transitionSeconds) || profile.transitionSeconds <= 0) {
    throw new Error('Altitude initial level and transition duration are invalid.');
  }
  return Object.freeze({ ...profile, levels: Object.freeze([...profile.levels]) });
}
