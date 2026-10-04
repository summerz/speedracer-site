export interface DronePerformance {
  topSpeed: number;
  boostSpeed: number;
  boostStage2Speed: number;
  /** Fraction of a full battery's continuous boost duration required for stage 2. */
  boostStage2Threshold: number;
  acceleration: number;
  braking: number;
  /** Fraction of speed lost on a wall impact. Electric fields scale this by severity. */
  collisionSpeedLoss: number;
  /** Minimum forward speed while holding the brake (m/s). */
  crawlSpeed: number;
  boostAcceleration: number;
  boostStage2Acceleration: number;
  maxYawRate: number;
  /** Steering becomes progressively wider above this speed (m/s). */
  corneringReferenceSpeed: number;
  highSpeedSteeringLoss: number;
  boostDrain: number;
  boostRecovery: number;
}

export interface SpeedEffects {
  baseFov: number;
  referenceSpeed: number;
  cruiseFovGain: number;
  boostFovGain: number;
  boostStage2FovGain: number;
  boostEntryShake: number;
  /** Craft rotation amplitude in radians; separate from camera shake. */
  boostCraftShake: number;
  boostEntryPullback: number;
  boostEntryFovGain: number;
  boostWarpStrength: number;
  fovResponse: number;
  streakStartSpeed: number;
  streakOpacity: number;
  boostStreakOpacity: number;
  boostStage2StreakOpacity: number;
  streakWidth: number;
  boostStreakWidth: number;
  boostStage2StreakWidth: number;
}

export interface DroneConfiguration {
  id: string;
  modelVariant: string;
  performance: DronePerformance;
  speedEffects: SpeedEffects;
  boostStyle: { pulseColor: string; core: string; body: string; tail: string; afterglow: string };
}

export interface DroneModifier {
  /** Multipliers stack: 1.1 means +10%; 0.9 boostDrain means 10% less charge used. */
  performanceMultiplier?: Partial<DronePerformance>;
  /** Visual choices override in equipment order, independently from performance. */
  speedEffects?: Partial<SpeedEffects>;
  boostStyle?: Partial<DroneConfiguration['boostStyle']>;
}

export const DEFAULT_DRONE_CONFIGURATION: DroneConfiguration = {
  id: 'dr-01',
  modelVariant: 'vanguard',
  performance: {
    topSpeed: 85, boostSpeed: 125, boostStage2Speed: 155, boostStage2Threshold: 0.6, acceleration: 46, braking: 70, collisionSpeedLoss: 0.38, crawlSpeed: 12,
    boostAcceleration: 68, boostStage2Acceleration: 90, maxYawRate: 2.2, corneringReferenceSpeed: 60, highSpeedSteeringLoss: 0.2, boostDrain: 0.20, boostRecovery: 0.16,
  },
  speedEffects: {
    baseFov: 65, referenceSpeed: 85, cruiseFovGain: 5, boostFovGain: 8,
    boostStage2FovGain: 12, boostEntryShake: 0.055, boostCraftShake: 0.045,
    boostEntryPullback: 2.4, boostEntryFovGain: 10, boostWarpStrength: 0.7,
    fovResponse: 6, streakStartSpeed: 30, streakOpacity: 0.26, boostStreakOpacity: 0.62,
    boostStage2StreakOpacity: 0.86, streakWidth: 2.2, boostStreakWidth: 4.6, boostStage2StreakWidth: 6.6,
  },
  boostStyle: { pulseColor: '#b9ecff', core: '#fff1ce', body: '#ff9e35', tail: '#ed4216', afterglow: '#ff8e2c' },
};

/** Resolve equipped parts once before a race; base craft and equipment remain reusable. */
export function resolveDroneConfiguration(base: DroneConfiguration, modifiers: readonly DroneModifier[] = []): DroneConfiguration {
  const performance = { ...base.performance };
  const speedEffects = { ...base.speedEffects };
  const boostStyle = { ...base.boostStyle };
  for (const modifier of modifiers) {
    for (const key of Object.keys(modifier.performanceMultiplier ?? {}) as (keyof DronePerformance)[]) {
      const multiplier = modifier.performanceMultiplier![key]!;
      if (!Number.isFinite(multiplier) || multiplier <= 0) throw new RangeError(`Invalid performance multiplier: ${key}`);
      performance[key] *= multiplier;
    }
    Object.assign(speedEffects, modifier.speedEffects);
    Object.assign(boostStyle, modifier.boostStyle);
  }
  for (const [key, value] of Object.entries(performance)) {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError(`Invalid drone performance: ${key}`);
  }
  // A top-speed upgrade must never make boost slower than normal flight.
  performance.boostSpeed = Math.max(performance.topSpeed, performance.boostSpeed);
  performance.boostStage2Speed = Math.max(performance.boostSpeed, performance.boostStage2Speed);
  if (performance.boostStage2Threshold >= 1) throw new RangeError('Stage 2 threshold must be between 0 and 1');
  if (performance.collisionSpeedLoss >= 1) throw new RangeError('Collision speed loss must be between 0 and 1');
  for (const color of Object.values(boostStyle)) {
    if (!/^#[0-9a-f]{6}$/i.test(color)) throw new RangeError('Boost colors must use six-digit hex');
  }
  for (const [key, value] of Object.entries(speedEffects)) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError(`Invalid speed effect: ${key}`);
  }
  if (speedEffects.referenceSpeed === 0 || speedEffects.fovResponse === 0 || speedEffects.baseFov < 30 || speedEffects.baseFov > 100) {
    throw new RangeError('Invalid speed effect reference, response or field of view');
  }
  if (speedEffects.boostWarpStrength > 1) throw new RangeError('Boost warp strength must be between 0 and 1');
  return { id: base.id, modelVariant: base.modelVariant, performance, speedEffects, boostStyle };
}
