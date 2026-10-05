export type NightEnvironmentId = 'midnight' | 'deep-night' | 'predawn' | 'afterglow';
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
];

/** Select once when entering a race screen. The same value is reused on every restart. */
export function selectRaceEnvironment(district?: string, random: () => number = Math.random): NightEnvironment {
  if (!district) return NIGHT_ENVIRONMENTS[0];
  const value = random();
  const index = Number.isFinite(value) ? Math.min(3, Math.max(0, Math.floor(value * 4))) : 0;
  return NIGHT_ENVIRONMENTS[index];
}
