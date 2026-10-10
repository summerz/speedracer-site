# 캠페인 모두 해금 테스트 계약

운영 빌드에서도 사용하는 숨겨진 테스트 기능이다. UI는 Claude, 진행·저장·기록 정리는 Codex가 맡는다. 마린시티 편입 후 정식 48트랙과 공유 도시 gate에 적용한다. 버전 변경과 배포는 UI 연결 뒤 사용자 요청 시 한 번만 한다.

## 화면 진입

- 격납고 기능 테스트 영역에서 `#campaign?test=1`로 진입하면 토글을 표시한다.
- URL의 `test=1`은 토글을 보여 주기만 한다. 실제 해금은 저장된 `campaign.unlockAll === true`로 결정한다.
- 플래그가 켜져 있으면 `test` 파라미터가 없어도 토글을 계속 표시한다.
- 기본 프로필과 기존 프로필은 꺼짐으로 취급한다. DEV 조건은 사용하지 않는다.
- 캠페인의 `test=1`은 주행 URL에 전달하지 않는다. 기존 `drive?...&test=1`은 기록·보상을 저장하지 않는 기능 테스트 경로이므로, 해금 토글로 열린 정식 트랙은 일반 주행 URL을 사용한다.

## API

`src/game/progression/progress.ts`:

```ts
isCampaignUnlockAll(profile: Progress): boolean
setCampaignUnlockAll(profile: Progress, on: boolean): Progress
previewRelock(profile: Progress, storage?: CampaignRecordStorage): CampaignRelockPreview[]

interface CampaignRelockPreview { mode: RaceMode; trackIds: string[] }
interface CampaignRecordStorage {
  readonly length: number;
  key(index: number): string | null;
  removeItem(key: string): void;
}
```

모두 원본 프로필을 변경하지 않는다. `setCampaignUnlockAll`은 순수 프로필 변환으로 revision을 올리며 저장·localStorage 접근은 하지 않는다. 화면에서는 이 함수 결과를 별도로 저장하지 말고 기존 `ProgressStore.command`를 사용한다.

`src/game/progression/progressStore.ts`:

```ts
createProgressStore(repository: ProgressRepository, recordStorage?: CampaignRecordStorage): ProgressStore
store.previewRelock(): CampaignRelockPreview[]
store.command({ kind: 'campaign-unlock-all', on: boolean }): Promise<Progress>
```

브라우저에서는 저장소 인수를 생략하면 localStorage를 사용한다. 화면의 확인 창은 **`store.previewRelock()`** 결과로 만든다. 프로필 기록만 조회하는 `previewRelock(profile)`와 달리 고스트·최고 기록만 남아 있는 트랙도 포함한다. 결과에는 두 모드 그룹이 항상 있으며, 실제 제거할 진행 정보가 없는 잠긴 트랙은 포함하지 않는다.

확인 문구의 `N개 트랙`은 두 모드 trackIds의 **합집합 크기**로 계산한다. 모드별 진행 건수를 표시할 때만 배열 길이를 합한다. 취소하면 command를 호출하지 않는다. 실행할 때 저장소의 최신 프로필을 다시 읽어 정리하므로 확인 이후 다른 탭에서 바뀐 진행도 최신 규칙으로 판정한다.

## 켜짐 / 다시 잠금

켜짐은 플래그만 저장한다. 가짜 통과·별·시도·보상은 만들지 않는다. `campaignStatus`는 실제 통과 트랙에 `cleared`, 나머지에는 `available`을 반환한다. 기존 직접 주행 URL 검사 역시 `campaignStatus`를 사용하므로 동일하게 열린다. 실제 주행은 평소처럼 기록·별·포인트·첫 통과 보상을 저장한다.

꺼짐은 플래그를 false로 바꾼 뒤 정식 캠페인의 order 순서로 정상 접근 조건을 판정한다. 각 트랙에서 두 모드를 먼저 정리하고 다음 트랙으로 넘어가므로, 후속 도시의 공통 gate까지 연쇄 정리할 수 있다. 자기 자신의 통과 여부는 접근 조건을 우회하지 않는다.

잠기는 트랙의 모드별 엔트리를 통째로 제거한다(통과·시도·별·최고 기록·통과 기록·모든 난이도 기록). 마지막 선택이 잠기면 같은 모드·난이도를 유지하며 첫 트랙으로 되돌린다. 정상 선행 조건을 충족한 진행, 미통과지만 접근 가능한 트랙의 기록, 알려진 트랙 목록, 폐기된/알 수 없는 트랙 ID는 유지한다.

프로필 저장이 성공한 뒤 별도 localStorage 기록을 제거한다. 모든 기체/성능·난이도·보조 여부·코스 버전·규칙 버전의 최고 기록을 해당 모드별로 지우고, 타임어택이 잠기는 트랙의 모든 고스트를 지운다. 경쟁 모드만 잠긴 경우 타임어택 고스트는 유지한다. 기능 테스트 트랙과 무관한 저장 키는 건드리지 않는다.

포인트·기체·강화·아이템·구매 상태·보상 영수증은 모두 유지한다. 재잠금은 지갑을 되돌리는 기능이 아니다.

## 저장 실패

프로필 트랜잭션이 실패하면 해금 상태와 별도 기록을 모두 유지한다. 별도 기록 제거가 실패하면 이미 저장된 프로필 상태는 반영하고 `store.issue`와 command 오류로 알려 준다. 다시 `on:false`를 실행하면 남은 기록을 재정리할 수 있다. localStorage 접근 자체가 차단된 환경에서는 프로필 기능만 동작한다.

## 검증

`tests/campaignUnlock.test.mjs`: 플래그 저장·기존 데이터 호환, 전체 트랙/양 모드 해금, 실제 보상 저장, 연쇄 재잠금, 정상 진행 유지, 지갑 보존, cache-only 미리보기, 실제 기록 키/고스트 삭제 범위, 저장 실패와 재시도.

## Marine 도시 gate 연결

`feat/marine-campaign-integration`은 도시 데이터 `67151b4`를 0.19.17의 모두 해금 토글 위에 연결한다. `campaign.ts`의 접근 조건은 다음과 같다.

- `campaignTrackUnlocked` 안에서 Marine gate를 먼저 검사하고, 이어서 predecessor를 검사한다. 이 함수는 unlockAll과 자기 자신 cleared를 무시한다.
- `campaignStatus`는 cleared → unlockAll 또는 campaignTrackUnlocked → locked 순서로 판정한다.
- `campaignCityStatus`의 Marine 잠금 조건에 `!progress.unlockAll`을 추가한다.

Marine 통합판 테스트는 `tests/campaignUnlock.test.mjs`에 있다. 특히 상대 모드의 삭제 예정 32번 기록으로 도시가 계속 열리지 않는 경우와, 어느 한 모드의 정상 32번 통과가 남아 있을 때 도시가 유지되는 경우를 검증한다. 도시 데이터 도입 전에는 미래 트랙 ID를 unknown으로 보존하며, 도입 후 정상 규칙으로 정리한다.
