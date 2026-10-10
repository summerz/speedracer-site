import type { NightEnvironment } from './raceEnvironment.js';

/** Underwater presets for the ABYSS district. No stars, no weather; marine snow is a separate effect. */
export const ABYSS_ENVIRONMENTS: readonly NightEnvironment[] = [
  { id: 'abyss-shallow', label: '얕은 해역', underwater: true, zenith: '#1d6f80', horizon: '#0a3a48', fog: '#06222e', fogDensity: .0019,
    ambient: '#7fd8d8', ambientIntensity: 2.4, light: '#a8fff0', lightIntensity: 2.2, celestial: 'moon', celestialColor: '#5ff5e6', stars: 0, celestialRadius: .1, celestialElevation: .9 },
  { id: 'abyss-deep', label: '깊은 해역', underwater: true, zenith: '#0c3a48', horizon: '#06202a', fog: '#031219', fogDensity: .0024,
    ambient: '#4fb0bd', ambientIntensity: 2, light: '#7fe3e0', lightIntensity: 1.6, celestial: 'moon', celestialColor: '#5ff5e6', stars: 0, celestialRadius: .1, celestialElevation: .9 },
];
