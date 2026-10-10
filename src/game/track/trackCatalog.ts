import { MARINE_TRACK_CATALOG } from './marineTrackCatalog.js';
import type { JumpRecipe } from './trackJump.js';
import type { CourseLayout, CourseShape } from './trackAuthoring.js';
import type { BranchRecipe } from './trackBranches.js';

export type DistrictId = 'residential' | 'industrial' | 'stadium' | 'skyline' | 'research' | 'orbital' | 'harbor' | 'desert' | 'abyss' | 'kelp' | 'coral' | 'lagoon';
export const DISTRICTS: Record<DistrictId, { name: string; color: string; description: string }> = {
  residential: { name: '네온 주거지', color: '#67dcd0', description: '층별 창 조명과 주거 타워 · 순환로와 블록 사이 입체 주행' },
  industrial: { name: '전력 산업구역', color: '#ffac52', description: '반응로와 전력 기둥 · 공장 사이 연속 코일과 급강하' },
  stadium: { name: '그랜드 아레나', color: '#e886bc', description: '층층이 쌓인 관중석과 경기장 · 넓은 곡선과 상하 교차' },
  skyline: { name: '미드나이트 스카이라인', color: '#91aeff', description: '고층 첨탑과 공중 연결교 · 큰 고저차와 타워 사이 코일' },
  research: { name: '프리즘 연구도시', color: '#ba94ff', description: '발광 돔과 계단형 연구 시설 · 짧은 회전 구간과 입체 매듭' },
  orbital: { name: '오비탈 프런티어', color: '#e4eebb', description: '떠 있는 건물과 거대한 궤도 링 · 공중 교차와 연속 반전' },
  harbor: { name: '네온 항만', color: '#5acbff', description: '낮은 창고와 크레인 · 부두 순환로, 연결교와 입체 8자' },
  desert: { name: '솔라 사막기지', color: '#e9c96b', description: '낮은 계단형 기지와 태양광 패널 · 넓은 곡선과 압축된 연속 회전' },
  abyss: { name: '심해 해구', color: '#5ff5e6', description: '해저 돔과 연결 터널 · 수면빛과 생물 발광 사이 완만한 고도 주행' },
  kelp: { name: '켈프 숲', color: '#c0ef56', description: '큰 해초 기둥 사이 순환로 · 완만한 곡선에서 연속 코일까지' },
  coral: { name: '산호 정원', color: '#ff936c', description: '산호 군락과 해저 정원 · 넓은 루프와 교차 주행' },
  lagoon: { name: '햇빛 라군', color: '#ffd27a', description: '수면빛이 닿는 얕은 바다 · 탁 트인 곡선과 입체 회전' },
};
export interface TrackDefinition {
  readonly id: string; readonly name: string; readonly revision: number; readonly order: number;
  readonly district: DistrictId; readonly rating: number; readonly predecessor: string | null;
  readonly laps: number; readonly lapLimit: number; readonly halfWidth: number; readonly altitudeLevels: 2 | 3 | 4;
  readonly obstacleLevels: readonly number[]; readonly layout: CourseLayout | null; readonly features: string;
  readonly branches?: readonly BranchRecipe[];
  readonly jumps?: readonly JumpRecipe[];
}
const stunt = (kind: 'loop' | 'helix' | 'roll', start: number, span: number, radius = 70, turns = 1, direction: 1 | -1 = 1): CourseLayout['stunts'][number] => ({ kind, start, span, radius, turns, direction });
const footprint = (shape: CourseShape, radiusX: number, radiusZ: number, elevation: number, waves = 1, bank = 0, stunts: CourseLayout['stunts'] = [], rotation = 0): CourseLayout => ({ shape, radiusX, radiusZ, elevation, waves, bank, stunts, rotation });
// Every recipe owns its entire closed footprint. IDs remain stable when geometry gets a new revision.
const recipes: [string, DistrictId, number, string, CourseLayout | null][] = [
  ['WINDOW RUN', 'residential', 1, '원형 순환 · 루프 · 코일 · 완전 회전', footprint('ring', 510, 480, 36, 1, 0.1, [stunt('loop', .17, .085, 65, 1, 1), stunt('helix', .44, .16, 30, 1, 1), stunt('roll', .75, .15, 0, 1, 1)])],
  ['TERRACE FLOW', 'residential', 2, '콩 모양 상승 · 코일 · 루프 · 노면 회전', footprint('kidney', 584, 458, 103, 2, 0.25, [stunt('helix', .1, .17, 32, 2, -1), stunt('loop', .46, .08, 70, 1, -1), stunt('roll', .73, .14, 0, 1, -1)])],
  ['BLOCK SPRINT', 'residential', 2, '엄지형 블록 · 코일 2곳 · 완전 회전 2곳', footprint('thumb', 450, 450, 38, 1, 0.25, [stunt('helix', .08, .15, 22, 1, 1), stunt('roll', .33, .12, 0, 1, 1), stunt('helix', .52, .16, 26, 2, -1), stunt('roll', .8, .12, 0, 1, -1)], .4)],
  ['NEON CIRCUIT', 'residential', 3, '수직 루프 · 스프링 입문', null],
  ['GRIDWORKS', 'industrial', 2, '삼각 공장 · 루프 · 코일 · 노면 회전', footprint('triangle', 402, 341, 52, 3, 0.3, [stunt('loop', .12, .075, 54, 1, 1), stunt('helix', .38, .17, 24, 2, 1), stunt('roll', .75, .12, 0, 1, 1)])],
  ['VOLTAGE YARD', 'industrial', 2, '고가 8자 교차 · 루프 · 코일 · 노면 회전', footprint('eight', 584, 387, 118, 1, 0.2, [stunt('roll', .06, .1, 0, 1, -1), stunt('loop', .23, .065, 75, 1, -1), stunt('helix', .59, .14, 32, 2, -1), stunt('roll', .82, .1, 0, 1, 1)])],
  ['COIL FOUNDRY', 'industrial', 3, '원형 공장 외곽 · 3회전 코일', footprint('ring', 560, 482, 51, 2, 0.25, [stunt('helix', .18, .22, 39, 3, 1)])],
  ['REACTOR TURN', 'industrial', 3, '말굽 U자 · 코일 · 안쪽 회전 구간', footprint('horseshoe', 464, 424, 55, 2, 0.35, [stunt('helix', .03, .14, 26, 2, -1), stunt('roll', .37, .1, 0, 1, -1), stunt('roll', .78, .12, 0, 1, 1)])],
  ['ARENA RING', 'stadium', 2, '원형 아레나 · 뱅크 · 루프 · 코일', footprint('ring', 376, 376, 16, 2, 0.45, [stunt('loop', .12, .07, 55, 1, 1), stunt('helix', .43, .18, 25, 2, 1), stunt('roll', .76, .1, 0, 1, -1)])],
  ['GRANDSTAND DIVE', 'stadium', 3, '클로버 · 관중석 급강하 · 루프 · 완전 회전', footprint('clover', 504, 439, 124, 3, 0.45, [stunt('loop', .13, .065, 62, 1, -1), stunt('roll', .46, .13, 0, 1, 1), stunt('helix', .76, .13, 30, 2, -1)])],
  ['VICTORY LOOP', 'stadium', 3, '넓은 타원 · 대형 수직 루프', footprint('ring', 844, 497, 56, 1, 0.3, [stunt('loop', .2, .07, 117, 1, 1)])],
  ['CROSSOVER', 'stadium', 4, '입체 8자 · 상하 교차 · 노면 회전', footprint('eight', 456, 339, 117, 1, 0.45, [stunt('roll', .27, .12, 0, 1, -1)])],
  ['SKYLINE ASCENT', 'skyline', 2, '세 꼭짓점 스카이라인 · 큰 고저차 · 노면 360° 회전', footprint('triangle', 405, 340, 135, 3, 0.45, [stunt('roll', .13, .13, 0, 1, 1)])],
  ['TOWER WEAVE', 'skyline', 3, '별 모양 타워 · 코일 · 루프 · 완전 회전', footprint('star', 502, 442, 68, 3, 0.45, [stunt('helix', .1, .16, 28, 3, 1), stunt('loop', .42, .06, 55, 1, -1), stunt('roll', .73, .12, 0, 1, -1)])],
  ['HELIX HEIGHTS', 'skyline', 3, '비대칭 엄지형 · 공중 코일 4회전', footprint('thumb', 589, 559, 120, 2, 0.4, [stunt('helix', .32, .25, 33, 4, -1)], -.3)],
  ['NIGHTFALL DROP', 'skyline', 4, '길게 휘어진 콩 모양 · 급강하 루프', footprint('kidney', 595, 435, 208, 2, 0.45, [stunt('loop', .42, .07, 71, 1, 1)], .8)],
  ['PHASE CORRIDOR', 'research', 3, '넓은 말굽 · 코일 · 3단 전환', footprint('horseshoe', 344, 315, 33, 2, 0.45, [stunt('helix', .03, .14, 16, 2, 1)], .5)],
  ['PRISM BEND', 'research', 3, '세 잎 프리즘 · 노면 360° 회전 2곳', footprint('clover', 420, 345, 63, 3, 0.45, [stunt('roll', .16, .12, 0, 1, 1), stunt('roll', .62, .12, 0, 1, -1)], .5)],
  ['DOUBLE INVERSION', 'research', 4, '비대칭 8자 · 두 개의 수직 루프', footprint('eight', 624, 412, 141, 1, 0.45, [stunt('loop', .15, .055, 60, 1, -1), stunt('loop', .64, .06, 68, 1, 1)])],
  ['FLUX SPIRAL', 'research', 4, '입체 매듭 · 코일 · 교차 상승', footprint('knot', 306, 290, 193, 3, 0.45, [stunt('helix', .22, .1, 19, 3, -1)])],
  ['ORBITAL RISE', 'orbital', 3, '공중 별 모양 · 대형 상승 · 코일', footprint('star', 401, 348, 146, 3, 0.45, [stunt('helix', .5, .16, 23, 3, 1)], .3)],
  ['APEX DESCENT', 'orbital', 4, '기울어진 엄지형 · 급강하 · 연속 노면 720° 회전', footprint('thumb', 674, 617, 257, 2, 0.45, [stunt('roll', .42, .16, 0, 2, 1)], 1.1)],
  ['INFINITY COIL', 'orbital', 3, '입체 무한대 · 코일 · 수직 루프', footprint('eight', 465, 322, 107, 1, 0.45, [stunt('helix', .1, .18, 22, 4, -1), stunt('loop', .67, .05, 47, 1, -1)], -.35)],
  ['ZERO HORIZON', 'orbital', 4, '입체 매듭 · 루프 · 코일 · 완전 회전', footprint('knot', 357, 316, 208, 3, 0.45, [stunt('loop', .08, .038, 50, 1, 1), stunt('roll', .18, .07, 0, 1, -1), stunt('helix', .3, .07, 20, 2, 1), stunt('loop', .48, .038, 46, 1, -1), stunt('helix', .59, .12, 26, 3, -1), stunt('roll', .78, .1, 0, 2, 1)], .4)],
  ['DOCKSIDE RUN', 'harbor', 2, '부두 순환로 · 상승 루프 · 우회전 코일', footprint('ring', 475, 400, 32, 1, .16, [stunt('loop', .17, .08, 60, 1, 1), stunt('helix', .59, .15, 25, 2, 1)])],
  ['CRANE CROSSING', 'harbor', 3, '크레인 사이 8자 · 상하 교차 · 좌우 노면 회전', footprint('eight', 594, 414, 95, 1, .35, [stunt('roll', .15, .11, 0, 1, 1), stunt('roll', .66, .12, 0, 1, -1)], .3)],
  ['BREAKWATER ARC', 'harbor', 3, '방파제 말굽 · 양방향 루프 · 급강하', footprint('horseshoe', 430, 360, 80, 2, .3, [stunt('loop', .21, .07, 60, 1, 1), stunt('loop', .64, .07, 60, 1, -1)], -.5)],
  ['TIDAL KNOT', 'harbor', 4, '부두 입체 매듭 · 좌우 코일 · 완전 회전', footprint('knot', 320, 280, 125, 2, .4, [stunt('helix', .1, .13, 24, 2, -1), stunt('roll', .4, .1, 0, 1, -1), stunt('helix', .65, .13, 24, 2, 1)], .4)],
  ['SOLAR APPROACH', 'desert', 2, '기지 외곽 콩 모양 · 넓은 상승 · 루프와 노면 회전', footprint('kidney', 470, 380, 45, 1, .18, [stunt('loop', .19, .08, 62, 1, 1), stunt('roll', .65, .13, 0, 1, -1)], .8)],
  ['MIRAGE CLOVER', 'desert', 2, '세 잎 기지 순환로 · 낮은 코일 · 반대 방향 노면 회전', footprint('clover', 468.75, 412.5, 50, 2, .22, [stunt('helix', .14, .16, 22, 2, -1), stunt('roll', .62, .12, 0, 1, 1)], -.4)],
  ['SUNSPIRE DESCENT', 'desert', 3, '비대칭 엄지형 · 상승 코일 · 급강하 루프', footprint('thumb', 500, 435, 120, 2, .35, [stunt('helix', .11, .15, 27, 2, 1), stunt('loop', .57, .07, 65, 1, -1)], .5)],
  ['SOLSTICE CIRCUIT', 'desert', 4, '압축된 삼각 순환로 · 루프 2곳 · 코일 2곳 · 완전 회전 2곳', footprint('triangle', 395, 345, 70, 2, .35, [stunt('loop', .07, .055, 50, 1, -1), stunt('roll', .21, .07, 0, 1, 1), stunt('helix', .35, .1, 20, 2, -1), stunt('loop', .53, .055, 50, 1, 1), stunt('helix', .68, .1, 20, 2, 1), stunt('roll', .85, .07, 0, 1, -1)], .2)],
];
// Lap limits are explicit playtesting targets; distance, stunt count and challenge are independent.
const lapLimits = [104, 108, 91, 100, 76, 130, 100, 111, 84, 108, 136, 96, 71, 106, 118, 98, 92, 76, 133, 116, 96, 127, 101, 148, 95, 105, 101, 126, 99, 90, 104, 107];
const NEON_TRACK_CATALOG: readonly TrackDefinition[] = Object.freeze(recipes.map((r, i) => {
  const levels = r[2] <= 2 ? 2 : r[2] === 3 ? 3 : 4;
  const pattern = levels === 2 ? [1, 0, 1, 0] : levels === 3 ? [2, 0, 1, 2, 1, 0] : [3, 0, 1, 2, 3, 1, 2, 0];
  const id = r[0].toLowerCase().replaceAll(' ', '-');
  const branchCourses = [0, 1, 4, 5, 6, 8, 9, 12, 13, 15, 16, 17, 20, 21, 23, 24, 25, 28, 29];
  const experience: BranchRecipe['experience'] = ({ residential: 'city', industrial: 'reactor', stadium: 'arena', skyline: 'sky', research: 'prism', orbital: 'orbit', harbor: 'sky', desert: 'reactor', abyss: 'prism', kelp: 'city', coral: 'prism', lagoon: 'sky' } as const)[r[1]];
  const branches: readonly BranchRecipe[] = branchCourses.includes(i) ? Object.freeze([Object.freeze({ id: `${id}-fork`,
    kind: i % 4 === 1 ? 'vertical' as const : 'horizontal' as const, experience, direction: i % 2 ? -1 as const : 1 as const,
    intertwined: [6, 13, 17, 23].includes(i), ...(i === 8 ? { variety: 'arena-three' as const } : {}), ...(i === 6 ? { groundClearance: 12 } : {}) })]) : [];
  const jumps: readonly JumpRecipe[] = i === 5 ? Object.freeze([Object.freeze({ id: 'voltage-yard-drop', branchId: `${id}-fork`, routeIndex: 1 as const })]) : [];
  return Object.freeze({ id, name: r[0], jumps, revision: (r[4] ? (r[4].stunts.some(s => s.direction === -1) ? 3 : 2) : 1) + (branches.length ? 3 : 0) + ([6, 8].includes(i) ? 1 : 0) + (jumps.length ? 1 : 0), order: i + 1, district: r[1], rating: r[2], branches,
    predecessor: i ? recipes[i - 1][0].toLowerCase().replaceAll(' ', '-') : null,
    laps: 3, lapLimit: lapLimits[i], halfWidth: r[2] <= 3 ? 14 : 13,
    altitudeLevels: levels, obstacleLevels: Object.freeze(pattern), layout: r[4] ? Object.freeze({ ...r[4], stunts: Object.freeze(r[4].stunts.map(s => Object.freeze(s))) }) : null, features: r[3] + (jumps.length ? ' · 하강 점프' : '') + (branches.length ? ` · ${branches[0].variety ? '3갈래 · 낮은 길/중간 길/높은 길' : branches[0].intertwined ? '입체 교차 분기' : branches[0].kind === 'horizontal' ? '좌우 갈림길' : '상하 갈림길'}` : '') });
}));
export const TRACK_CATALOG: readonly TrackDefinition[] = Object.freeze([...NEON_TRACK_CATALOG, ...MARINE_TRACK_CATALOG]);
export function trackDefinition(id: string) { return TRACK_CATALOG.find(t => t.id === id); }
/** Explicit authored deadlines keep campaign rules independent of 3D geometry loading. */
export function campaignLapLimit(definition: TrackDefinition) { return definition.lapLimit; }
/** Easier courses allow a wider qualifying pack; ratings 5–6 reserve the top two. */
export function campaignRankLimit(definition: Pick<TrackDefinition, 'rating'>) { return definition.rating <= 2 ? 4 : definition.rating <= 4 ? 3 : 2; }
export function validateTrackCatalog(catalog: readonly TrackDefinition[]) {
  const ids = new Set(catalog.map(t => t.id));
  if (ids.size !== catalog.length) throw new Error('Duplicate track ID');
  for (const t of catalog) {
    const branchIds = new Set<string>();
    for (const b of t.branches ?? []) {
      if (!b.id || branchIds.has(b.id) || !['horizontal','vertical'].includes(b.kind)
        || !['city','reactor','arena','sky','prism','orbit'].includes(b.experience)
        || (b.direction !== undefined && b.direction !== 1 && b.direction !== -1)
        || (b.variety !== undefined && (b.variety !== 'arena-three' || b.kind !== 'horizontal' || b.experience !== 'arena' || b.intertwined))
        || (b.groundClearance !== undefined && (!Number.isFinite(b.groundClearance) || b.groundClearance < 0))) throw new Error('Invalid course branch');
      branchIds.add(b.id);
    }
    const jumpIds = new Set<string>(), jumpRoutes = new Set<string>();
    for (const j of t.jumps ?? []) {
      const route = `${j.branchId}:${j.routeIndex}`;
      if (!j.id || jumpIds.has(j.id) || jumpRoutes.has(route) || !branchIds.has(j.branchId) || ![0, 1].includes(j.routeIndex)) throw new Error('Invalid course jump');
      jumpIds.add(j.id); jumpRoutes.add(route);
    }
    if (!/^[a-z][a-z0-9-]*$/.test(t.id) || !t.name || !Number.isInteger(t.revision) || t.revision < 1 || !Number.isInteger(t.laps) || t.laps < 1 || t.laps > 10 || !Number.isInteger(t.rating) || t.rating < 1 || t.rating > 6 || !Number.isFinite(t.halfWidth) || t.halfWidth <= 4 || !Number.isFinite(t.lapLimit) || t.lapLimit <= 0 || ![2,3,4].includes(t.altitudeLevels) || t.obstacleLevels.some(n => !Number.isInteger(n) || n < 0 || n >= t.altitudeLevels)) throw new Error('Invalid track definition');
    if (t.layout) {
      const l = t.layout;
      if (!['ring','kidney','thumb','eight','clover','triangle','horseshoe','star','knot'].includes(l.shape) || ![l.radiusX,l.radiusZ,l.elevation,l.waves,l.rotation,l.bank].every(Number.isFinite) || l.radiusX < 100 || l.radiusZ < 100 || l.elevation < 0 || !Number.isInteger(l.waves) || l.waves < 1 || !l.stunts.length) throw new Error('Invalid course layout');
      let end = 0;
      for (const s of [...l.stunts].sort((a,b) => a.start-b.start)) {
        if (!['loop','helix','roll'].includes(s.kind) || ![s.start,s.span,s.radius,s.turns].every(Number.isFinite) || (s.direction !== undefined && s.direction !== 1 && s.direction !== -1) || s.start < end || s.start < 0 || s.span <= 0 || s.start+s.span >= 1 || s.radius < 0 || !Number.isInteger(s.turns) || s.turns < 1) throw new Error('Invalid course stunt');
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
