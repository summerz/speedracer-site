export type NightEnvironmentId = 'midnight' | 'deep-night' | 'predawn' | 'afterglow' | 'storm-night';
export type RainIntensity = 'light' | 'moderate' | 'heavy';
export const RAIN_INTENSITIES: Record<RainIntensity, { label: string; density: number; volume: number }> = {
  light: { label: '약한 비', density: .45, volume: .045 },
  moderate: { label: '보통 비', density: .7, volume: .075 },
  heavy: { label: '강한 비', density: 1, volume: .11 },
};
export function selectRainIntensity(random: () => number = Math.random): RainIntensity {
  const value = random();
  const index = Number.isFinite(value) ? Math.min(2, Math.max(0, Math.floor(value * 3))) : 0;
  return (['light', 'moderate', 'heavy'] as const)[index];
}
export interface NightEnvironment {
  id: NightEnvironmentId;
  label: string;
  zenith: string;
  horizon: string;
  fog: string;
  fogDensity: number;
  ambient: string;
  ambientIntensity: number;
  light: string;
  lightIntensity: number;
  celestial: 'moon' | 'ringed-planet' | 'crescent' | 'satellite';
  celestialColor: string;
  stars: number;
  rain?: boolean;
  rainIntensity?: RainIntensity;
  /** Apparent angular radius and center elevation in radians, independent of camera distance. */
  celestialRadius: number;
  celestialElevation: number;
}
export const NIGHT_ENVIRONMENTS: readonly NightEnvironment[] = [
  { id: 'midnight', label: '한밤중', zenith: '#020719', horizon: '#182640', fog: '#091325', fogDensity: .00115,
    ambient: '#8baacb', ambientIntensity: 2.5, light: '#bcd8ff', lightIntensity: 3, celestial: 'moon', celestialColor: '#9fc6e7', stars: 1, celestialRadius: .53, celestialElevation: .12 },
  { id: 'deep-night', label: '깊은 밤', zenith: '#09041c', horizon: '#36204c', fog: '#150d28', fogDensity: .00125,
    ambient: '#a19ad0', ambientIntensity: 2.6, light: '#d1bbff', lightIntensity: 3, celestial: 'ringed-planet', celestialColor: '#af8be5', stars: 1, celestialRadius: .60, celestialElevation: .18 },
  { id: 'predawn', label: '동트기 직전', zenith: '#0c1735', horizon: '#805d87', fog: '#283047', fogDensity: .001,
    ambient: '#b8b3da', ambientIntensity: 3.2, light: '#d1d7ff', lightIntensity: 3.1, celestial: 'crescent', celestialColor: '#c4d9e9', stars: .35, celestialRadius: .58, celestialElevation: .16 },
  { id: 'afterglow', label: '해가 진 직후', zenith: '#18102d', horizon: '#864536', fog: '#362136', fogDensity: .0011,
    ambient: '#c1a2b6', ambientIntensity: 3.1, light: '#ffd4ae', lightIntensity: 3.2, celestial: 'satellite', celestialColor: '#df9e80', stars: .2, celestialRadius: .68, celestialElevation: .10 },
  { id: 'storm-night', label: '폭풍우의 밤', zenith: '#02050c', horizon: '#131d30', fog: '#0a1422', fogDensity: .0015,
    ambient: '#7990ae', ambientIntensity: 1.8, light: '#9cb9d9', lightIntensity: 2, celestial: 'moon', celestialColor: '#8798b3', stars: .05, celestialRadius: .53, celestialElevation: .12, rain: true },
];

/** Select once when entering a race screen. The same value is reused on every restart. */
export function selectRaceEnvironment(district?: string, random: () => number = Math.random): NightEnvironment {
  if (!district) return NIGHT_ENVIRONMENTS[0];
  const value = random();
  const index = Number.isFinite(value) ? Math.min(NIGHT_ENVIRONMENTS.length - 1, Math.max(0, Math.floor(value * NIGHT_ENVIRONMENTS.length))) : 0;
  return NIGHT_ENVIRONMENTS[index];
}
