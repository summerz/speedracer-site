import { TRACK_CATALOG, type DistrictId, type TrackDefinition } from './trackCatalog.js';

export type CityId = 'neon' | 'marine';
export interface CityDefinition {
  readonly id: CityId;
  readonly name: string;
  readonly order: number;
  readonly districts: readonly DistrictId[];
}
export const CITY_CATALOG: readonly CityDefinition[] = Object.freeze([
  Object.freeze({ id: 'neon', name: '네온시티', order: 1, districts: Object.freeze(['residential', 'industrial', 'stadium', 'skyline', 'research', 'orbital', 'harbor', 'desert'] as const) }),
  Object.freeze({ id: 'marine', name: '마린시티', order: 2, districts: Object.freeze(['abyss', 'kelp', 'coral', 'lagoon'] as const) }),
]);
export const DISTRICT_CITY: Readonly<Record<DistrictId, CityId>> = Object.freeze({
  residential: 'neon', industrial: 'neon', stadium: 'neon', skyline: 'neon', research: 'neon', orbital: 'neon', harbor: 'neon', desert: 'neon',
  abyss: 'marine', kelp: 'marine', coral: 'marine', lagoon: 'marine',
});
export function cityForDistrict(district: DistrictId): CityId { return DISTRICT_CITY[district]; }
export function cityDefinition(city: CityId): CityDefinition { return CITY_CATALOG.find(value => value.id === city)!; }
const tracksByCity = Object.freeze(Object.fromEntries(CITY_CATALOG.map(city => [city.id, Object.freeze(TRACK_CATALOG.filter(track => cityForDistrict(track.district) === city.id))])) as Record<CityId, readonly TrackDefinition[]>);
export function campaignTracksForCity(city: CityId): readonly TrackDefinition[] { return tracksByCity[city]; }
/** Keep the gate tied to Neon City, even when later cities append more courses. */
export const MARINE_GATE_TRACK_ID: string = campaignTracksForCity('neon').at(-1)!.id;
