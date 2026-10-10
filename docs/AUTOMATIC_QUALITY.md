# 자동 품질과 프레임 측정 — 연결 계약

2단계 로직은 `src/platform/automaticQuality.ts`에 있다. DOM·렌더러·Three.js 의존성이 없다. Codex는 측정·선호 저장·변경 알림을 제공하고, Claude는 설정 UI와 씬 적용을 연결한다. `createRace.ts`는 이 브랜치에서 수정하지 않는다.

## 공개 API

```ts
type QualityPreference = 'auto' | 'low' | 'balanced' | 'high';
type QualityReason = 'initial' | 'startup' | 'sustained' | 'manual' | 'auto';
interface FrameMetrics {
  measuredQuality: RenderQuality;
  samples: number;
  averageMs: number;
  p95Ms: number;
  fps: number;
}
interface QualityStatus {
  preference: QualityPreference;
  quality: RenderQuality;
  phase: 'warming' | 'measuring' | 'monitoring' | 'manual';
  reason: QualityReason;
  metrics: FrameMetrics | null;
}
type QualityListener = (status: QualityStatus) => void;
interface QualityStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
interface QualityPreferenceStore {
  read(): QualityPreference;
  save(value: QualityPreference): void;
}
interface AutomaticQuality {
  snapshot(): QualityStatus;
  onChange(listener: QualityListener): () => void;
  setPreference(value: QualityPreference): QualityStatus;
  sample(frameMs: number, active?: boolean): QualityStatus | null;
}
createQualityPreferenceStore(storage?: QualityStorage): QualityPreferenceStore;
createAutomaticQuality(preference?: QualityPreference): AutomaticQuality;
```

`RenderQuality`는 기존 `renderQuality.ts`의 `low | balanced | high`이다. 위의 인터페이스와 타입은 모두 export한다. `frameMs`, `averageMs`, `p95Ms` 단위는 밀리초다. `fps`는 `1000 / averageMs`이다.

- 저장 키는 `speedracer:quality`, 최초 기본값은 `auto`다. 알 수 없는 값과 저장 거부는 기본값으로 처리한다. 저장 실패 시 이번 세션의 선택은 유지한다.
- 레이스 생성 시 `createAutomaticQuality(preferences.read())`로 시작한다. 설정을 바꿀 때는 `preferences.save(value)`와 `quality.setPreference(value)`를 함께 호출한다. `localStorage` 프로퍼티 접근 자체가 거부될 수 있으므로 접근도 `try` 안에서 한다.
- `onChange`는 구독 즉시 현재 상태를 전달한다. 이후 선호 변경 또는 실제 적용 단계 변경 시 호출한다. 반환 함수로 구독을 해제한다. 렌더러·블룸·장식 수를 적용하거나 서서히 전환할 시점은 구독자 쪽에서 결정한다.
- `sample`에는 물리 스텝이나 0.1초로 제한한 값이 아닌, 실제 `requestAnimationFrame` 타임스탬프 차이를 전달한다. 주행 중이고 탭이 보일 때만 `active=true`로 넣는다. 일시정지·카운트다운·인트로·결과·숨겨진 탭에서는 `active=false`로 넣어 부분 측정을 버린다.
- 레이스마다 새 인스턴스로 측정한다. 첫 1초는 준비 시간, 다음 3초는 최초 측정이다. 자동 시작 단계는 `high`다. 평균 >30ms 또는 p95 >40ms이면 `low`, 그 외 평균 >19ms 또는 p95 >25ms이면 `balanced`, 나머지는 `high`다.
- 이후 4초 창에서 평균 >23ms 또는 p95 >35ms인 창이 두 번 연속 나오면 한 단계 낮춘다. 시작 판정·하향 뒤에는 유효 주행 시간 10초 동안 추가 하향을 막는다. 주행 중 자동 상향은 없다. 수동 선호에서는 측정만 하고 단계를 바꾸지 않는다.
- 유효하지 않은 값과 250ms 초과 간격은 탭 전환·중단으로 간주해 제외하고 1초 준비를 다시 거친다. 각 창은 최소 30개 샘플, 최대 1,000개를 유지한다. p95는 정렬한 샘플의 `ceil(n * .95)`번째 값이다.
- `sample` 반환값은 측정 창마다 나온다. 단계 변경이 없어도 보고되므로 개발 모드 콘솔에 사용할 수 있다. **`metrics.measuredQuality`는 측정 당시 단계이고 `quality`는 판정 후 적용할 단계다.** 최초 하향 보고를 새 단계의 성능으로 기록하면 안 된다.

연결 예시(수명 주기는 씬 쪽에서 관리):

```ts
let storage: Storage | undefined;
try { storage = window.localStorage; } catch { /* Optional storage. */ }
const preferences = createQualityPreferenceStore(storage);
const quality = createAutomaticQuality(preferences.read());
const unsubscribe = quality.onChange(status => applyQuality(status.quality));

// 매 렌더 프레임, 클램프하기 전 간격으로 측정.
const report = quality.sample(rawFrameMs, phase === 'running' && !document.hidden);
if (import.meta.env.DEV && report?.metrics) {
  console.info('[race-performance]', {
    trackId, preference: report.preference,
    appliedQuality: report.quality, ...report.metrics,
  });
}
// 설정 변경 시 preferences.save(value); quality.setPreference(value);
// 씬 정리 시 unsubscribe();
```

## 트랙별 기준선 절차

실제 기준선은 씬 연결 뒤 데스크톱과 실물 iPhone에서 각각 측정한다. Node 시뮬레이션과 모바일 뷰포트 에뮬레이션으로 렌더링 성능을 대신하지 않는다. 이 문서 작성 시점에는 프레임 측정 로직만 검증했으며 기기별 기준선은 아직 측정하지 않았다.

1. 프로덕션 빌드를 같은 커밋으로 실행한다. 기기 모델·OS·브라우저·화면 크기·DPR·커밋을 기록한다. 개발 콘솔 보고를 사용할 때는 개발 빌드라는 점도 함께 기록한다.
2. 모든 트랙을 같은 기체·난이도·경쟁 모드·날씨·블룸 조건으로 비교한다. 콘텐츠 차이가 생기면 조건을 새로 기록한다. 수동 `high`, `balanced`, `low`로 한 번씩 측정하고 `auto`도 확인한다.
3. 준비·카운트다운·결과 시간은 제외한다. 각 트랙의 주행 60초 이상(짧은 코스는 완주)을 기록하며 4초 창의 평균·p95·FPS를 수집한다. 동일 조건을 세 번 반복하고 창별 값의 중앙값과 가장 느린 p95를 기록한다.
4. iPhone은 충전 여부와 저전력 모드를 고정한다. 차가운 시작 상태와 10분 연속 주행 뒤 상태를 따로 기록한다. Safari가 진동을 지원하지 않으면 진동 검증란에 미지원으로 쓴다.
5. 자동 모드에서 최초 판정, 지속 저하 때 한 단계 하향, 탭 복귀·일시정지 재개 시 거짓 하향 없음, 수동 선택 유지, 화면 전환의 튐 여부를 확인한다. 실제 적용 타이밍 검증은 씬 연결 뒤에 한다.

| 커밋/빌드 | 기기·브라우저 | 트랙·조건 | 선호/측정 단계 | 샘플·주행 시간 | 평균 ms / FPS | 중앙 p95 / 최악 p95 ms | 냉간/10분 | 비고 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| — | — | — | — | — | 미측정 | 미측정 | — | 씬 연결 후 기입 |

4단계 장식을 늘릴 때는 같은 조건에서 이전 커밋과 비교한다. 최초 품질 임계값은 위 절차로 얻은 실측에 따라 조정할 수 있다. 측정과 씬 적용을 마친 뒤에만 로드맵 2단계를 완료 처리한다.

## 충돌·니어미스 진동 연결

기존 `src/game/driving/createBoostHaptics.ts` 반환 객체에 다음 메서드를 추가한다:

```ts
collision(): void;
nearMiss(): void;
```

주행 중 `DrivingState.collisions` 또는 `nearMisses`가 이전 프레임보다 늘었을 때 각 메서드를 한 번 호출한다. 초기화·재시작·씬 진입 때 이전 값을 현재 값으로 맞춘다. 활성 주행에서 기존 `update(delta, boostStage, active)`를 호출한 뒤 새 이벤트를 전달한다. 진동 설정과 터치 기기 조건은 기존 연결을 유지한다.

충돌은 `[18, 25, 12]`ms, 니어미스는 10ms로 짧게 준다. 충돌이 니어미스·고도·부스트 펄스보다 우선한다. 각각 350ms/300ms 쿨다운으로 잦은 접촉을 제한하고, 충돌 뒤 90ms·니어미스 뒤 40ms 동안 기존 펄스가 덮어쓰지 않게 한다. 부스트를 쓰지 않을 때도 단서가 유지된다. 일시정지·비활성화·정리는 진행 중 진동을 취소한다. 미지원·거부된 진동은 주행을 중단하지 않는다. 모바일 버튼 배치는 Claude 담당이다.
