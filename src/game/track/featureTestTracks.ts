import { TRACK_CATALOG, trackDefinition, validateTrackCatalog, type TrackDefinition } from './trackCatalog.js';

export interface FeatureTestTrackDefinition extends TrackDefinition {
  readonly instructions: string;
}

/** Test recipes never participate in campaign unlocks, records or rewards. */
export const FEATURE_TEST_TRACKS: readonly FeatureTestTrackDefinition[] = Object.freeze([
  {
    id: 'trench-line', name: 'TRENCH LINE', revision: 1, order: 0,
    district: 'abyss', rating: 2, predecessor: null,
    laps: 1, lapLimit: 60, halfWidth: 14, altitudeLevels: 2,
    obstacleLevels: [0, 1, 0, 1],
    layout: {
      shape: 'kidney', radiusX: 480, radiusZ: 410, elevation: 36,
      waves: 1, bank: .1, rotation: 0,
      stunts: [{ kind: 'roll', start: .62, span: .14, radius: 0, turns: 1, direction: 1 }],
    },
    instructions: '해저 도시의 완만한 곡선과 노면 회전을 1랩 둘러봅니다. 기존 조작으로 고도와 부스트를 시험해 보세요. 기록과 보상은 저장하지 않습니다.',
    features: '수중 도시 시험 주행 · 완만한 곡선 / 노면 회전 · 캠페인 밖 1랩',
  },
]);
validateTrackCatalog(FEATURE_TEST_TRACKS);
if (FEATURE_TEST_TRACKS.some(test => TRACK_CATALOG.some(track => track.id === test.id))) {
  throw new Error('Feature test track ID overlaps campaign');
}

export function resolveDriveTrack(id: string, featureTest: boolean): TrackDefinition | undefined {
  return trackDefinition(id) ?? (featureTest ? FEATURE_TEST_TRACKS.find(track => track.id === id) : undefined);
}

export function isFeatureTestTrack(id: string): boolean {
  return FEATURE_TEST_TRACKS.some(track => track.id === id);
}

export function featureTestTrackHref(id: string): string {
  return `#drive?track=${encodeURIComponent(id)}&mode=time-attack&challenge=easy&test=1`;
}
