import { ABYSS_ENVIRONMENTS } from './abyssEnvironment.js';
import type { UnderwaterEnvironment } from './raceEnvironment.js';

/** Scenery colors for one Marine City zone: one water hue and one glow/accent pair, never more. */
export interface MarinePalette {
  glow: string;      // domes, ribs, tunnels, buoys, shafts
  accent: string;    // coral tips, a share of beacons and dome lights
  rock: string;
  kelp: [dark: string, light: string, glow: string];
  sand: string;      // seabed base
  caustic: string;   // seabed light pattern and surface shimmer
  snow: string;      // marine snow
  whale: string;
}

export type MarineZoneId = 'trench' | 'kelp' | 'coral' | 'lagoon';
export interface MarineZone { id: MarineZoneId; name: string; palette: MarinePalette; environments: readonly UnderwaterEnvironment[] }

const base = { underwater: true, celestial: 'none', celestialColor: '#ffffff', stars: 0, rain: false, celestialRadius: .1, celestialElevation: .9 } as const;

/** Marine City rises from the trench toward the sunlit surface: each zone gets brighter and warmer. */
export const MARINE_ZONES: readonly MarineZone[] = [
  { id: 'trench', name: '심해 해구', environments: ABYSS_ENVIRONMENTS, palette: {
    glow: '#5ff5e6', accent: '#ff7aa8', rock: '#0f2a30', kelp: ['#010b0f', '#062a2b', '#1accaa'],
    sand: '#1a2a2b', caustic: '#33e6d9', snow: '#bfeff0', whale: '#020b0f' } },
  { id: 'kelp', name: '켈프 숲', palette: {
    glow: '#c6ff6e', accent: '#ffb347', rock: '#1f2a17', kelp: ['#0b1606', '#34470f', '#8fb02a'],
    sand: '#2b2a17', caustic: '#e8f08a', snow: '#e6f2c4', whale: '#0a1206' },
    environments: [{ ...base, id: 'kelp-forest', label: '켈프 숲', zenith: '#5d8a4a', horizon: '#24452e', fog: '#142a1c', fogDensity: .002,
      ambient: '#c4dca0', ambientIntensity: 2.5, light: '#f6e7a2', lightIntensity: 2.4 }] },
  { id: 'coral', name: '산호 정원', palette: {
    glow: '#ff9466', accent: '#ffd36b', rock: '#2a1b2a', kelp: ['#0b0a1c', '#3a1e46', '#e0604f'],
    sand: '#2c2534', caustic: '#9fc2ff', snow: '#dfe6ff', whale: '#070a1c' },
    environments: [{ ...base, id: 'coral-garden', label: '산호 정원', zenith: '#4a7fd0', horizon: '#1d3f80', fog: '#10224a', fogDensity: .0018,
      ambient: '#a9bcff', ambientIntensity: 2.7, light: '#ffd9b4', lightIntensity: 2.4 }] },
  { id: 'lagoon', name: '햇빛 라군', palette: {
    glow: '#ffd27a', accent: '#ff6f61', rock: '#4a5a52', kelp: ['#0c3328', '#1f6e4f', '#5fd6a0'],
    sand: '#8f8466', caustic: '#fff6da', snow: '#f4fffb', whale: '#123c46' },
    environments: [{ ...base, id: 'sun-lagoon', label: '햇빛 라군', zenith: '#9ef0ea', horizon: '#3fb7c4', fog: '#2a95a6', fogDensity: .0016,
      ambient: '#e6fff8', ambientIntensity: 3, light: '#fff3d2', lightIntensity: 3.2 }] },
];

export function marineZone(id?: string | null): MarineZone {
  return MARINE_ZONES.find(zone => zone.id === id) ?? MARINE_ZONES[0];
}

/** The zone an underwater environment belongs to; unknown ids fall back to the trench. */
export function marinePaletteFor(environmentId: string): MarinePalette {
  return (MARINE_ZONES.find(zone => zone.environments.some(env => env.id === environmentId)) ?? MARINE_ZONES[0]).palette;
}
