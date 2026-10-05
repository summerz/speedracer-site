import { readFile, writeFile } from 'node:fs/promises';
import { TRACK_CATALOG, DISTRICTS } from '../output/test/game/track/trackCatalog.js';
import { createCatalogTrack } from '../output/test/game/track/trackRuntime.js';
import { describeTrackLandmarks } from '../output/test/game/track/createTrackLandmark.js';
import { LANDMARK_TYPES, LANDMARK_DISTRICTS, LANDMARK_ENCOUNTERS } from '../output/test/game/track/landmarkCatalog.js';
import { NIGHT_ENVIRONMENTS } from '../output/test/game/environment/raceEnvironment.js';

const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const courses = TRACK_CATALOG.map(definition => {
  const track = createCatalogTrack(definition);
  const landmarks = describeTrackLandmarks(track, definition);
  return { definition, track, landmarks };
});
const prefix = title => `# ${title}\n\n현재 v${version} 제작 데이터에서 생성한 문서입니다. 수정은 카탈로그와 이 문서 생성 스크립트에 반영하고 \`npm run docs:world\`로 갱신합니다. \`npm run docs:world:check\`는 데이터와 문서의 일치를 확인합니다.\n\n`;
const table = (columns, rows) => `| ${columns.join(' | ')} |\n| ${columns.map(() => '---').join(' | ')} |\n${rows.map(row => `| ${row.join(' | ')} |`).join('\n')}\n`;
const number = n => String(n).padStart(2, '0');
const nearestFraction = (track, landmark) => {
  let nearest = 0, distance = Infinity;
  for (let d = 0; d < track.length; d += 12) {
    const p = track.sample(d).position;
    const delta = Math.hypot(p.x - landmark.position.x, p.z - landmark.position.z);
    if (delta < distance) { distance = delta; nearest = d; }
  }
  return Math.round(nearest / track.length * 100);
};
const documents = {
  'TRACK_CATALOG.md': prefix('트랙 카탈로그') +
    '캠페인 규칙과 저장/해금은 [트랙 제작과 캠페인](TRACK_CAMPAIGN.md), 주변 구조물은 [랜드마크 카탈로그](LANDMARK_CATALOG.md), 하늘·안개·천체는 [월드 환경](WORLD_ENVIRONMENTS.md)을 참조합니다.\n\n' +
    '## 제작 원칙\n\n24개 코스는 각각 닫힌 경로와 최소 1개 특수 구간을 갖습니다. 길이와 난이도는 별도로 조정하며 새 구역 입구에서 난이도가 낮아집니다. 아래 거리와 시간은 1랩 기준이고 모든 경기는 3랩입니다. 기체에 따른 트랙 주색, 구역별 배경색, 난이도에 따른 고도 단계를 사용합니다. 환경 연출 변경만으로 기록 제작 버전을 올리지 않습니다.\n\n' +
    table(['번호 / ID', '이름', '구역', '길이 km', '난이도 /6', '고도 단계', '랩 제한 초', '전체 형태 / 특수 구간'], courses.map(({ definition: d, track }) => [
      `${number(d.order)} / \`${d.id}\``, d.name, DISTRICTS[d.district].name, (track.length / 1000).toFixed(1), d.rating, d.altitudeLevels, d.lapLimit, d.features,
    ])) +
    '\n## 추가 코스\n\n`trackCatalog.ts`에 고유 ID·선행 ID·구역·경로·고도·제한시간을 추가합니다. 기존 ID는 보존합니다. 구역이 늘어나면 `landmarkCatalog.ts`의 대표 형태·동반 형태·발광색도 지정합니다. 문서 갱신과 접근 시야·경로 간격·기본 기체 완주 검증을 실행합니다.\n',
  'LANDMARK_CATALOG.md': prefix('랜드마크 카탈로그') +
    '주변 건물보다 큰 구조물을 24개 트랙에 각 3곳, 총 72곳 배치합니다. 형태는 재사용하고 코스 ID에 따른 위치·회전·규모는 재현됩니다. [트랙 카탈로그](TRACK_CATALOG.md)와 [월드 환경](WORLD_ENVIRONMENTS.md)을 함께 참고합니다.\n\n' +
    '## 재사용하는 형태\n\n' + table(['종류 ID', '이름', '구조와 조명', '제작 높이 기준 m'], Object.entries(LANDMARK_TYPES).map(([id, spec]) => [id, spec.name, spec.description, spec.height])) +
    '\n높이 기준은 구조물 전체를 담는 제작 범위이며 정확한 건축물 실측 높이가 아닙니다. 실제 배치는 이 값에 배율을 곱합니다. 각 구조물의 조각은 본체·발광선·받침 3개 메시로 병합합니다. 일반 도시 건물과 창문은 별도의 3개 InstancedMesh를 공유합니다.\n\n' +
    '## 구역별 조합과 색상\n\n' + table(['구역', '대표 후보', '동반 1 / 동반 2', '대표 / 동반 1 / 동반 2 발광색'], Object.entries(LANDMARK_DISTRICTS).map(([district, spec]) => [
      DISTRICTS[district].name, spec.signature.map(k => LANDMARK_TYPES[k].name).join(' / '), spec.companions.map(k => LANDMARK_TYPES[k].name).join(' / '), spec.accents.map(c => `\`${c}\``).join(' / '),
    ])) +
    `\n## 배치와 표시\n\n앞·중간·뒤의 목표 위치는 ${LANDMARK_ENCOUNTERS.map(e => `${Math.round(e.fraction * 100)}%`).join(' / ')}입니다. 대표·동반 1·동반 2의 기본 배율은 ${LANDMARK_ENCOUNTERS.map(e => e.scale).join(' / ')}이며 첨탑은 원래 높아 배율을 70%로 줄입니다. 코스 곡률과 특수 구간에 따라 안전하고 잘 보이는 인근 위치를 찾습니다. 전체 주행 경로와 구조물끼리 간격을 두고, 접근 시야가 이어지는 후보만 사용합니다. 일반 건물이 접근 시야를 가리지 않도록 비웁니다.\n\n` +
    '저품질은 1,400m, 균형/고품질은 2,200m 표시 범위를 사용하며 구조물 높이를 더해 큰 실루엣이 일찍 사라지지 않게 합니다. 주행/콕핏에는 도시와 랜드마크를 표시하고 경기 중 전체 트랙 뷰에는 숨깁니다. 캠페인 선택 미리보기는 실제 주행과 같은 위치·형태를 표시합니다. 배경에는 충돌 판정이 없습니다.\n\n' +
    '## 코스별 사용\n\n각 칸은 **형태 · 배율 · 높이 기준 · 가장 가까운 경로 위치**입니다. %는 수평 거리 기준으로 가장 가까운 경로 위치이며 실제로 처음 보이는 시점과 다릅니다. 입체 교차에서는 다른 경로 구간이 더 가까울 수 있습니다. 같은 형태가 여러 번 사용되어도 규모·방향·발광색은 순서에 따라 달라집니다.\n\n' +
    table(['번호 / 트랙', '구역', '대표 구조물', '동반 1', '동반 2'], courses.map(({ definition: d, track, landmarks }) => [
      `${number(d.order)} ${d.name}`, DISTRICTS[d.district].name, ...landmarks.map(l => `${LANDMARK_TYPES[l.kind].name} · ${l.scale.toFixed(2)}× · ${Math.round(l.height)}m · ${nearestFraction(track, l)}%`),
    ])) + '\n제작 데이터: `src/game/track/landmarkCatalog.ts`. 배치/형상: `createTrackLandmark.ts`. 도시·거리 표시: `createDistrictScenery.ts`.\n',
  'WORLD_ENVIRONMENTS.md': prefix('월드 환경과 천체') +
    '환경은 [트랙](TRACK_CATALOG.md)과 [랜드마크](LANDMARK_CATALOG.md)에 덧입히는 독립적인 연출입니다. 시간대 때문에 물리·제한시간·해금·기록 버전은 바뀌지 않습니다.\n\n' +
    '## 선택과 유지\n\n캠페인 24개 트랙은 타임어택/AI 레이스 모두 경기 준비 화면 진입 때 아래 4종을 같은 확률로 선택합니다. 일시정지·재도전에서는 선택된 환경을 유지하고 경기 화면을 나갔다 다시 들어올 때 새로 선택합니다. 캠페인 트랙이 없는 자유 주행은 한밤중을 사용합니다. 현재 낮 환경과 실시간 시간대 전환은 없습니다.\n\n' +
    table(['환경 ID / 이름', '천체', '겉보기 지름 / 중심 고도 °', '천정 / 지평선 색', '안개 색 / 밀도', '별 강도'], NIGHT_ENVIRONMENTS.map(e => [
      `\`${e.id}\` / ${e.label}`, e.celestial, `${Math.round(e.celestialRadius * 360 / Math.PI)} / ${Math.round(e.celestialElevation * 180 / Math.PI)}`, `\`${e.zenith}\` / \`${e.horizon}\``, `\`${e.fog}\` / ${e.fogDensity}`, e.stars,
    ])) +
    '\n## 천체 연출\n\n천체는 지평선에 걸쳐 있는 거대한 원반으로 하늘 셰이더에 그립니다. 겉보기 지름은 60° 이상이며 시선 방향과 화면 비율에 따라 화면 밖으로 이어집니다. 달에는 어두운 바다·표면 요철·분화구를, 고리 행성에는 대기 띠와 앞뒤로 겹치는 고리를 표현합니다. 가장자리 대기층과 넓은 지평선 안개가 표면을 가려 도시 뒤의 먼 배경으로 보이게 합니다. 행성과 고리는 별도 구체 메시나 광원을 추가하지 않으며 하늘 한 번의 렌더링을 공유합니다.\n\n' +
    '하늘은 카메라 위치만 따라가며 천체 방향은 트랙 출발 방위 근처에 월드 기준으로 고정합니다. 전진·좌우 이동으로 천체가 주변 건물처럼 움직이지 않습니다. 곡선에서 시야 밖으로 사라졌다 다시 나타날 수 있으며 루프·노면 회전에서는 수평선과 함께 회전해 보입니다. PIP의 주행 뷰에도 같은 하늘을 유지하고 전체 트랙 뷰에는 표시하지 않습니다.\n\n' +
    '## 트랙별 사용 범위\n\n' + table(['구역', '사용 트랙', '선택 환경'], Object.entries(DISTRICTS).map(([id, district]) => [district.name, TRACK_CATALOG.filter(t => t.district === id).map(t => `${number(t.order)} ${t.name}`).join(' / '), '한밤중 / 깊은 밤 / 동트기 직전 / 해가 진 직후'])) +
    '\n제작 데이터: `src/game/environment/raceEnvironment.ts`. 하늘/천체: `createNightSky.ts`. 경기 진입 시 선택과 재도전 유지: `raceApp.ts`. 실제 iPhone의 GPU 프레임 시간·발열은 별도 실기 검증이 필요합니다.\n',
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
