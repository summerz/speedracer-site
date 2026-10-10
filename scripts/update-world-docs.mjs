import { readFile, writeFile } from 'node:fs/promises';
import { TRACK_CATALOG, DISTRICTS, campaignRankLimit } from '../output/test/game/track/trackCatalog.js';
import { CITY_CATALOG, campaignTracksForCity } from '../output/test/game/track/cityCatalog.js';
import { FEATURE_TEST_TRACKS } from '../output/test/game/track/featureTestTracks.js';
import { createCatalogTrack, trackMetrics } from '../output/test/game/track/trackRuntime.js';
import { describeTrackLandmarks } from '../output/test/game/track/createTrackLandmark.js';
import { LANDMARK_TYPES, LANDMARK_DISTRICTS, LANDMARK_ENCOUNTERS } from '../output/test/game/track/landmarkCatalog.js';
import { roadPaths } from '../output/test/game/track/trackBranches.js';
import { NIGHT_ENVIRONMENTS, UNDERWATER_ENVIRONMENTS, raceEnvironmentsForDistrict } from '../output/test/game/environment/raceEnvironment.js';

const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const cityRows = CITY_CATALOG.map(city => [city.name, city.districts.map(id => DISTRICTS[id].name).join(' / '), campaignTracksForCity(city.id).map(track => track.order).join(', ')]);
const definitions = [...TRACK_CATALOG, ...FEATURE_TEST_TRACKS];
const courses = definitions.map(definition => {
  const track = createCatalogTrack(definition);
  const landmarks = describeTrackLandmarks(track, definition);
  return { definition, track, landmarks, metrics: trackMetrics(track) };
});
const prefix = title => `# ${title}\n\n현재 v${version} 제작 데이터에서 생성한 문서입니다. 수정은 카탈로그와 이 문서 생성 스크립트에 반영하고 \`npm run docs:world\`로 갱신합니다. \`npm run docs:world:check\`는 데이터와 문서의 일치를 확인합니다.\n\n`;
const table = (columns, rows) => `| ${columns.join(' | ')} |\n| ${columns.map(() => '---').join(' | ')} |\n${rows.map(row => `| ${row.join(' | ')} |`).join('\n')}\n`;
const number = n => n === 0 ? 'TEST' : String(n).padStart(2, '0');
const stuntDirections = definition => definition.layout ? definition.layout.stunts.map(s => `${Math.round(s.start*100)}% ${s.kind === 'loop' ? (s.direction === -1 ? '하향 루프' : '상향 루프') : `${s.kind === 'helix' ? '코일' : '노면 회전'} ${s.direction === -1 ? '역회전' : '정회전'}`} ×${s.turns}`).join(' / ') : '상향 루프 / 정회전 코일 ×2';
const nearestFraction = (track, landmark) => {
  let nearest = 0, distance = Infinity;
  for (const path of roadPaths(track)) for (let d = path.start; d < path.end; d += 12) {
    const p = track.sample(d, undefined, path.routeId).position;
    const delta = Math.hypot(p.x - landmark.position.x, p.z - landmark.position.z);
    if (delta < distance) { distance = delta; nearest = d; }
  }
  return Math.round(nearest / track.length * 100);
};
const documents = {
  'TRACK_CATALOG.md': prefix('트랙 카탈로그') + table(['도시', '구역', '트랙 번호'], cityRows) + '\n' +
    '캠페인 규칙과 저장/해금은 [트랙 제작과 캠페인](TRACK_CAMPAIGN.md), 경로별 구성은 [갈림길 카탈로그](TRACK_BRANCHES.md), 끊긴 도로는 [점프 계약](TRACK_JUMPS.md), 주변 구조물은 [랜드마크 카탈로그](LANDMARK_CATALOG.md), 하늘·안개·천체는 [월드 환경](WORLD_ENVIRONMENTS.md)을 참조합니다.\n\n' +
    `## 제작 원칙\n\n${TRACK_CATALOG.length}개 코스는 각각 닫힌 경로와 최소 1개 특수 구간을 갖습니다. 길이와 난이도는 별도로 조정하며 새 구역 입구에서 난이도가 낮아집니다. 아래 거리와 시간은 1랩 기준이고 캠페인 경기는 3랩입니다. 시험 트랙은 캠페인 밖 1랩이며 기록·보상·해금에 반영하지 않습니다. 기체에 따른 트랙 주색, 구역별 배경색, 난이도에 따른 고도 단계를 사용합니다. 환경 연출 변경만으로 기록 제작 버전을 올리지 않습니다.\n\n` +
    '## 구역별 특징\n\n' + table(['구역 / 주색', '트랙 번호', '경관과 주행 특징'], Object.entries(DISTRICTS).map(([id, spec]) => {
      const tracks = TRACK_CATALOG.filter(t => t.district === id);
      const hasTest = FEATURE_TEST_TRACKS.some(t => t.district === id);
      const range = tracks.length ? `${number(tracks[0].order)}–${number(tracks.at(-1).order)}` : '';
      return [`${spec.name} / \`${spec.color}\``, [range, hasTest ? '시험용 · 캠페인 밖' : ''].filter(Boolean).join(' / '), spec.description];
    })) + '\n' +
    table(['번호 / ID', '이름', '구역', '길이 km', '트랙 강도 /6', '고도 단계', '랩 제한 초', '경쟁 레이스 통과 순위', '전체 형태 / 특수 구간'], courses.map(({ definition: d, metrics }) => [
      `${number(d.order)} / \`${d.id}\``, d.name, DISTRICTS[d.district].name, `${(metrics.lengthMin / 1000).toFixed(1)}${(metrics.lengthMin / 1000).toFixed(1) !== (metrics.lengthMax / 1000).toFixed(1) ? `–${(metrics.lengthMax / 1000).toFixed(1)}` : ''}`, d.rating, d.altitudeLevels, d.lapLimit, d.order === 0 ? '기록 없음' : `${campaignRankLimit(d)}위 이내`, d.features,
    ])) +
    '\n## 특수 구간 방향\n\n방향은 코스 제작 데이터에 고정합니다. 각 종류의 정·역방향을 캠페인 초반부터 섞고 구역마다 균형을 유지합니다. `direction: 1`은 상향 루프·정회전, `-1`은 하향 루프·역회전입니다. 코일은 경로와 노면을 함께 반대로 돌리고 노면 회전은 경로를 유지한 채 자세만 반대로 돌립니다. 하향 루프는 진입부 아래로 내려가며 코스 전체를 높여 최저 노면을 도시 바닥 위에 둡니다. 방향이 바뀐 코스는 제작 버전을 올리며 기존 해금·통과 기록은 보존합니다. 위치 %는 특수 구간을 넣기 전 기본 경로 기준입니다.\n\n' +
    table(['코스', '제작 버전', '위치 / 방향 / 회전 수'], courses.map(({ definition: d }) => [`${number(d.order)} ${d.name}`, d.revision, stuntDirections(d)])) +
    '\n## 추가 코스\n\n`trackCatalog.ts`에 고유 ID·선행 ID·구역·경로·고도·제한시간·특수 구간 방향을 추가합니다. 기존 ID는 보존합니다. 구역이 늘어나면 `landmarkCatalog.ts`의 대표 형태·동반 형태·발광색도 지정합니다. 문서 갱신과 접근 시야·경로 간격·기본 기체 완주 검증을 실행합니다.\n',
  'TRACK_BRANCHES.md': prefix('갈림길 카탈로그') +
    `${courses.filter(c => c.definition.branches?.length).length}개 코스에 분기와 합류를 배치했습니다. 01 WINDOW RUN은 좌우 조향, 02 TERRACE FLOW는 진입 고도로 선택합니다. ${new Set(TRACK_CATALOG.filter(track => track.branches?.length).map(track => track.district)).size}개 구역에 배치하며 같은 수나 순서를 강제하지 않습니다. 아래 길이는 분기부터 합류까지 실제 거리이며 위치 %는 경로들이 공유하는 랩 진행도입니다.\n\n` +
    table(['코스', '선택 / 분기–합류', '경로', '길이 m', '특징 / 시야'], courses.flatMap(({ definition: d, track }) => (track.branches ?? []).flatMap(f => f.routes.map((r, i) => [
      `${number(d.order)} ${d.name}`, `${f.kind === 'vertical' ? '상하 고도' : '좌우 조향'} / ${Math.round(f.start / track.length * 100)}–${Math.round(f.end / track.length * 100)}%`, `${r.cue ? { left: '왼쪽', center: '가운데', right: '오른쪽' }[r.cue.choice] : f.kind === 'vertical' ? i ? '위' : '아래' : i ? '오른쪽' : '왼쪽'} · ${r.name}`, Math.round(r.length), `${r.features.join(' · ')}${track.jumps?.some(j => j.routeId === r.id) ? ' · [하강 점프](TRACK_JUMPS.md)' : ''} / ${r.description}`,
    ])))) +
    `\n## 조작과 공통 판정\n\n기존 두 갈래 입구의 35m 공통 도로에서는 좌우 위치 또는 선택 고도로 경로를 바꿀 수 있습니다. 두 길이 갈라지기 시작하는 지점에서 선택을 고정하고, 출구의 35m 공통 도로로 부드럽게 합류합니다. 좌우·상하 모두 같은 높이에서 좌우 대칭 Y자로 먼저 벌어진 다음 경로별 커브·상승·코일·노면 회전을 시작하며, 출구도 같은 높이의 역 Y자로 모입니다. 상하 경로는 진입 고도로 선택하되 낮은 길은 왼쪽, 높은 길은 오른쪽으로 갈라진 뒤 상승·하강합니다. 공통 도로는 한 번만 그리고, 모든 입구·출구에서 도로가 아직 붙어 있는 동안에는 안쪽 발광 경계선과 경로별 중앙선을 숨깁니다. 길이가 다른 두 경로도 동일한 제작 단면끼리 접합해 도로 끝이 뒤로 접히지 않게 합니다. 입구·출구의 위치·방향·노면은 양쪽 경로가 공유하며, 경로를 선택한 첫 프레임부터 실제 선택 경로를 표시합니다. 경로 안의 고도 조작은 선택한 노면을 기준으로 유지합니다. 매 랩 다시 선택할 수 있고 AI도 양쪽 길을 사용합니다. 긴 길에서는 같은 실제 속도라도 공유 진행도가 더 느리게 증가하며, 랩·순위·보상은 공통 분기/합류에 연결합니다. 경로별 장애물만 충돌·통과·경고 대상으로 삼습니다.\n\n짧은 경로에는 가까운 구조물과 두 개의 고도 장애물, 긴 경로에는 트인 전망과 한 개의 고도 장애물을 둡니다. 일부 코스는 서로 감기는 코일에 한쪽 노면 회전을 더합니다. ${courses.filter(c => c.definition.branches?.length).length}개 실제 코스의 양쪽 입구·합류 경계선이 전진 방향으로 이어지는지 0.25m 간격으로 검증합니다. 양쪽 코일의 중앙부 도로 간격과 접합 위치·방향·노면 연속성, 물리 거리, 재선택과 AI 완주도 자동 검증합니다. 캠페인 미리보기와 PIP에는 두 도로를 그리며 현재 경로를 강조하고 분기 앞 표지와 주행 HUD에 경로 이름을 표시합니다.\n\nARENA RING은 60m 공통 입구에서 좌·중·우 조향으로 고르는 세 갈래이며 중립은 가운데입니다. 왼쪽은 낮은 노면과 고도 장애물 2개, 가운데는 중간 노면과 안전 차선 길막 1개, 오른쪽은 높은 노면과 안전 부스트 패드 1개를 둡니다. 세 길 안에는 추가 무작위 위험을 넣지 않고 AI도 모두 사용합니다. 화면 연결 계약과 실제 길이는 [분기 다양화](BRANCH_VARIETY.md)를 참조합니다.\n\n제작 데이터: \`trackCatalog.ts\`의 \`branches\`. 형상과 경로 선택/거리 계산: \`trackBranches.ts\`. 기체별 최적 경로와 모바일 실기 성능은 후속 체감 검증에서 조정합니다.\n`,
  'LANDMARK_CATALOG.md': prefix('랜드마크 카탈로그') +
    `주변 건물보다 큰 구조물을 ${TRACK_CATALOG.length}개 트랙에 각 ${LANDMARK_ENCOUNTERS.length}곳, 총 ${TRACK_CATALOG.length * LANDMARK_ENCOUNTERS.length}곳 배치합니다. 형태는 재사용하고 코스 ID에 따른 위치·회전·규모는 재현됩니다. [트랙 카탈로그](TRACK_CATALOG.md)와 [월드 환경](WORLD_ENVIRONMENTS.md)을 함께 참고합니다.\n\n` +
    '## 재사용하는 형태\n\n' + table(['종류 ID', '이름', '구조와 조명', '제작 높이 기준 m'], Object.entries(LANDMARK_TYPES).map(([id, spec]) => [id, spec.name, spec.description, spec.height])) +
    '\n높이 기준은 구조물 전체를 담는 제작 범위이며 정확한 건축물 실측 높이가 아닙니다. 실제 배치는 이 값에 배율을 곱합니다. 각 구조물의 조각은 본체·발광선·받침 3개 메시로 병합합니다. 일반 도시 건물과 창문은 별도의 3개 InstancedMesh를 공유합니다.\n\n' +
    '## 구역별 조합과 색상\n\n' + table(['구역', '대표 후보', '동반 1 / 동반 2', '대표 / 동반 1 / 동반 2 발광색'], Object.entries(LANDMARK_DISTRICTS).map(([district, spec]) => [
      DISTRICTS[district].name, spec.signature.map(k => LANDMARK_TYPES[k].name).join(' / '), spec.companions.map(k => LANDMARK_TYPES[k].name).join(' / '), spec.accents.map(c => `\`${c}\``).join(' / '),
    ])) +
    `\n## 배치와 표시\n\n앞·중간·뒤의 목표 위치는 ${LANDMARK_ENCOUNTERS.map(e => `${Math.round(e.fraction * 100)}%`).join(' / ')}입니다. 대표·동반 1·동반 2의 기본 배율은 ${LANDMARK_ENCOUNTERS.map(e => e.scale).join(' / ')}이며 첨탑은 원래 높아 배율을 70%로 줄입니다. 코스 곡률과 특수 구간에 따라 안전하고 잘 보이는 인근 위치를 찾습니다. 전체 주행 경로와 구조물끼리 간격을 두고, 접근 시야가 이어지는 후보만 사용합니다. 구조물 반경(72m × 배율)과 도로 반폭 밖으로 네온시티는 42m, 마린시티는 42m × 배율의 빈 공간을 확보합니다(3.1배에서는 130.2m). 일반 건물이 접근 시야를 가리지 않도록 비웁니다.\n\n` +
    '저품질은 1,400m, 균형/고품질은 2,200m 표시 범위를 사용하며 구조물 높이를 더해 큰 실루엣이 일찍 사라지지 않게 합니다. 주행/콕핏에는 도시와 랜드마크를 표시하고 경기 중 전체 트랙 뷰에는 숨깁니다. 캠페인 선택 미리보기는 실제 주행과 같은 위치·형태를 표시합니다. 배경에는 충돌 판정이 없습니다.\n\n' +
    '## 코스별 사용\n\n각 칸은 **형태 · 배율 · 높이 기준 · 가장 가까운 경로 위치**입니다. %는 수평 거리 기준으로 가장 가까운 경로 위치이며 실제로 처음 보이는 시점과 다릅니다. 입체 교차에서는 다른 경로 구간이 더 가까울 수 있습니다. 같은 형태가 여러 번 사용되어도 규모·방향·발광색은 순서에 따라 달라집니다.\n\n' +
    table(['번호 / 트랙', '구역', '대표 구조물', '동반 1', '동반 2'], courses.map(({ definition: d, track, landmarks }) => [
      `${number(d.order)} ${d.name}`, DISTRICTS[d.district].name, ...landmarks.map(l => `${LANDMARK_TYPES[l.kind].name} · ${l.scale.toFixed(2)}× · ${Math.round(l.height)}m · ${nearestFraction(track, l)}%`),
    ])) + '\n제작 데이터: `src/game/track/landmarkCatalog.ts`. 배치/형상: `createTrackLandmark.ts`. 도시·거리 표시: `createDistrictScenery.ts`.\n',
  'WORLD_ENVIRONMENTS.md': prefix('월드 환경과 천체') +
    '환경은 [트랙](TRACK_CATALOG.md)과 [랜드마크](LANDMARK_CATALOG.md)에 덧입히는 독립적인 연출입니다. 시간대 때문에 물리·제한시간·해금·기록 버전은 바뀌지 않습니다.\n\n' +
    `## 선택과 유지\n\n네온시티 ${campaignTracksForCity('neon').length}개 트랙은 타임어택/경쟁 레이스 모두 경기 준비 화면 진입 때 아래 밤하늘 ${NIGHT_ENVIRONMENTS.length}종을 같은 확률로 선택합니다. 마린시티 ${campaignTracksForCity('marine').length}개 트랙은 소속 구역의 물속 환경만 선택합니다. 일시정지·재도전에서는 선택된 환경을 유지하고 경기 화면을 나갔다 다시 들어올 때 새로 선택합니다. 캠페인 트랙이 없는 자유 주행은 한밤중을 사용합니다. 현재 낮 환경과 실시간 시간대 전환은 없습니다.\n\n` +
    table(['환경 ID / 이름', '천체', '겉보기 지름 / 중심 고도 °', '천정 / 지평선 색', '안개 색 / 밀도', '별 강도', '날씨'], NIGHT_ENVIRONMENTS.map(e => [
      `\`${e.id}\` / ${e.label}`, e.celestial, `${Math.round(e.celestialRadius * 360 / Math.PI)} / ${Math.round(e.celestialElevation * 180 / Math.PI)}`, `\`${e.zenith}\` / \`${e.horizon}\``, `\`${e.fog}\` / ${e.fogDensity}`, e.stars, e.rain ? '비 / 번개 / 천둥' : '맑음',
    ])) +
    '\n## 마린시티 환경\n\n`abyss`·`kelp`·`coral`·`lagoon` 구역은 `MARINE_ZONES`의 소속 환경 배열에서만 균등 선택합니다. `RaceEnvironment.underwater`는 `true`이며 별·천체·비·번개·천둥은 사용하지 않습니다. 개발용 비 토글도 수중 환경을 덮어쓰지 않습니다. 재도전에서는 선택을 유지합니다. 시험 트랙 TRENCH LINE은 캠페인 밖에 있고 `test=1`로만 진입합니다. 환경 데이터와 진입 계약은 [수중 도시 런타임](ABYSS_RUNTIME.md)을 참조합니다. 도시·구역·해금 계약은 [도시 구조](CITY_STRUCTURE.md)를 참조합니다.\n\n' +
    table(['환경 ID / 이름', '천정 / 지평선 색', '안개 색 / 밀도'], UNDERWATER_ENVIRONMENTS.map(e => [
      `\`${e.id}\` / ${e.label}`, `\`${e.zenith}\` / \`${e.horizon}\``, `\`${e.fog}\` / ${e.fogDensity}`,
    ])) +
    '\n## 천체 연출\n\n천체는 지평선에 걸쳐 있는 거대한 원반으로 하늘 셰이더에 그립니다. 겉보기 지름은 60° 이상이며 시선 방향과 화면 비율에 따라 화면 밖으로 이어집니다. 도시의 선명한 선과 톤을 맞추기 위해 윤곽은 픽셀 폭으로 안티앨리어싱하고, 큰 표면 패턴과 3단계 명암으로 입체감을 표현합니다. 달에는 어두운 바다·큰 분화구와 좁은 테두리를, 고리 행성에는 분명하게 나뉜 대기 띠와 앞뒤로 겹치는 고리 띠·어두운 간극을 표현합니다. 대기층은 얇은 가장자리에 남기고 지평선 안개는 좁고 옅은 띠로 더합니다. 천체의 아래쪽까지 완전하게 그리며 고정 수평선으로 잘라내지 않습니다. 실제 지형과 건물이 깊이 판정으로 가려주므로 높은 구간·다른 주행 위치에서도 윤곽이 이어집니다. 행성과 고리는 별도 구체 메시나 광원을 추가하지 않으며 하늘 한 번의 렌더링을 공유합니다.\n\n' +
    '하늘은 카메라 위치만 따라가며 천체 방향은 트랙 출발 방위 근처에 월드 기준으로 고정합니다. 전진·좌우 이동으로 천체가 주변 건물처럼 움직이지 않습니다. 곡선에서 시야 밖으로 사라졌다 다시 나타날 수 있으며 루프·노면 회전에서는 수평선과 함께 회전해 보입니다. PIP의 주행 뷰에도 같은 하늘을 유지하고 전체 트랙 뷰에는 표시하지 않습니다.\n\n' +
    '## 폭풍우의 밤\n\n하늘과 월드를 더 어둡게 하고 월드 수직 방향으로 비를 내립니다. 비는 단일 재사용 선 버퍼이며 저품질 240 / 균형 480 / 고품질 800개입니다. 트랙 전체 뷰에는 비를 숨기고 주행 뷰에는 유지합니다. 매 랩 1–4회 번개 위치를 새로 정하고 0.8–2.4초 뒤 천둥을 재생합니다. 일시정지는 비·번개·천둥 시계를 멈추고 재도전은 예약 효과를 초기화합니다. 동작 줄이기는 번개 강도를 20%로 줄입니다. 추가 후처리 패스는 없습니다.\n\n' +
    '## 트랙별 사용 범위\n\n' + table(['구역', '사용 트랙', '선택 환경'], Object.entries(DISTRICTS).map(([id, district]) => [district.name, definitions.filter(t => t.district === id).map(t => `${number(t.order)} ${t.name}`).join(' / '), raceEnvironmentsForDistrict(id).map(e => e.label).join(' / ')])) +
    '\n제작 데이터: `src/game/environment/raceEnvironment.ts`. 하늘/천체: `createNightSky.ts`. 비/번개: `createRaceWeather.ts`. 경기 진입 시 선택과 재도전 유지: `raceApp.ts`. 실제 iPhone의 GPU 프레임 시간·발열은 별도 실기 검증이 필요합니다.\n',
};
let stale = false;
for (const [name, content] of Object.entries(documents)) {
  const path = new URL(`../docs/${name}`, import.meta.url);
  if (process.argv.includes('--check')) {
    let current = '';
    try { current = await readFile(path, 'utf8'); } catch { /* Missing documentation is stale. */ }
    if (current !== content) { console.error(`Outdated: docs/${name}; run npm run docs:world`); stale = true; }
  } else { await writeFile(path, content); console.log(`Updated docs/${name}`); }
}
if (stale) process.exitCode = 1;
