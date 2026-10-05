import type { CourseLayout, CourseShape } from './trackAuthoring.js';

export type DistrictId = 'residential' | 'industrial' | 'stadium' | 'skyline' | 'research' | 'orbital';
export const DISTRICTS: Record<DistrictId, { name: string; color: string }> = {
  residential: { name: '네온 주거지', color: '#67dcd0' }, industrial: { name: '전력 산업구역', color: '#ffac52' },
  stadium: { name: '그랜드 아레나', color: '#e886bc' }, skyline: { name: '미드나이트 스카이라인', color: '#91aeff' },
  research: { name: '프리즘 연구도시', color: '#ba94ff' }, orbital: { name: '오비탈 프런티어', color: '#e4eebb' },
};
export interface TrackDefinition {
  readonly id: string; readonly name: string; readonly revision: number; readonly order: number;
  readonly district: DistrictId; readonly rating: number; readonly predecessor: string | null;
  readonly laps: number; readonly lapLimit: number; readonly halfWidth: number; readonly altitudeLevels: 2 | 3 | 4;
  readonly obstacleLevels: readonly number[]; readonly layout: CourseLayout | null; readonly features: string;
}
const stunt = (kind: 'loop' | 'helix' | 'roll', start: number, span: number, radius = 70, turns = 1): CourseLayout['stunts'][number] => ({ kind, start, span, radius, turns });
const footprint = (shape: CourseShape, radiusX: number, radiusZ: number, elevation: number, waves = 1, bank = 0, stunts: CourseLayout['stunts'] = [], rotation = 0): CourseLayout => ({ shape, radiusX, radiusZ, elevation, waves, bank, stunts, rotation });
// Every recipe owns its entire closed footprint. IDs remain stable when geometry gets a new revision.
const recipes: [string, DistrictId, number, string, CourseLayout | null][] = [
  ['WINDOW RUN', 'residential', 1, '원형 순환 · 루프 · 코일 · 완전 회전', footprint('ring', 510, 480, 36, 1, 0.1, [stunt('loop', .17, .085, 65), stunt('helix', .44, .16, 30), stunt('roll', .75, .15, 0)])],
  ['TERRACE FLOW', 'residential', 2, '콩 모양 상승 · 코일 · 루프 · 노면 회전', footprint('kidney', 584, 458, 103, 2, 0.25, [stunt('helix', .1, .17, 32, 2), stunt('loop', .46, .08, 70), stunt('roll', .73, .14, 0)])],
  ['BLOCK SPRINT', 'residential', 2, '엄지형 블록 · 코일 2곳 · 완전 회전 2곳', footprint('thumb', 450, 450, 38, 1, 0.25, [stunt('helix', .08, .15, 22), stunt('roll', .33, .12, 0), stunt('helix', .52, .16, 26, 2), stunt('roll', .8, .12, 0)], .4)],
  ['NEON CIRCUIT', 'residential', 3, '수직 루프 · 스프링 입문', null],
  ['GRIDWORKS', 'industrial', 2, '삼각 공장 · 루프 · 코일 · 노면 회전', footprint('triangle', 402, 341, 52, 3, 0.3, [stunt('loop', .12, .075, 54), stunt('helix', .38, .17, 24, 2), stunt('roll', .75, .12, 0)])],
  ['VOLTAGE YARD', 'industrial', 2, '고가 8자 교차 · 루프 · 코일 · 노면 회전', footprint('eight', 584, 387, 118, 1, 0.2, [stunt('roll', .06, .1, 0), stunt('loop', .23, .065, 75), stunt('helix', .59, .14, 32, 2), stunt('roll', .82, .1, 0)])],
  ['COIL FOUNDRY', 'industrial', 3, '원형 공장 외곽 · 3회전 코일', footprint('ring', 560, 482, 51, 2, 0.25, [stunt('helix', .18, .22, 39, 3)])],
  ['REACTOR TURN', 'industrial', 3, '말굽 U자 · 코일 · 안쪽 회전 구간', footprint('horseshoe', 464, 424, 55, 2, 0.35, [stunt('helix', .03, .14, 26, 2), stunt('roll', .37, .1, 0), stunt('roll', .78, .12, 0)])],
  ['ARENA RING', 'stadium', 2, '원형 아레나 · 뱅크 · 루프 · 코일', footprint('ring', 376, 376, 16, 2, 0.45, [stunt('loop', .12, .07, 55), stunt('helix', .43, .18, 25, 2), stunt('roll', .76, .1, 0)])],
  ['GRANDSTAND DIVE', 'stadium', 3, '클로버 · 관중석 급강하 · 루프 · 완전 회전', footprint('clover', 504, 439, 124, 3, 0.45, [stunt('loop', .13, .065, 62), stunt('roll', .46, .13, 0), stunt('helix', .76, .13, 30, 2)])],
  ['VICTORY LOOP', 'stadium', 3, '넓은 타원 · 대형 수직 루프', footprint('ring', 844, 497, 56, 1, 0.3, [stunt('loop', .2, .07, 117)])],
  ['CROSSOVER', 'stadium', 4, '입체 8자 · 상하 교차 · 노면 회전', footprint('eight', 456, 339, 117, 1, 0.45, [stunt('roll', .27, .12, 0)])],
  ['SKYLINE ASCENT', 'skyline', 2, '세 꼭짓점 스카이라인 · 큰 고저차 · 노면 360° 회전', footprint('triangle', 405, 340, 135, 3, 0.45, [stunt('roll', .13, .13, 0)])],
  ['TOWER WEAVE', 'skyline', 3, '별 모양 타워 · 코일 · 루프 · 완전 회전', footprint('star', 502, 442, 68, 3, 0.45, [stunt('helix', .1, .16, 28, 3), stunt('loop', .42, .06, 55), stunt('roll', .73, .12, 0)])],
  ['HELIX HEIGHTS', 'skyline', 3, '비대칭 엄지형 · 공중 코일 4회전', footprint('thumb', 589, 559, 120, 2, 0.4, [stunt('helix', .32, .25, 33, 4)], -.3)],
  ['NIGHTFALL DROP', 'skyline', 4, '길게 휘어진 콩 모양 · 급강하 루프', footprint('kidney', 595, 435, 208, 2, 0.45, [stunt('loop', .42, .07, 71)], .8)],
  ['PHASE CORRIDOR', 'research', 3, '넓은 말굽 · 코일 · 3단 전환', footprint('horseshoe', 344, 315, 33, 2, 0.45, [stunt('helix', .03, .14, 16, 2)], .5)],
  ['PRISM BEND', 'research', 3, '세 잎 프리즘 · 노면 360° 회전 2곳', footprint('clover', 420, 345, 63, 3, 0.45, [stunt('roll', .16, .12, 0), stunt('roll', .62, .12, 0)], .5)],
  ['DOUBLE INVERSION', 'research', 4, '비대칭 8자 · 두 개의 수직 루프', footprint('eight', 624, 412, 141, 1, 0.45, [stunt('loop', .15, .055, 60), stunt('loop', .64, .06, 68)])],
  ['FLUX SPIRAL', 'research', 4, '입체 매듭 · 코일 · 교차 상승', footprint('knot', 306, 290, 193, 3, 0.45, [stunt('helix', .22, .1, 19, 3)])],
  ['ORBITAL RISE', 'orbital', 3, '공중 별 모양 · 대형 상승 · 코일', footprint('star', 401, 348, 146, 3, 0.45, [stunt('helix', .5, .16, 23, 3)], .3)],
  ['APEX DESCENT', 'orbital', 4, '기울어진 엄지형 · 급강하 · 연속 노면 720° 회전', footprint('thumb', 674, 617, 257, 2, 0.45, [stunt('roll', .42, .16, 0, 2)], 1.1)],
  ['INFINITY COIL', 'orbital', 3, '입체 무한대 · 코일 · 수직 루프', footprint('eight', 465, 322, 107, 1, 0.45, [stunt('helix', .1, .18, 22, 4), stunt('loop', .67, .05, 47)], -.35)],
  ['ZERO HORIZON', 'orbital', 4, '입체 매듭 · 루프 · 코일 · 완전 회전', footprint('knot', 357, 316, 208, 3, 0.45, [stunt('loop', .08, .038, 50), stunt('roll', .18, .07, 0), stunt('helix', .3, .07, 20, 2), stunt('loop', .48, .038, 46), stunt('helix', .59, .12, 26, 3), stunt('roll', .78, .1, 0, 2)], .4)],
];
// Lap limits are explicit playtesting targets; distance, stunt count and challenge are independent.
const lapLimits = [104, 108, 91, 100, 76, 130, 100, 111, 84, 108, 136, 96, 71, 106, 118, 98, 92, 76, 133, 116, 96, 127, 101, 148];
export const TRACK_CATALOG: readonly TrackDefinition[] = Object.freeze(recipes.map((r, i) => {
  const levels = r[2] <= 2 ? 2 : r[2] === 3 ? 3 : 4;
  const pattern = levels === 2 ? [1, 0, 1, 0] : levels === 3 ? [2, 0, 1, 2, 1, 0] : [3, 0, 1, 2, 3, 1, 2, 0];
  const id = r[0].toLowerCase().replaceAll(' ', '-');
  return Object.freeze({ id, name: r[0], revision: r[4] ? 2 : 1, order: i + 1, district: r[1], rating: r[2],
    predecessor: i ? recipes[i - 1][0].toLowerCase().replaceAll(' ', '-') : null,
    laps: 3, lapLimit: lapLimits[i], halfWidth: r[2] <= 3 ? 14 : 13,
    altitudeLevels: levels, obstacleLevels: Object.freeze(pattern), layout: r[4] ? Object.freeze({ ...r[4], stunts: Object.freeze(r[4].stunts.map(s => Object.freeze(s))) }) : null, features: r[3] });
}));
export function trackDefinition(id: string) { return TRACK_CATALOG.find(t => t.id === id); }
/** Explicit authored deadlines keep campaign rules independent of 3D geometry loading. */
export function campaignLapLimit(definition: TrackDefinition) { return definition.lapLimit; }
export function validateTrackCatalog(catalog: readonly TrackDefinition[]) {
  const ids = new Set(catalog.map(t => t.id));
  if (ids.size !== catalog.length) throw new Error('Duplicate track ID');
  for (const t of catalog) {
    if (!/^[a-z][a-z0-9-]*$/.test(t.id) || !t.name || !Number.isInteger(t.revision) || t.revision < 1 || !Number.isInteger(t.laps) || t.laps < 1 || t.laps > 10 || !Number.isInteger(t.rating) || t.rating < 1 || t.rating > 6 || !Number.isFinite(t.halfWidth) || t.halfWidth <= 4 || !Number.isFinite(t.lapLimit) || t.lapLimit <= 0 || ![2,3,4].includes(t.altitudeLevels) || t.obstacleLevels.some(n => !Number.isInteger(n) || n < 0 || n >= t.altitudeLevels)) throw new Error('Invalid track definition');
    if (t.layout) {
      const l = t.layout;
      if (!['ring','kidney','thumb','eight','clover','triangle','horseshoe','star','knot'].includes(l.shape) || ![l.radiusX,l.radiusZ,l.elevation,l.waves,l.rotation,l.bank].every(Number.isFinite) || l.radiusX < 100 || l.radiusZ < 100 || l.elevation < 0 || !Number.isInteger(l.waves) || l.waves < 1 || !l.stunts.length) throw new Error('Invalid course layout');
      let end = 0;
      for (const s of [...l.stunts].sort((a,b) => a.start-b.start)) {
        if (!['loop','helix','roll'].includes(s.kind) || ![s.start,s.span,s.radius,s.turns].every(Number.isFinite) || s.start < end || s.start < 0 || s.span <= 0 || s.start+s.span >= 1 || s.radius < 0 || !Number.isInteger(s.turns) || s.turns < 1) throw new Error('Invalid course stunt');
        end = s.start+s.span;
      }
    }
    const visited = new Set([t.id]); let previous = t.predecessor;
    while (previous) {
      if (!ids.has(previous) || visited.has(previous)) throw new Error('Invalid track dependencies');
      visited.add(previous); previous = catalog.find(p => p.id === previous)!.predecessor;
    }
  }
}
validateTrackCatalog(TRACK_CATALOG);
