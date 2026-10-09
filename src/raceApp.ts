import { RACE_CHALLENGES, challengeStars, challengeStarPenalty, type RaceChallengeId } from './game/track/raceChallenge';
import { NIGHT_ENVIRONMENTS, RAIN_INTENSITIES, selectRaceEnvironment, selectRainIntensity } from './game/environment/raceEnvironment';
import { hazardEdgeAlert } from './game/driving/hazardEdgeAlert';
import { AI_OPPONENT_COUNT } from './game/driving/aiRoster';
import { BOOST_CAPACITY } from './game/driving/createDrivingModel';
import { AWAKENING_CAPACITY } from './game/driving/awakening';
import { RIVAL_ITEMS } from './game/progression/catalog';
import type { RivalItemId } from './game/progression/catalog';
import { sfxPreference } from './game/audio/sfxPreference';
import { soundtrack } from './game/audio/soundtrack';
import { OFF_TRACK_PENALTY_POINTS, COLLISION_PENALTY_POINTS, OBSTACLE_COLLISION_PENALTY_POINTS, CLEAN_HALF_LAP_POINTS } from './game/driving/raceScoring';
import { RENDER_QUALITIES } from './platform/renderQuality';
import type { RenderQuality } from './platform/renderQuality';
import { DEFAULT_DRONE_CONFIGURATION } from './game/drone/droneConfiguration';
import type { DroneConfiguration } from './game/drone/droneConfiguration';
import { altitudeCanPass } from './game/track/altitudeProfile';
import { DIFFICULTIES } from './game/track/difficulty';
import type { DifficultyId } from './game/track/difficulty';
import { raceViewLayout } from './game/driving/createRaceViews';
import { createRace } from './game/driving/createRace';
import { finishSplash, introTitle } from './game/driving/raceCinematic';
import type { RaceMode } from './game/driving/createRaceSession';
import type { Race, RaceSnapshot } from './game/driving/createRace';
import './race.css';
import './campaign.css';
import { TRACK_CATALOG, DISTRICTS, campaignRankLimit } from './game/track/trackCatalog';
import { trackPreset } from './game/track/trackRuntime';
import type { TrackDefinition } from './game/track/trackCatalog';
import type { CampaignOutcome } from './game/progression/campaign';
import type { ProgressStore } from './game/progression/progressStore';
import type { RewardInput } from './game/progression/progress';
import './shop.css';
import { createRaceAnalytics } from './platform/analytics';
import { gameAnalytics } from './platform/gameAnalytics';
import { formatDelta } from './game/driving/raceGhost';

const formatTime = (seconds: number) => {
  const ms = Math.round(Math.max(0, seconds) * 1000);
  return `${Math.floor(ms / 60000).toString().padStart(2, '0')}:${Math.floor(ms / 1000 % 60).toString().padStart(2, '0')}.${(ms % 1000).toString().padStart(3, '0')}`;
};

export function mountRace(root: HTMLDivElement, onExit: () => void, configuration: DroneConfiguration = DEFAULT_DRONE_CONFIGURATION, store?: ProgressStore, onShop?: () => void, campaign?: { track: TrackDefinition; mode: RaceMode; challenge: RaceChallengeId }): () => void {
  let focusSlots = store ? Math.min(store.snapshot().focusSlots, store.snapshot().focus) : 0;
  document.title = 'Speedracer — 타임어택';
  root.innerHTML = `
    <main class="drive-screen">
      <div id="race-scene" class="race-scene"></div>
      <div id="race-impact" class="race-impact" aria-hidden="true"></div>
      <div id="race-boost-flash" class="race-boost-flash" aria-hidden="true"></div>
      <div class="hazard-edges" aria-hidden="true"><i id="edge-left" class="hazard-edge" data-side="left" hidden></i><i id="edge-right" class="hazard-edge" data-side="right" hidden></i><b id="edge-arrow" class="hazard-arrow" hidden></b><i id="height-edge" class="hazard-edge" hidden></i></div>
      <section id="race-intro" class="race-intro" aria-label="코스 소개" hidden><p class="intro-eyebrow"></p><h2 class="intro-name"></h2><p class="intro-meta"></p><p class="intro-skip">건너뛰기 · 아무 키나 탭</p></section>
      <div id="race-splash" class="race-splash" role="status" hidden><strong></strong><span></span><em></em></div>
      <header class="race-header">
        <div class="race-telemetry" aria-label="주행 정보"><div class="telemetry-row"><span class="speed-readout" aria-label="현재 주행 속도"><strong id="drive-speed">000</strong><span class="speed-unit mono"><small>속도</small>km/h</span></span><span id="race-rank" class="rank-readout mono" hidden></span><span id="race-lap" class="lap-readout mono">LAP 1/3</span><time id="drive-time" class="mono">00:00.000</time><span id="race-ghost" class="ghost-delta mono" aria-label="고스트와의 시간 차이" hidden></span></div><div class="corner-guide"><span id="lap-deadline" hidden></span><strong id="corner-text">직선</strong><span class="corner-hint">급한 코너에서는 S로 감속</span></div></div>
      </header>
      <button type="button" id="race-pause" class="race-pause" aria-label="일시정지 메뉴" aria-keyshortcuts="Escape" aria-controls="drive-overlay" aria-expanded="false"><span aria-hidden="true">Ⅱ</span><kbd class="key-badge">Esc</kbd></button>
      <div class="driving-overlay"><div id="race-announcement" class="race-announcement" role="status" aria-live="polite" hidden><strong></strong><span></span><em id="race-clean" hidden>클린 +${CLEAN_HALF_LAP_POINTS}P</em></div><p id="race-callout" class="race-callout" role="status" hidden></p><p id="race-nearmiss" class="race-nearmiss" aria-hidden="true" hidden>NEAR MISS</p><p id="race-streak" class="race-streak" aria-hidden="true" hidden></p><p id="race-notice" class="race-notice" role="status" aria-live="polite"></p><div id="race-countdown" class="race-countdown" role="status" aria-live="assertive" hidden><span>READY</span><strong>3</strong></div>
      <div class="race-items"><button id="race-focus" type="button" class="race-focus" aria-keyshortcuts="V" hidden>집중 모드<kbd class="key-badge">V</kbd></button>${RIVAL_ITEMS.map(item => `<button type="button" id="race-${item.id}" class="race-focus" data-use-item="${item.id}" hidden>${item.name}</button>`).join('')}</div><p id="focus-feedback" class="focus-feedback" role="status" aria-live="polite"></p><footer class="drive-hud" aria-label="고도와 부스트 계기판">
        <aside class="height-guide" aria-label="고도 안내: 선택 단계, 민트색 통과 가능, 빨강 통과 불가, 주황 전환 중"><div id="height-level" class="height-bars"></div><strong id="height-instruction"></strong></aside>
        <div class="awakening-control"><div class="awakening-heading"><strong id="awakening-label">각성</strong><kbd class="key-badge">W</kbd></div><div id="race-awakening" class="awakening-cores" role="group" aria-label="각성 코어 보관함">${Array.from({ length: AWAKENING_CAPACITY }, () => `<button type="button" data-awakening-core aria-keyshortcuts="W" disabled hidden><svg viewBox="0 0 32 36" aria-hidden="true"><path class="cube-top" d="M16 2 30 10 16 18 2 10Z"/><path class="cube-left" d="M2 10 16 18 16 34 2 26Z"/><path class="cube-right" d="M16 18 30 10 30 26 16 34Z"/></svg></button>`).join('')}<span id="awakening-empty" class="awakening-empty" aria-hidden="true">코어 없음</span></div><span id="awakening-status" role="status" aria-live="polite">황금 코어를 획득하세요</span></div>
        <div class="boost-readout"><div class="hud-pair"><span class="hud-label">BOOST</span><span id="boost-value" class="mono">100%</span></div><div id="boost-meter" class="boost-meter" role="progressbar" aria-label="부스트 잔량 (50%씩 3칸, 최대 150%)" aria-valuemin="0" aria-valuemax="150" aria-valuenow="100"><span></span></div><div id="boost-stage-meter" class="boost-stage-meter" role="progressbar" aria-label="부스트 2단계 축적" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span></span></div><span id="boost-status">Space 유지 · 3초 후 2단계</span></div>
      <p id="race-fork" class="fork-guide" hidden></p></footer></div>
      <section id="drive-overlay" class="drive-overlay" aria-labelledby="drive-overlay-title">
        <div class="drive-dialog">
          <p id="race-mode-title" class="eyebrow">NEON CIRCUIT · TIME ATTACK</p><h1 id="race-course-name" class="race-course-name"></h1><h2 id="drive-overlay-title">레이스 준비</h2>
          <nav class="race-flow-actions" aria-label="경기 진행">
            <button id="campaign-next" type="button" class="primary-action" hidden>다음 트랙 ↗</button>
            <button type="button" id="drive-start" class="primary-action">레이스 시작 <span aria-hidden="true">↗</span></button>
            <button type="button" id="race-hangar" class="race-exit">캠페인으로</button>
            <button id="result-shop" type="button" class="race-exit" hidden>상점으로 ↗</button>
            <button type="button" id="race-restart" class="race-exit" aria-keyshortcuts="R" hidden>처음부터 다시 <kbd class="key-badge">R</kbd></button>
          </nav>
          <p id="drive-overlay-copy"></p>
          <p id="pause-summary" class="pause-summary" hidden></p>
          <section id="race-result" class="race-result" aria-label="경기 결과" hidden><p id="result-status" class="result-status"></p><time id="result-total" class="result-total"></time><div id="result-reward" class="reward-summary" role="status" aria-live="polite"></div><p id="campaign-result" role="status"></p><button id="reward-retry" type="button" hidden>보상 저장 다시 시도</button><p id="result-penalties"></p><ol id="result-laps" class="result-laps"></ol><p id="result-best"></p><div id="competition-results" hidden><p id="standings-status"></p><ol id="race-standings" class="race-standings" aria-label="참가자 순위"></ol></div><p id="record-warning" class="record-warning" hidden>기록을 저장하지 못했습니다. 이번 화면에서 확인할 수 있습니다.</p></section>
          <fieldset id="race-mode-picker" class="difficulty-picker mode-picker"><legend>경기 방식</legend><div><label><input type="radio" name="race-mode" value="time-attack" checked /><span>타임어택</span></label><label><input type="radio" name="race-mode" value="competition" /><span>경쟁 레이스 · ${AI_OPPONENT_COUNT + 1}대</span></label></div></fieldset>
          <fieldset id="difficulty-picker" class="difficulty-picker"><legend>난이도</legend><div><label><input type="radio" name="difficulty" value="beginner" checked /><span>초급</span></label><label><input type="radio" name="difficulty" value="intermediate" /><span>중급</span></label><label><input type="radio" name="difficulty" value="advanced" /><span>고급</span></label></div></fieldset><p id="difficulty-description" class="difficulty-description"></p>
          <section id="ai-roster" class="ai-roster" aria-label="이번 경기 상대 선수" hidden><p class="eyebrow">이번 경기 상대</p><ol id="ai-roster-list"></ol></section>
          <p id="ready-best" class="ready-best"></p><p class="shop-hint" id="race-loadout"></p>
          ${import.meta.env.DEV ? '<div id="dev-weather" class="race-actions dev-weather"><button id="dev-rain-toggle" type="button" aria-pressed="true"><span>비 테스트 <small>개발 환경</small></span><strong id="dev-rain-state">켜짐</strong></button></div>' : ''}
          <div class="menu-preview"><span>시점 전환</span><div class="race-actions"><button type="button" id="race-view" aria-keyshortcuts="C">콕핏 보기 <kbd class="key-badge">C</kbd></button><button type="button" id="race-track" aria-keyshortcuts="X">트랙 PIP 보기 <kbd class="key-badge">X</kbd></button></div></div>
          <nav class="race-actions menu-actions" aria-label="주행 메뉴">
            <button type="button" id="race-settings" aria-keyshortcuts="S">설정 · 조작 안내 <kbd class="key-badge">S</kbd></button>
          </nav>
          <div class="app-tools" data-app-tools></div>
        </div>
      </section>
      <nav id="view-preview" class="view-preview" aria-label="정지 상태에서 시점 미리보기" hidden>
        <p>시점 미리보기 <span>· 주행 정지</span></p><div><button type="button" id="preview-view" aria-keyshortcuts="C">콕핏 보기 <kbd class="key-badge">C</kbd></button><button type="button" id="preview-track" aria-keyshortcuts="X">트랙 PIP 보기 <kbd class="key-badge">X</kbd></button><button type="button" id="preview-back" aria-keyshortcuts="Escape">메뉴로 <kbd class="key-badge">Esc</kbd></button></div>
      </nav>
      <dialog id="race-preferences" class="race-preferences" aria-labelledby="preferences-title">
        <header><h2 id="preferences-title">설정</h2><button type="button" id="preferences-close" aria-label="설정 닫기">닫기</button></header>
        <div class="preference-options"><button type="button" id="race-bloom" aria-pressed="true"><span>네온 발광 <small>Bloom</small></span></button><button type="button" id="race-sound" aria-pressed="true" aria-keyshortcuts="N"><span>주행 효과음 <kbd class="key-badge">N</kbd></span></button><button type="button" id="race-music" aria-pressed="true" aria-keyshortcuts="M"><span>배경 음악 <kbd class="key-badge">M</kbd> <small>로비 1곡 · 경주 8곡</small></span></button><button type="button" id="race-haptics" aria-pressed="true"><span>진동</span></button></div>
        <div class="render-options"><label for="race-quality">렌더링 품질</label><select id="race-quality">${Object.entries(RENDER_QUALITIES).map(([id, option]) => `<option value="${id}" ${id === 'balanced' ? 'selected' : ''}>${option.label}</option>`).join('')}</select></div>
        <div class="preference-options"><button type="button" id="race-haze" aria-pressed="false"><span>배기 아지랑이 <small>추적 시점</small></span></button></div>
        <p class="quality-hint">아지랑이는 배기 주변에만 적용합니다. 성능이 낮으면 끄거나 ‘성능 우선’을 선택하세요.</p>
        <details class="control-help"><summary>조작 안내</summary>
          <p class="touch-help">메뉴: 화살표로 이동 · Enter로 선택. 게임패드: 방향 패드/스틱으로 이동 · A 선택 · B 돌아가기.<br />주행: 왼쪽 스틱 조향 · 방향 패드 ↑/↓ 고도 · LT 감속 · RT/RB 부스트 · X 콕핏 · Y 트랙 뷰 · LB 아이템 · Start 일시정지/계속.</p>
          <div class="drive-keys"><span>자동 가속 · <kbd>S</kbd> 감속</span><span><kbd>A</kbd> <kbd>D</kbd> 좌우 조향</span><span><kbd>↓</kbd> <kbd>↑</kbd> 고도 한 단계 전환</span><span><kbd>Space</kbd> 길게 눌러 부스트</span><span><kbd>W</kbd> 코어 각성</span><span><kbd>C</kbd> 기체·콕핏 전환</span><span><kbd>X</kbd> 트랙 PIP·자리 교환·닫기</span><span><kbd>V</kbd> 아이템 사용</span><span><kbd>Esc</kbd> 일시정지·계속하기</span><span>대기·일시정지 중 <kbd>S</kbd> 설정</span></div>
          <p class="touch-help">자동으로 가속합니다. 왼쪽 조이스틱은 좌우 조향, 아래로 당기면 감속합니다. 대각선으로 두 조작을 함께 할 수 있습니다.<br />오른쪽 BOOST를 누른 채 위로 길게 밀수록 높게, 아래로 밀수록 낮게 고도를 선택합니다. 여러 단계도 한 번에 바꿀 수 있습니다. 손을 떼면 선택한 고도는 유지하고 부스트만 해제합니다. ↑/↓만 누르면 부스트 없이 고도를 바꿉니다. ${(configuration.performance.boostStage2Threshold / configuration.performance.boostDrain).toFixed(1)}초 연속 부스트 시 2단계에 진입합니다.<br />시점은 일시정지 메뉴의 시점 전환에서 바꿀 수 있습니다.</p>
          <p>중간·어려움: 주황 방전 구역은 모든 고도에서 위험합니다. 민트색 화살표를 따라 왼쪽·가운데·오른쪽 통로로 이동하세요. 자홍색 전기 지뢰밭은 모든 고도에서 위험하니, 기둥 사이 빈틈으로 통과하세요.</p>
          <p>황금색 정육면체 각성 코어는 랩마다 하나씩 나오고 최대 3개까지 보관합니다. 부스트 위의 코어를 터치하거나 W로 한 개를 사용하면 5초간 기체가 변신해 자동 주행합니다. 2단 부스트 최고속도보다 5% 빠르고 충돌 감속이 없습니다. 부스트 잔량은 그대로 보관합니다.</p>
          <p>부스트는 50%씩 세 칸으로 표시하며, 자연 충전과 아이템으로 최대 150%까지 모을 수 있습니다. 한 번에 최대 두 칸(100%)을 사용하고, 남은 잔량은 버튼이나 Space를 놓았다가 다시 누르면 사용할 수 있습니다.</p>
        </details>
      </dialog>
      <dialog id="race-restart-confirm" class="race-preferences restart-confirm" aria-labelledby="restart-title" aria-describedby="restart-copy">
        <header><h2 id="restart-title">처음부터 다시 시작할까요?</h2></header>
        <p id="restart-copy">완주 전 기록과 포인트는 저장되지 않습니다.</p>
        <div class="restart-actions"><button type="button" id="restart-cancel" autofocus>취소</button><button type="button" id="restart-accept" class="primary-action">다시 시작</button></div>
      </dialog>
      <section id="drive-error" class="drive-overlay" role="alert" hidden><div class="drive-dialog"><h2>3D 화면 연결이<br />끊어졌습니다.</h2><p>다시 불러온 후 주행을 시작해주세요.</p><button type="button" id="drive-retry" class="primary-action">다시 불러오기</button></div></section>
    </main>`;
  const get = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const overlay = get('drive-overlay');
  const menuDialog = overlay.querySelector<HTMLElement>('.drive-dialog')!;
  const startButton = get<HTMLButtonElement>('drive-start');
  const pauseButton = get<HTMLButtonElement>('race-pause');
  const bloomButton = get<HTMLButtonElement>('race-bloom');
  const qualitySelect = get<HTMLSelectElement>('race-quality');
  const hazeButton = get<HTMLButtonElement>('race-haze');
  const soundButton = get<HTMLButtonElement>('race-sound');
  const musicButton = get<HTMLButtonElement>('race-music');
  musicButton.setAttribute('aria-pressed', String(soundtrack.enabled));
  soundButton.setAttribute('aria-pressed', String(sfxPreference.enabled));
  const hapticsButton = get<HTMLButtonElement>('race-haptics');
  const coarsePointer = window.matchMedia('(any-pointer: coarse)');
  const refreshHaptics = () => {
    hapticsButton.hidden = !coarsePointer.matches || typeof navigator.vibrate !== 'function';
    root.querySelector('.corner-guide span:last-child')!.textContent = coarsePointer.matches ? '급한 코너에서는 조이스틱을 아래로' : '급한 코너에서는 S로 감속';
  };
  refreshHaptics();
  const stageMeter = get('boost-stage-meter');
  const stageFill = stageMeter.querySelector('span')!;
  const meter = get('boost-meter');
  const meterFill = meter.querySelector('span')!;
  const speed = get('drive-speed');
  const charge = get('boost-value');
  const boostStatus = get('boost-status');
  const time = get('drive-time');
  const ghostDeltaEl = get('race-ghost'); let ghostShownAt = 0;
  const corner = get('corner-text');
  const notice = get('race-notice');
  const heightBars = get('height-level');
  const drivingOverlay = root.querySelector<HTMLElement>('.driving-overlay')!;
  const screen = root.querySelector<HTMLElement>('.drive-screen')!;
  const heightInstruction = get('height-instruction');
  const heightGuide = root.querySelector<HTMLElement>('.height-guide')!;
  let selectedDifficulty: DifficultyId = campaign ? trackPreset(campaign.track).id : 'beginner';
  const challenge = campaign?.challenge ?? 'normal';
  let selectedMode: RaceMode = campaign?.mode ?? 'time-attack';
  const defaultEnvironment = selectRaceEnvironment(campaign?.track.district);
  const rainToggle = root.querySelector<HTMLButtonElement>('#dev-rain-toggle');
  let previewRain = true;
  if (import.meta.env.DEV) {
    try { previewRain = sessionStorage.getItem('speedracer.dev.rain') !== 'off'; } catch { /* Optional preview preference. */ }
  }
  let itemStates: RaceSnapshot['timeAttack']['items'] = [];
  let equippedRivalSlots: RivalItemId[] = [];
  let campaignOutcome: CampaignOutcome | undefined;
  let standingsKey = '';
  const restartConfirm = get<HTMLDialogElement>('race-restart-confirm');
  let lastPhase = '';
  let introPending = true; let cinematicKind = ''; let cinematicEndedAt = 0;
  let rewardInput: RewardInput | undefined; let rewardPending = false; let focusPending = false; let canFocus = false; let activeRaceId = '';
  let screenDisposed = false; let focusSerial = 0; let focusMessageUntil = 0;
  const saveReward = async () => {
    if (!store || !rewardInput || rewardPending) return;
    const input = rewardInput; rewardPending = true; get('reward-retry').hidden = true;
    try {
      const outcome = campaignOutcome;
      const profile = await store.command(outcome ? { kind: 'campaign-result', input, outcome } : { kind: 'reward', input });
      if (screenDisposed || rewardInput?.raceId !== input.raceId) return;
      const r = profile.rewards[input.raceId];
      const rank = selectedMode === 'competition' ? outcome?.rank ?? input.rank : undefined;
      get('result-reward').innerHTML = `<div class="reward-total"><span>이번 경기 획득</span><strong>+${r.total.toLocaleString()} <small>P</small></strong></div><p class="reward-balance">보유 ${profile.balance.toLocaleString()} P</p>${rank ? `<p class="reward-placement">${rank}위 · 순위 보너스 +${r.placement ?? 0} P</p>` : ''}<details class="reward-breakdown"><summary>보상 내역</summary><dl><div><dt>${outcome?.disqualified ? '실격' : '완주'}${r.assisted ? ' · 보조 80%' : ''}</dt><dd>+${r.base} P</dd></div><div><dt>클린 · 장애물 통과</dt><dd>+${r.clean + (r.obstacles ?? 0)} P</dd></div>${r.best ? `<div><dt>신기록</dt><dd>+${r.best} P</dd></div>` : ''}${r.bonus ? `<div><dt>첫 통과</dt><dd>+${r.bonus} P</dd></div>` : ''}${r.placement ? `<div><dt>순위</dt><dd>+${r.placement} P</dd></div>` : ''}${r.penalty ? `<div><dt>벌점</dt><dd>−${r.penalty} P</dd></div>` : ''}</dl></details>`;
      if (campaign) {
        const passed = !!outcome && !outcome.disqualified && outcome.laps.length === campaign.track.laps && (selectedMode === 'competition' ? outcome.rank <= campaignRankLimit(campaign.track) : outcome.laps.every(lap => lap <= outcome.lapLimit));
        const next = TRACK_CATALOG.find(t => t.predecessor === campaign.track.id);
        const stars = outcome ? challengeStars(selectedMode, campaign.track, challenge, outcome) : 0;
        get('campaign-result').textContent = passed ? `${'★'.repeat(stars)}${'☆'.repeat(3 - stars)} · ${RACE_CHALLENGES[challenge].label} · ` + (next ? '트랙 통과 · 다음 코스가 열렸습니다.' : '캠페인 완주 · 모든 코스를 통과했습니다.') : outcome?.disqualified ? '랩 제한시간 초과 · 다시 도전하세요.' : selectedMode === 'competition' ? `${campaignRankLimit(campaign.track)}위 이내로 완주하면 다음 코스가 열립니다.` : '모든 랩을 제한시간 안에 완주하면 다음 코스가 열립니다.';
        if (passed && outcome) get('campaign-result').textContent += ` · 별점 감점 ${challengeStarPenalty(outcome, campaign.track.laps).toFixed(1)}점/랩`;
        get('campaign-next').hidden = !passed || !next;
        if (passed && next && document.activeElement === startButton && lastPhase === 'finished') get('campaign-next').focus({ preventScroll: true });
      }
    } catch (error) {
      if (!screenDisposed && rewardInput?.raceId === input.raceId) { get('result-reward').textContent = `보상을 저장하지 못했습니다. ${error instanceof Error ? error.message : ''}`; get('reward-retry').hidden = false; }
    } finally { rewardPending = false; if (!screenDisposed && rewardInput && rewardInput.raceId !== input.raceId) void saveReward(); }
  };
  get('race-loadout').textContent = focusSlots ? `보조 타임어택 · 집중 모드 ${focusSlots}개 · 기본 보상 80%` : '일반 타임어택 · 코스에서 각성 코어 획득';
  let lastViewKey = '';
  let previewing = false;
  const preferences = get<HTMLDialogElement>('race-preferences');
  const paintMenu = () => {
    const racing = lastPhase === 'running' || lastPhase === 'countdown';
    overlay.hidden = racing || previewing || lost || !!cinematicKind;
    get('view-preview').hidden = racing || !previewing || lost;
    screen.dataset.preview = String(previewing);
    pauseButton.innerHTML = `<span aria-hidden="true">${previewing ? '×' : lastPhase === 'paused' ? '▶' : 'Ⅱ'}</span><kbd class="key-badge">Esc</kbd>`;
    pauseButton.setAttribute('aria-label', previewing ? '메뉴로 돌아가기' : lastPhase === 'paused' ? '주행 계속하기' : '일시정지 메뉴');
    pauseButton.setAttribute('aria-expanded', String(lastPhase === 'paused' && !previewing));
    pauseButton.disabled = (lastPhase === 'ready' || lastPhase === 'finished') && !previewing;
  };
  const leavePreview = () => { previewing = false; paintMenu(); startButton.focus({ preventScroll: true }); };
  let lastCollisions = 0;
  let impactAnimation: Animation | undefined;
  let boostFlashAnimation: Animation | undefined;
  let lastBoostStage = 0;
  let lastAnnouncement = 0; let lastCallout = 0; let lastNearMisses = 0; let lastStreak = 0;
  let lost = false;
  let previousLevel = -1;
  let highlightUntil = 0;
  let overlayLayout = '';
  const analytics = createRaceAnalytics(gameAnalytics.send);
  const update = (state: RaceSnapshot) => {
    const attackResult = state.timeAttack;
    const stars = campaign && state.phase === 'finished' ? challengeStars(selectedMode, campaign.track, challenge, {
      laps: attackResult.lapTimes, rank: state.competition?.playerRank ?? 1, disqualified: attackResult.disqualified,
      collisions: state.collisions, offTrackExits: state.offTrackExits,
    }) : 0;
    analytics.observe({ id: attackResult.raceId, phase: state.phase, seconds: state.elapsed,
      laps: attackResult.lapTimes.length, collisions: state.collisions, exits: state.offTrackExits,
      obstacles: state.obstaclesPassed, success: campaign ? stars > 0 : !attackResult.disqualified,
      disqualified: attackResult.disqualified, rank: state.competition?.playerRank ?? 1, stars,
    }, { track_id: campaign?.track.id ?? 'practice', race_mode: selectedMode,
      difficulty: campaign ? challenge : selectedDifficulty, ship_id: configuration.id,
      control_type: coarsePointer.matches ? 'touch' : 'desktop' });
    const viewKey = `${state.view}/${state.trackDisplay}`;
    if (lastViewKey && lastViewKey !== viewKey && ['ready', 'paused', 'finished'].includes(state.phase) && !lost) previewing = true;
    lastViewKey = viewKey;
    const cameraAction = state.view === 'cockpit' ? '기체 보기' : '콕핏 보기';
    const trackAction = state.trackDisplay === 'hidden' ? '트랙 PIP 보기' : state.trackDisplay === 'pip' ? '트랙을 크게 보기' : '주행 화면만 보기';
    for (const id of ['race-view', 'preview-view']) get(id).innerHTML = `${cameraAction} <kbd class="key-badge">C</kbd>`;
    for (const id of ['race-track', 'preview-track']) get(id).innerHTML = `${trackAction} <kbd class="key-badge">X</kbd>`;
    get('pause-summary').textContent = `${RACE_CHALLENGES[challenge].label} · ${formatTime(state.elapsed)}`;
    const attack = state.timeAttack;
    const competition = state.competition;
    get('race-rank').hidden = !competition;
    get('race-rank').textContent = competition ? `${competition.playerRank} / ${competition.standings.length}` : '';
    get('race-rank').setAttribute('aria-label', competition ? `${competition.standings.length}대 중 ${competition.playerRank}위` : '');
    get('competition-results').hidden = !competition;
    get('ai-roster').hidden = !competition || state.phase !== 'ready';
    if (competition && state.phase === 'ready') {
      const opponents = competition.standings.filter(p => !p.player);
      const key = opponents.map(p => p.id).join('/');
      if (get('ai-roster-list').dataset.roster !== key) {
        get('ai-roster-list').dataset.roster = key;
        get('ai-roster-list').innerHTML = opponents.map(p => `<li><i style="background:${p.color}" aria-hidden="true"></i><span><strong>${p.name}</strong><small>${p.craftName} · ${p.style}</small></span><span class="ai-rating" aria-label="실력 6단계 중 ${p.rating}">실력 ${p.rating}/6</span></li>`).join('');
      }
    }
    if (competition && state.phase === 'finished') {
      const key = JSON.stringify(competition.standings.map(p => [p.id, p.rank, p.finishTime, p.completedLaps]));
      if (key !== standingsKey) {
        standingsKey = key;
        get('standings-status').textContent = competition.complete ? 'FINAL STANDINGS · 최종 순위' : '내 순위 확정 · 나머지 기체 주행 중';
        get('race-standings').innerHTML = competition.standings.map(p => `<li class="${p.player ? 'is-player' : ''}"><strong>${p.rank}</strong><span class="standing-name"><i style="background:${p.color}"></i><span>${p.name}${p.player ? ' · 나' : `<small>${p.craftName} · ${p.style}</small>`}</span></span><time>${p.finishTime === null ? `LAP ${Math.min(attack.totalLaps, p.completedLaps + 1)}/${attack.totalLaps}` : formatTime(p.finishTime)}</time></li>`).join('');
      }
    }
    activeRaceId = attack.raceId; canFocus = attack.canFocus; itemStates = attack.items;
    const focus = get<HTMLButtonElement>('race-focus');
    focus.hidden = !focusSlots || state.phase !== 'running'; focus.disabled = !canFocus || focusPending;
    focus.innerHTML = `${attack.focusRemaining > 0 ? `집중 ${attack.focusRemaining.toFixed(1)}s` : `집중 ${focusSlots - attack.focusUsed}`}<kbd class="key-badge">V</kbd>`;
    for (const item of RIVAL_ITEMS) {
      const status = attack.items.find(entry => entry.id === item.id)!;
      const button = get<HTMLButtonElement>(`race-${item.id}`);
      button.hidden = !equippedRivalSlots.includes(item.id) || state.phase !== 'running';
      button.disabled = !status.canUse || focusPending;
      button.textContent = status.active > 1e-8 ? `${item.name} ${status.active.toFixed(1)}s` : `${item.name} ${status.remaining}${attack.itemCooldown > 0 ? ` · ${attack.itemCooldown.toFixed(1)}s` : status.remaining > 0 && !status.targets.length ? ' · 대상 없음' : ''}`;
    }
    get('focus-feedback').hidden = !focusPending && performance.now() >= focusMessageUntil;
    screen.classList.toggle('is-focused', attack.focusRemaining > 0 && state.phase === 'running');
    const deadline = get('lap-deadline'); deadline.hidden = !campaign || selectedMode !== 'time-attack';
    if (attack.lapLimit) deadline.textContent = `남은 시간 ${Math.max(0, attack.lapLimit - (state.elapsed - attack.lapTimes.reduce((a, b) => a + b, 0))).toFixed(1)}s`;
    get('race-lap').textContent = `LAP ${attack.lap}/${attack.totalLaps}`;
    get('race-lap').setAttribute('aria-label', `${attack.totalLaps}랩 중 ${attack.lap}랩`);
    get('ready-best').textContent = attack.bestRecord ? `최고 기록 ${formatTime(attack.bestRecord.total)}` : `${attack.totalLaps}랩 · 아직 최고 기록이 없습니다`;
    get('race-countdown').hidden = state.phase !== 'countdown' && !(state.phase === 'running' && state.elapsed < 0.65);
    get('race-countdown').querySelector('strong')!.textContent = state.phase === 'running' ? 'GO' : String(attack.countdown);
    get('race-countdown').querySelector('span')!.textContent = state.phase === 'running' ? 'RACE START' : 'READY';
    if (state.phase === 'finished' && lastPhase !== 'finished') {
      get('result-status').textContent = competition ? `${competition.playerRank}위 · COMPETITION RACE COMPLETE` : attack.result?.isNewBest ? 'NEW BEST · 최고 기록 갱신' : attack.disqualified ? 'TIME LIMIT · 실격' : `${attack.totalLaps} LAPS COMPLETE`;
      get('result-total').textContent = formatTime(state.elapsed);
      get('result-laps').innerHTML = attack.lapTimes.map((lap, i) => `<li><span>LAP ${i + 1}</span><time>${formatTime(lap)}</time></li>`).join('');
      get('result-best').textContent = attack.result ? `최고 기록 ${formatTime(attack.result.best.total)}` : selectedMode === 'time-attack' ? '제한시간 안에 매 랩을 완주해야 합니다.' : '';
      get('result-best').hidden = !attack.result && selectedMode === 'competition';
      get('result-penalties').textContent = state.penaltyPoints ? `코스 이탈 ${state.offTrackExits}회 · 충돌 ${state.collisions}회 · 벌점 -${state.penaltyPoints}P` : '';
      get('result-penalties').hidden = state.penaltyPoints === 0;
      get('record-warning').hidden = !attack.result || attack.result.saved;
      get('campaign-next').hidden = true;
      get('campaign-result').textContent = campaign ? '캠페인 결과를 저장하고 있습니다…' : '';
      campaignOutcome = campaign ? { mode: selectedMode, trackId: campaign.track.id, revision: campaign.track.revision, total: state.elapsed, laps: attack.lapTimes, rank: competition?.playerRank ?? 1, disqualified: attack.disqualified, assisted: attack.assisted, lapLimit: attack.lapLimit ?? 1, challenge, collisions: state.collisions, offTrackExits: state.offTrackExits } : undefined;
      get('result-shop').hidden = !onShop;
      rewardInput = { raceId: attack.raceId, mode: selectedMode, rank: selectedMode === 'competition' ? competition?.playerRank : undefined, difficulty: selectedDifficulty, collisions: state.collisions, offTrackExits: state.offTrackExits, recoveries: state.recoveries, penaltyPoints: state.penaltyPoints, obstaclesPassed: state.obstaclesPassed, cleanHalfLaps: attack.cleanHalfLaps, improvedExistingBest: !!attack.result?.improvedExistingBest, assisted: attack.assisted };
      get('result-reward').textContent = store ? '완주 보상을 저장하고 있습니다…' : '';
      void saveReward();
    }
    if (state.collisions > lastCollisions && (state.notice === 'height-collision' || state.notice === 'craft-collision' || state.notice === 'corridor-collision')) {
      const flash = get('race-impact');
      flash.style.setProperty('--impact-color', state.notice === 'corridor-collision' ? '255, 142, 65' : state.notice === 'craft-collision' ? '185, 236, 255' : state.heightObstacle?.kind === 'descend' ? '95, 170, 255' : '201, 132, 255');
      impactAnimation?.cancel();
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      impactAnimation = flash.animate([{ opacity: 0 }, { opacity: reduced ? 0.08 : 0.26, offset: 0.12 }, { opacity: 0 }], { duration: reduced ? 400 : 280 });
    }
    lastCollisions = state.collisions;
    if (state.phase === 'running' && state.boostStage === 2 && lastBoostStage !== 2) {
      boostFlashAnimation?.cancel();
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      boostFlashAnimation = get('race-boost-flash').animate([
        { opacity: 0 }, { opacity: reduced ? 0.07 : 0.38, offset: 0.1 }, { opacity: 0 },
      ], { duration: reduced ? 350 : 240 });
    }
    lastBoostStage = state.boostStage;
    if (state.phase !== 'running') boostFlashAnimation?.cancel();
    // Callouts, near miss and clean streak: opacity only under reduced motion; no shatter then.
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pop = (el: HTMLElement, ms: number, from: string, to: string) => {
      el.getAnimations().forEach(a => a.cancel()); el.hidden = false;
      const move = (y: string, scale: number) => still ? '' : `translate(-50%,${y}) scale(${scale})`;
      el.animate([{ opacity: 0, transform: move(from, .85) }, { opacity: 1, transform: move(from, 1.05), offset: .12 }, { opacity: 1, transform: move(to, 1), offset: .75 }, { opacity: 0, transform: move(to, 1) }],
        { duration: ms }).onfinish = () => { el.hidden = true; };
    };
    if (state.callout && state.callout.id !== lastCallout) {
      lastCallout = state.callout.id; const el = get('race-callout');
      el.textContent = state.callout.text; el.dataset.kind = state.callout.kind; pop(el, 1400, '6px', '0px');
    }
    if (state.nearMisses > lastNearMisses && state.phase === 'running') pop(get('race-nearmiss'), 700, '8px', '-10px');
    lastNearMisses = state.nearMisses;
    if (state.cleanStreak !== lastStreak) {
      const streak = get('race-streak'), n = state.cleanStreak, broke = n < lastStreak && lastStreak >= 2 && state.phase === 'running';
      lastStreak = n; streak.getAnimations().forEach(a => a.cancel());
      if (n >= 2) { streak.hidden = false; streak.textContent = `CLEAN ×${n}`; streak.dataset.tier = String(Number(n >= 5) + Number(n >= 10) + Number(n >= 20)); }
      else if (broke && !still) {
        streak.animate([{ opacity: 1, transform: 'none', filter: 'none' }, { opacity: 1, transform: 'translateX(-4px) skewX(-8deg)', offset: .2 },
          { opacity: 0, transform: 'translate(10px,14px) skewX(12deg) scale(1.25)', letterSpacing: '10px', filter: 'blur(3px)' }], { duration: 450 }).onfinish = () => { streak.hidden = true; };
      } else streak.hidden = true;
    }
    const announcement = get('race-announcement');
    announcement.hidden = !state.announcement || state.phase !== 'running';
    if (state.announcement && state.announcement.id !== lastAnnouncement) {
      lastAnnouncement = state.announcement.id;
      announcement.dataset.kind = state.announcement.kind;
      announcement.querySelector('strong')!.textContent = state.announcement.title;
      announcement.querySelector('span')!.textContent = state.announcement.detail;
      get('race-clean').hidden = !state.announcement.clean;
    }
    if (state.announcement) {
      const age = Math.max(0, state.elapsed - state.announcement.startedAt);
      const remaining = state.announcement.duration - age;
      announcement.style.opacity = String(Math.min(1, age / 0.18, Math.max(0, remaining / 0.65)));
    }
    speed.textContent = Math.round(state.speed * 3.6).toString().padStart(3, '0');
    const awakening = state.awakeningRemaining > 0;
    const awakeningInventory = get('race-awakening');
    awakeningInventory.classList.toggle('is-active', awakening);
    awakeningInventory.setAttribute('aria-label', `각성 코어 ${state.awakeningCores} / ${AWAKENING_CAPACITY}개`);
    awakeningInventory.querySelectorAll<HTMLButtonElement>('[data-awakening-core]').forEach((button, index) => {
      button.hidden = index >= state.awakeningCores;
      button.disabled = state.phase !== 'running' || awakening;
      button.setAttribute('aria-label', `각성 사용 · 보유 ${state.awakeningCores} / ${AWAKENING_CAPACITY}개`);
    });
    get('awakening-empty').hidden = state.awakeningCores > 0;
    get('awakening-empty').textContent = awakening ? '자동 주행 중' : '코어 없음';
    get('awakening-label').textContent = awakening ? `각성 ${state.awakeningRemaining.toFixed(1)}s` : '각성';
    const coreControl = coarsePointer.matches ? '코어 터치' : 'W 또는 코어 클릭';
    const awakeningStatus = awakening ? '자동 주행 · 충돌 보호' : state.awakeningCores === AWAKENING_CAPACITY ? `${AWAKENING_CAPACITY}개 보관 · ${coreControl}` : state.awakeningCores > 0 ? `${coreControl} · 5초 자동 주행` : '황금 코어를 획득하세요';
    if (get('awakening-status').textContent !== awakeningStatus) get('awakening-status').textContent = awakeningStatus;
    screen.classList.toggle('is-awakened', awakening);
    speed.parentElement!.dataset.boostStage = String(state.boostStage);
    const percentage = Math.round(state.charge * 100);
    charge.textContent = `${percentage}%`; meter.setAttribute('aria-valuenow', String(percentage));
    meterFill.style.transform = `scaleX(${state.charge / BOOST_CAPACITY})`;
    meter.classList.toggle('is-boosting', state.boosting);
    const stagePercent = Math.round(state.boostStageProgress * 100);
    stageFill.style.transform = `scaleX(${state.boostStageProgress})`;
    stageMeter.setAttribute('aria-valuenow', String(stagePercent));
    stageMeter.classList.toggle('is-stage2', state.boostStage === 2);
    meter.classList.toggle('is-stage2', state.boostStage === 2);
    const boostControl = coarsePointer.matches ? 'BOOST' : 'Space';
    boostStatus.textContent = awakening ? '부스트 보관 중' : state.boostStage === 2 ? '부스트 2단계 · 추가 가속'
      : state.boostStage === 1 ? `1단계 · 2단계 축적 ${stagePercent}%`
      : state.boostNeedsRelease ? `${boostControl} 떼고 다시 사용 · ${percentage}% 남음` : percentage < 15 ? '회복 중'
      : `${boostControl} 유지 · ${state.boostStage2Seconds.toFixed(1)}초 후 2단계`;
    time.textContent = formatTime(state.elapsed);
    if (state.ghostDelta === null) ghostDeltaEl.hidden = true;
    else if (performance.now() - ghostShownAt >= 250) { // ~4 Hz keeps the digits readable
      ghostShownAt = performance.now(); const d = formatDelta(state.ghostDelta);
      ghostDeltaEl.hidden = false; ghostDeltaEl.textContent = d.text; ghostDeltaEl.classList.toggle('is-ahead', d.ahead);
    }
    const levels = state.altitudeProfile.levels;
    // Keep altitude, boost and notices within the renderer’s driving viewport.
    const layoutKey = `${screen.clientWidth}/${screen.clientHeight}/${state.trackDisplay}/${state.view}/${coarsePointer.matches}`;
    if (layoutKey !== overlayLayout) {
      overlayLayout = layoutKey;
      const layout = raceViewLayout(screen.clientWidth, screen.clientHeight, state.trackDisplay, coarsePointer.matches);
      const viewport = layout.driving;
      Object.assign(drivingOverlay.style, { left: `${viewport.x}px`, top: `${screen.clientHeight - viewport.y - viewport.height}px`, width: `${viewport.width}px`, height: `${viewport.height}px` });
      const attachPause = state.trackDisplay !== 'hidden';
      pauseButton.classList.toggle('on-pip', attachPause);
      pauseButton.style.top = attachPause ? `${screen.clientHeight - layout.inset.y - layout.inset.height + 6}px` : '';
      pauseButton.style.right = attachPause ? `${screen.clientWidth - layout.inset.x - layout.inset.width + 6}px` : '';
      drivingOverlay.classList.toggle('is-inset', state.trackDisplay === 'primary');
      drivingOverlay.dataset.view = state.view;
    }
    if (heightBars.childElementCount !== levels.length) heightBars.innerHTML = levels.map(() => '<i></i>').join('');
    const currentLevel = state.altitudeLevel;
    const settled = Math.abs(levels[currentLevel] - state.altitude) < 0.08;
    heightGuide.setAttribute('aria-label', `현재 고도 ${currentLevel + 1}/${levels.length} · 선택 단계 · 민트색 통과 가능, 빨강 통과 불가, 주황 전환 중`);
    if (state.altitudeLevel !== previousLevel) {
      if (previousLevel >= 0) highlightUntil = performance.now() + 900;
      previousLevel = state.altitudeLevel;
    }
    heightGuide.classList.toggle('height-changed', performance.now() < highlightUntil);
    const obstacle = state.heightObstacle;
    let heightEdge: 'top' | 'bottom' | null = null;
    let heightUrgent = false;
    [...heightBars.children].forEach((line, index) => {
      line.classList.toggle('is-active', index === currentLevel);
      line.classList.toggle('is-safe', Boolean(obstacle && altitudeCanPass(levels[index], obstacle)));
      line.classList.toggle('is-switching', index === currentLevel && !settled);
    });
    if (obstacle) {
      const safeLevels = levels.map((height, index) => ({ height, index })).filter(({ height }) => height >= obstacle.minAltitude && height <= obstacle.maxAltitude);
      const nearest = safeLevels.sort((a, b) => Math.abs(a.index - state.altitudeLevel) - Math.abs(b.index - state.altitudeLevel))[0];
      const steps = nearest ? nearest.index - state.altitudeLevel : 0;
      const safe = altitudeCanPass(state.altitude, obstacle);
      const approaching = obstacle.distance < Math.max(60, state.speed * 3);
      heightUrgent = !safe && obstacle.distance < Math.max(35, state.speed * 1.5);
      // Light the dangerous side, matching the lateral obstacle warning.
      if (nearest && approaching && !safe) heightEdge = nearest.height > state.altitude ? 'bottom' : 'top';
      const control = coarsePointer.matches ? '버튼' : '키';
      const action = nearest ? steps === 0 ? '고도 전환 중'
        : coarsePointer.matches && state.boosting ? `${steps > 0 ? '↑ 위로' : '↓ 아래로'} 밀기`
        : `${steps > 0 ? '↑' : '↓'} ${control} ${Math.abs(steps)}회` : '통과 고도 없음';
      heightInstruction.textContent = approaching && !safe ? action : '';
      heightGuide.classList.toggle('height-ready', safe);
      heightGuide.dataset.readiness = !settled ? 'switching' : safe ? 'ready' : 'blocked';
      heightGuide.classList.toggle('height-alert', approaching && !safe);
      heightGuide.classList.toggle('height-urgent', heightUrgent);
      heightGuide.dataset.kind = obstacle.kind;
    } else {
      heightGuide.dataset.readiness = settled ? 'neutral' : 'switching';
      heightInstruction.textContent = '';
      heightGuide.classList.remove('height-ready', 'height-alert', 'height-urgent');
    }
    const corridor = state.corridor, pad = state.boostPad, mines = state.mineField, rail = state.arcRail, ring = state.boostRing;
    heightGuide.dataset.pad = String(!obstacle && !rail && (!!pad || !!ring));
    heightGuide.dataset.rail = String(!obstacle && !!rail);
    heightGuide.dataset.mines = String(!obstacle && !rail && !ring && !pad && !!mines);
    if (!obstacle && rail) {
      heightInstruction.textContent = `⚡ 아크 레일 · ${rail.side > 0 ? '오른쪽 위험 ← 왼쪽으로' : '왼쪽 위험 → 오른쪽으로'}${rail.safe ? ' ✓' : ''}`;
    } else if (!obstacle && ring) {
      heightInstruction.textContent = `⚡ 부스트 링 ${ring.side === 'left' ? '← 왼쪽' : '오른쪽 →'}${ring.safe ? ' ✓' : ''}`;
    } else if (!obstacle && pad) {
      const lane = { left: '← 왼쪽', center: '가운데', right: '오른쪽 →' }[pad.lane];
      heightInstruction.textContent = `⚡ 부스트 패드 ${lane}${pad.safe ? ' ✓' : ''}`;
    } else if (!obstacle && mines) {
      heightInstruction.textContent = `⚠ 전기 지뢰밭 · 빈틈으로 통과${mines.hint ? ` · ${{ left: '← 왼쪽에서 진입', center: '가운데에서 진입', right: '오른쪽에서 진입 →' }[mines.hint]}` : ''}`;
    } else if (!obstacle && corridor && corridor.distance < Math.max(120, state.speed * 3)) {
      const lane = { left: '← 왼쪽', center: '가운데', right: '오른쪽 →' }[corridor.lane];
      heightInstruction.textContent = `${lane} 통로${corridor.safe ? ' ✓' : ''}`;
      heightGuide.dataset.readiness = corridor.safe ? 'ready' : 'blocked';
      heightGuide.classList.toggle('height-alert', !corridor.safe);
      heightGuide.classList.toggle('height-urgent', !corridor.safe && corridor.distance < Math.max(35, state.speed * 1.5));
    }
    if (awakening) {
      heightInstruction.textContent = '각성 자동 주행';
      heightGuide.classList.remove('height-alert', 'height-urgent');
      heightGuide.dataset.readiness = 'ready';
    }
    const edges = state.phase === 'running' && !state.cinematic && !awakening ? hazardEdgeAlert({ corridor: state.corridor, arcRail: state.arcRail, speed: state.speed }) : { left: null, right: null, arrow: null };
    for (const side of ['left', 'right'] as const) {
      const el = get(`edge-${side}`), edge = edges[side];
      el.hidden = !edge;
      if (edge) { el.dataset.tone = edge.tone; el.dataset.level = edge.level; }
    }
    const arrow = get('edge-arrow'), arrowTone = edges.arrow && edges[edges.arrow === 'left' ? 'right' : 'left'];
    arrow.hidden = !edges.arrow;
    if (edges.arrow) { arrow.dataset.side = edges.arrow; arrow.dataset.tone = arrowTone?.tone ?? 'corridor'; arrow.textContent = edges.arrow === 'left' ? '◀◀' : '▶▶'; }
    const altitudeEdge = get('height-edge');
    const showHeightEdge = !!heightEdge && state.phase === 'running' && !state.cinematic && !awakening;
    altitudeEdge.hidden = !showHeightEdge;
    if (heightEdge && showHeightEdge) {
      altitudeEdge.dataset.tone = heightEdge === 'bottom' ? 'ascend' : 'descend';
      altitudeEdge.dataset.side = heightEdge;
      altitudeEdge.dataset.level = heightUrgent ? 'danger' : 'warn';
    }
    const forkGuide = get('race-fork');
    forkGuide.hidden = !state.fork || state.phase !== 'running';
    if (state.fork) {
      const fork = state.fork;
      forkGuide.textContent = fork.selected ? `${fork.selected} · 합류 ${Math.round(fork.distance)}m` :
        fork.kind === 'horizontal' ? `← 왼쪽 길 ${fork.names[0]} · 오른쪽 길 ${fork.names[1]} →`
          : `↑ 위쪽 길: ${fork.level}단 이상 ${fork.names[1]} / ↓ 아래쪽 길 ${fork.names[0]}`;
      forkGuide.dataset.selected = String(!!fork.selected);
    }
    const curvature = state.upcomingCurvature;
    corner.textContent = state.upcomingSection === 'vertical-loop' ? '수직 루프 · 자동 추종' : state.upcomingSection === 'helix' ? '스프링 · 자동 추종' : Math.abs(curvature) < 0.004 ? '직선' : `${curvature > 0 ? '우' : '좌'}회전${Math.abs(curvature) > 0.02 ? ' · 급한 코너' : ''}`;
    const nextNotice = state.notice === 'off-track' ? `코스 이탈 · -${OFF_TRACK_PENALTY_POINTS}P` : state.notice === 'craft-collision' ? `기체 접촉 · -${COLLISION_PENALTY_POINTS}P` : state.notice === 'collision' ? `경계 접촉 · -${COLLISION_PENALTY_POINTS}P` : state.notice === 'obstacle-pass' ? '장애물 통과 · +1P' : state.notice === 'corridor-collision' ? `통로 방전 접촉 · -${OBSTACLE_COLLISION_PENALTY_POINTS}P` : state.notice === 'height-collision' ? `방전 접촉 · -${OBSTACLE_COLLISION_PENALTY_POINTS}P` : state.notice === 'recovery' ? '체크포인트 복귀' : '';
    if (notice.textContent !== nextNotice) notice.textContent = nextNotice;
    const cine = state.cinematic?.kind ?? '';
    const cinematicEnded = !!cinematicKind && !cine;
    if (cine !== cinematicKind) {
      if (cinematicEnded) cinematicEndedAt = performance.now();
      cinematicKind = cine; screen.dataset.cinematic = cine;
      const intro = get('race-intro'), splash = get('race-splash');
      intro.hidden = cine !== 'intro'; splash.hidden = cine !== 'finish';
      if (cine === 'intro') {
        const title = introTitle({ district: campaign && DISTRICTS[campaign.track.district].name, order: campaign?.track.order, name: campaign?.track.name ?? 'NEON CIRCUIT',
          difficulty: campaign ? RACE_CHALLENGES[challenge].label : DIFFICULTIES[selectedDifficulty].label, laps: attack.totalLaps, field: competition?.standings.length });
        intro.style.setProperty('--cine', `${state.cinematic!.seconds}s`);
        intro.querySelector('.intro-eyebrow')!.textContent = title.eyebrow; intro.querySelector('.intro-name')!.textContent = title.name;
        intro.querySelector('.intro-meta')!.textContent = title.meta.join(' · ');
      } else if (cine === 'finish') {
        const result = finishSplash({ rank: competition?.playerRank ?? null, disqualified: attack.disqualified, isNewBest: !!attack.result?.isNewBest, total: formatTime(state.elapsed) });
        splash.dataset.kind = result.kind; splash.style.setProperty('--cine', `${state.cinematic!.seconds}s`);
        splash.querySelector('strong')!.textContent = result.title; splash.querySelector('span')!.textContent = result.detail; splash.querySelector('em')!.textContent = result.badge;
        splash.querySelector('span')!.hidden = !result.detail; splash.querySelector('em')!.hidden = !result.badge;
      }
    }
    const phaseChanged = state.phase !== lastPhase;
    if (phaseChanged) {
      lastPhase = state.phase;
      if (state.phase === 'running' || state.phase === 'countdown' || state.phase === 'finished') { previewing = false; preferences.close(); }
      get('difficulty-picker').hidden = !!campaign || state.phase !== 'ready';
      get('race-mode-picker').hidden = !!campaign || state.phase !== 'ready';
      get('difficulty-description').hidden = state.phase !== 'ready';
      if (rainToggle) get('dev-weather').hidden = state.phase !== 'ready';
      get('pause-summary').hidden = state.phase !== 'paused';
      get('race-restart').hidden = state.phase !== 'paused';
      get('race-result').hidden = state.phase !== 'finished';
      get('ready-best').hidden = state.phase !== 'ready';
      screen.dataset.phase = state.phase;
      window.dispatchEvent(new CustomEvent('speedracer:phase', { detail: state.phase }));
      get('drive-overlay-title').textContent = state.phase === 'paused' ? '일시정지' : state.phase === 'finished' ? attack.disqualified ? '타임어택 실격' : '레이스 완료' : '레이스 준비';
      get('drive-overlay-copy').textContent = state.phase === 'ready' && campaign ? selectedMode === 'competition' ? `${campaign.track.laps}랩 경기에서 ${campaignRankLimit(campaign.track)}위 이내로 완주하면 다음 트랙이 열립니다.` : `매 랩 ${attack.lapLimit}초 안에 ${attack.totalLaps}랩을 완주하세요. 제한시간이 지나면 실격됩니다.` : state.phase === 'ready' ? (selectedMode === 'competition' ? `상대 기체 ${AI_OPPONENT_COUNT}대와 3랩을 겨룹니다. 직선에서 추월하고 급한 코너에서는 감속하세요.` : '3랩을 완주해 기록에 도전하세요. 자동으로 가속하며 급한 코너에서는 감속합니다.') : '';
      startButton.innerHTML = `${state.phase === 'paused' ? '계속하기' : state.phase === 'finished' ? '다시 도전' : '레이스 시작'} <span aria-hidden="true">↗</span>`;
      get('race-hangar').textContent = state.phase === 'paused' ? '포기하고 캠페인으로' : '캠페인으로';
    }
    paintMenu();
    if (phaseChanged || cinematicEnded) menuDialog.scrollTop = 0;
    // Focus only after paintMenu reveals the overlay; a hidden button cannot take focus.
    if ((phaseChanged || cinematicEnded) && !cinematicKind && (state.phase === 'paused' || state.phase === 'finished' || (state.phase === 'ready' && !coarsePointer.matches))) {
      const next = get<HTMLButtonElement>('campaign-next');
      (state.phase === 'finished' && !next.hidden ? next : startButton).focus({ preventScroll: true });
    }
  };
  const events = new AbortController();
  const listen = { signal: events.signal };
  window.addEventListener('pagehide', event => { if (!event.persisted) analytics.quit('page_exit'); }, listen);
  // iOS long-press selection/callouts can originate on a control's child label.
  for (const type of ['contextmenu', 'selectstart', 'dragstart']) {
    screen.addEventListener(type, event => event.preventDefault(), listen);
  }
  coarsePointer.addEventListener('change', refreshHaptics, listen);
  let race: Race | undefined;
  const showError = () => {
    lost = true; preferences.close(); restartConfirm.close(); get('view-preview').hidden = true; overlay.hidden = true; get('drive-error').hidden = false;
    qualitySelect.disabled = true; hazeButton.disabled = true;
    get<HTMLButtonElement>('race-restart').disabled = true; pauseButton.disabled = true; bloomButton.disabled = true; soundButton.disabled = true; musicButton.disabled = true; hapticsButton.disabled = true; get<HTMLButtonElement>('race-view').disabled = true; get<HTMLButtonElement>('race-track').disabled = true; get<HTMLButtonElement>('race-settings').disabled = true;
  };
  get('race-hangar').addEventListener('click', onExit, listen);
  get('result-shop').addEventListener('click', () => onShop?.(), listen);
  get('reward-retry').addEventListener('click', () => { void saveReward(); }, listen);
  const useFocus = async () => {
    if (!store || focusPending || lastPhase !== 'running' || !canFocus) return;
    focusPending = true; get<HTMLButtonElement>('race-focus').disabled = true;
    const requestedRaceId = activeRaceId; const receipt = `${requestedRaceId}:${++focusSerial}`;
    try {
      await store.command({ kind: 'consume-focus', id: receipt });
      if (screenDisposed || activeRaceId !== requestedRaceId || !race?.useFocus()) await store.command({ kind: 'refund-focus', id: receipt });
      else { get('focus-feedback').textContent = '집중 모드 · 2초'; focusMessageUntil = performance.now() + 2200; await store.command({ kind: 'confirm-focus', id: receipt }); }
    } catch (error) { if (!screenDisposed) { get('focus-feedback').textContent = error instanceof Error ? error.message : '아이템을 사용할 수 없습니다.'; focusMessageUntil = performance.now() + 2500; } }
    finally { focusPending = false; }
  };
  const useRival = async (item: RivalItemId) => {
    if (!store || focusPending || lastPhase !== 'running' || !itemStates.find(entry => entry.id === item)?.canUse) return;
    focusPending = true;
    const requestedRaceId = activeRaceId; const receipt = `${requestedRaceId}:${++focusSerial}`;
    try {
      await store.command({ kind: 'consume-rival', item, id: receipt, mode: selectedMode });
      if (screenDisposed || activeRaceId !== requestedRaceId || !race?.useRivalItem(item)) await store.command({ kind: 'refund-rival', id: receipt });
      else {
        const definition = RIVAL_ITEMS.find(entry => entry.id === item)!;
        get('focus-feedback').textContent = `${definition.name} · ${definition.duration}초`;
        focusMessageUntil = performance.now() + 2500;
        await store.command({ kind: 'confirm-rival', id: receipt });
      }
    } catch (error) { if (!screenDisposed) { get('focus-feedback').textContent = error instanceof Error ? error.message : '아이템을 사용할 수 없습니다.'; focusMessageUntil = performance.now() + 2500; } }
    finally { focusPending = false; }
  };
  const useNextItem = () => {
    if (canFocus) void useFocus();
    else { const next = itemStates.find(item => item.canUse); if (next) void useRival(next.id); }
  };
  get('race-focus').addEventListener('click', () => { void useFocus(); }, listen);
  for (const item of RIVAL_ITEMS) get(`race-${item.id}`).addEventListener('click', () => { void useRival(item.id); }, listen);
  window.addEventListener('speedracer:focus-request', () => { if (!preferences.open) useNextItem(); }, listen);
  window.addEventListener('keydown', event => {
    if (event.code !== 'KeyV' || event.repeat || event.ctrlKey || event.metaKey || event.altKey || document.querySelector('dialog[open]') || event.target instanceof HTMLElement && event.target.closest('input, select, textarea, [contenteditable]')) return;
    event.preventDefault(); useNextItem();
  }, listen);
  get('drive-retry').addEventListener('click', () => location.reload(), listen);
  const prepareRace = () => {
    // The development switch overrides every course; production retains random weather.
    const weather = import.meta.env.DEV
      ? previewRain ? NIGHT_ENVIRONMENTS.find(value => value.id === 'storm-night')!
        : defaultEnvironment.rain ? NIGHT_ENVIRONMENTS[0] : defaultEnvironment
      : defaultEnvironment;
    const environment = weather.rain ? { ...weather, rainIntensity: selectRainIntensity() } : weather;
    if (rainToggle) {
      rainToggle.setAttribute('aria-pressed', String(previewRain));
      get('dev-rain-state').textContent = previewRain ? '켜짐' : '꺼짐';
    }
    standingsKey = '';
    const profile = store?.snapshot();
    focusSlots = profile ? Math.min(profile.focusSlots, profile.focus) : 0;
    equippedRivalSlots = selectedMode === 'competition' && profile ? profile.rivalSlots.filter((item, index, slots) => slots.slice(0, index + 1).filter(id => id === item).length <= profile.rivalInventory[item]) : [];
    document.title = `Speedracer — ${selectedMode === 'competition' ? '경쟁 레이스' : '타임어택'}`;
    get('race-course-name').textContent = campaign?.track.name ?? 'NEON CIRCUIT';
    get('race-mode-title').textContent = `${selectedMode === 'competition' ? 'COMPETITION RACE' : 'TIME ATTACK'} · ${campaign ? RACE_CHALLENGES[challenge].label : DIFFICULTIES[selectedDifficulty].label}`;
    get('race-loadout').textContent = `${selectedMode === 'competition' ? `상대 기체 ${AI_OPPONENT_COUNT}대와 경쟁` : '타임어택'} · ${focusSlots || equippedRivalSlots.length ? `장착 아이템 ${focusSlots + equippedRivalSlots.length}개 · 기본 보상 80%` : '코스에서 각성 코어 획득'}`;
    rewardInput = undefined; campaignOutcome = undefined; get('result-reward').textContent = ''; get('reward-retry').hidden = true; get('result-shop').hidden = true; get('campaign-next').hidden = true;
    race?.dispose(); lastPhase = ''; lastViewKey = ''; previewing = false; lastCollisions = 0; lastBoostStage = 0; lastAnnouncement = 0; lastCallout = 0; lastNearMisses = 0; lastStreak = 0; impactAnimation?.cancel(); boostFlashAnimation?.cancel();
    get('difficulty-description').textContent = `${campaign?.track.features ?? DIFFICULTIES[selectedDifficulty].description} · ${environment.label}${environment.rainIntensity ? ` · ${RAIN_INTENSITIES[environment.rainIntensity].label}` : ''}`;
    try {
      race = createRace(get<HTMLDivElement>('race-scene'), update, showError, configuration, undefined, campaign ? trackPreset(campaign.track) : DIFFICULTIES[selectedDifficulty], focusSlots, selectedMode, campaign?.track, equippedRivalSlots, environment, challenge, introPending);
      introPending = false;
      race.setQuality(qualitySelect.value as RenderQuality);
      race.setExhaustHaze(hazeButton.getAttribute('aria-pressed') === 'true');
      race.setBloom(bloomButton.getAttribute('aria-pressed') === 'true');
      race.setSoundEnabled(soundButton.getAttribute('aria-pressed') === 'true');
      race.setMusicEnabled(musicButton.getAttribute('aria-pressed') === 'true');
      race.setHapticsEnabled(hapticsButton.getAttribute('aria-pressed') === 'true');
    } catch (error) { console.error('주행 화면 초기화 실패:', error); showError(); }
  };
  prepareRace();
  rainToggle?.addEventListener('click', () => {
    if (lastPhase !== 'ready') return;
    previewRain = !previewRain;
    try { sessionStorage.setItem('speedracer.dev.rain', previewRain ? 'on' : 'off'); } catch { /* Optional preview preference. */ }
    prepareRace(); rainToggle.focus({ preventScroll: true });
  }, listen);
  window.addEventListener('speedracer:pause-request', () => { if (lastPhase === 'running' || lastPhase === 'countdown') race?.togglePause(); }, listen);
  window.addEventListener('speedracer:menu-back', () => {
    if (cinematicKind) { race?.skipCinematic(); return; }
    if (previewing) leavePreview();
    else if (lastPhase === 'paused') race?.togglePause();
    else if (lastPhase === 'ready' || lastPhase === 'finished') get('race-hangar').click();
  }, listen);
  get('race-mode-picker').addEventListener('change', event => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !['time-attack', 'competition'].includes(target.value)) return;
    selectedMode = target.value as RaceMode; prepareRace();
  }, listen);
  get('difficulty-picker').addEventListener('change', event => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !(target.value in DIFFICULTIES)) return;
    selectedDifficulty = target.value as DifficultyId; prepareRace();
  }, listen);
  get('campaign-next').addEventListener('click', () => { const next = TRACK_CATALOG.find(t => t.predecessor === campaign?.track.id); if (next) location.hash = `drive?track=${next.id}&mode=${selectedMode}&challenge=${challenge}`; }, listen);
  for (const id of ['race-view', 'preview-view']) get(id).addEventListener('click', () => { get(id).blur(); race?.toggleCockpit(); }, listen);
  for (const id of ['race-track', 'preview-track']) get(id).addEventListener('click', () => { get(id).blur(); race?.cycleTrack(); }, listen);
  get('preview-back').addEventListener('click', leavePreview, listen);
  get('race-settings').addEventListener('click', () => preferences.showModal(), listen);
  window.addEventListener('keydown', event => {
    if (event.code !== 'KeyS' || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
      || event.defaultPrevented || document.querySelector('dialog[open]')
      || !['ready', 'paused', 'finished'].includes(lastPhase)
      || event.target instanceof HTMLElement && event.target.closest('input, select, textarea, [contenteditable]')) return;
    event.preventDefault(); preferences.showModal();
  }, { ...listen, capture: true });
  get('preferences-close').addEventListener('click', () => preferences.close(), listen);
  window.addEventListener('keydown', event => {
    if (event.code !== 'Escape' || !previewing || root.querySelector('dialog[open]')) return;
    event.preventDefault(); event.stopImmediatePropagation(); leavePreview();
  }, { ...listen, capture: true });
  // The press that skipped a cinematic (pad A, a held key) must not also activate a button revealed under it.
  overlay.addEventListener('click', event => { if (performance.now() - cinematicEndedAt < 400) { event.preventDefault(); event.stopImmediatePropagation(); } }, { ...listen, capture: true });
  startButton.addEventListener('click', () => { startButton.blur(); if (lastPhase === 'finished') prepareRace(); race?.start(); }, listen);
  pauseButton.addEventListener('click', () => { pauseButton.blur(); if (previewing) leavePreview(); else race?.togglePause(); }, listen);
  get('race-awakening').addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-awakening-core]');
    if (!button || button.disabled) return;
    button.blur();
    race?.useAwakening();
  }, listen);
  const requestRestart = () => {
    if (lost || root.querySelector('dialog[open]')) return;
    if (lastPhase === 'running' || lastPhase === 'countdown') race?.togglePause();
    restartConfirm.returnValue = ''; restartConfirm.showModal(); get('restart-cancel').focus();
  };
  get('race-restart').addEventListener('click', requestRestart, listen);
  window.addEventListener('speedracer:restart-request', requestRestart, listen);
  get('restart-cancel').addEventListener('click', () => restartConfirm.close(), listen);
  get('restart-accept').addEventListener('click', () => { restartConfirm.close('restart'); prepareRace(); race?.start(); }, listen);
  restartConfirm.addEventListener('close', () => {
    if (screenDisposed || restartConfirm.returnValue === 'restart') return;
    (lastPhase === 'paused' ? get('race-restart') : startButton).focus({ preventScroll: true });
  }, listen);
  qualitySelect.addEventListener('change', () => race?.setQuality(qualitySelect.value as RenderQuality), listen);
  hazeButton.addEventListener('click', () => {
    const enabled = hazeButton.getAttribute('aria-pressed') !== 'true';
    hazeButton.setAttribute('aria-pressed', String(enabled)); race?.setExhaustHaze(enabled);
  }, listen);
  bloomButton.addEventListener('click', () => {
    const enabled = bloomButton.getAttribute('aria-pressed') !== 'true';
    bloomButton.setAttribute('aria-pressed', String(enabled)); race?.setBloom(enabled);
  }, listen);
  soundButton.addEventListener('click', () => {
    const enabled = soundButton.getAttribute('aria-pressed') !== 'true';
    soundButton.setAttribute('aria-pressed', String(enabled)); sfxPreference.set(enabled); race?.setSoundEnabled(enabled);
  }, listen);
  musicButton.addEventListener('click', () => {
    const enabled = musicButton.getAttribute('aria-pressed') !== 'true';
    musicButton.setAttribute('aria-pressed', String(enabled)); race?.setMusicEnabled(enabled);
  }, listen);
  hapticsButton.addEventListener('click', () => {
    const enabled = hapticsButton.getAttribute('aria-pressed') !== 'true';
    hapticsButton.setAttribute('aria-pressed', String(enabled)); race?.setHapticsEnabled(enabled);
  }, listen);
  return () => { analytics.quit(lost ? 'render_error' : 'navigation'); screenDisposed = true; preferences.close(); restartConfirm.close(); impactAnimation?.cancel(); boostFlashAnimation?.cancel(); events.abort(); race?.dispose(); window.dispatchEvent(new CustomEvent('speedracer:phase', { detail: 'hangar' })); };
}
