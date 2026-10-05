import { selectRaceEnvironment } from './game/environment/raceEnvironment';
import { AI_OPPONENT_COUNT } from './game/driving/aiRoster';
import { RIVAL_ITEMS } from './game/progression/catalog';
import type { RivalItemId } from './game/progression/catalog';
import { soundtrack } from './game/audio/soundtrack';
import { OFF_TRACK_PENALTY_POINTS } from './game/driving/createDrivingModel';
import { RENDER_QUALITIES } from './platform/renderQuality';
import type { RenderQuality } from './platform/renderQuality';
import { DEFAULT_DRONE_CONFIGURATION } from './game/drone/droneConfiguration';
import type { DroneConfiguration } from './game/drone/droneConfiguration';
import { altitudeCanPass } from './game/track/altitudeProfile';
import { DIFFICULTIES } from './game/track/difficulty';
import type { DifficultyId } from './game/track/difficulty';
import { raceViewLayout } from './game/driving/createRaceViews';
import { createRace } from './game/driving/createRace';
import type { RaceMode } from './game/driving/createRaceSession';
import type { Race, RaceSnapshot } from './game/driving/createRace';
import './race.css';
import './campaign.css';
import { TRACK_CATALOG } from './game/track/trackCatalog';
import { trackPreset } from './game/track/trackRuntime';
import type { TrackDefinition } from './game/track/trackCatalog';
import type { CampaignOutcome } from './game/progression/campaign';
import type { ProgressStore } from './game/progression/progressStore';
import type { RewardInput } from './game/progression/progress';
import './shop.css';

const formatTime = (seconds: number) => {
  const ms = Math.round(Math.max(0, seconds) * 1000);
  return `${Math.floor(ms / 60000).toString().padStart(2, '0')}:${Math.floor(ms / 1000 % 60).toString().padStart(2, '0')}.${(ms % 1000).toString().padStart(3, '0')}`;
};

export function mountRace(root: HTMLDivElement, onExit: () => void, configuration: DroneConfiguration = DEFAULT_DRONE_CONFIGURATION, store?: ProgressStore, onShop?: () => void, campaign?: { track: TrackDefinition; mode: RaceMode }): () => void {
  let focusSlots = store ? Math.min(store.snapshot().focusSlots, store.snapshot().focus) : 0;
  document.title = 'Speedracer — 타임어택';
  root.innerHTML = `
    <main class="drive-screen">
      <div id="race-scene" class="race-scene"></div>
      <div id="race-impact" class="race-impact" aria-hidden="true"></div>
      <div id="race-boost-flash" class="race-boost-flash" aria-hidden="true"></div>
      <header class="race-header">
        <div class="race-telemetry" aria-label="주행 정보"><div class="telemetry-row"><span class="speed-readout" aria-label="현재 주행 속도"><strong id="drive-speed">000</strong><span class="speed-unit mono"><small>속도</small>km/h</span></span><span id="race-rank" class="rank-readout mono" hidden></span><span id="race-lap" class="lap-readout mono">LAP 1/3</span><time id="drive-time" class="mono">00:00.000</time></div><div class="corner-guide"><span id="lap-deadline" hidden></span><strong id="corner-text">직선</strong><span class="corner-hint">급한 코너에서는 S로 감속</span></div></div>
      </header>
      <button type="button" id="race-pause" class="race-pause" aria-label="일시정지 메뉴" aria-keyshortcuts="Escape" aria-controls="drive-overlay" aria-expanded="false"><span aria-hidden="true">Ⅱ</span></button>
      <div class="driving-overlay"><div id="race-announcement" class="race-announcement" role="status" aria-live="polite" hidden><strong></strong><span></span></div><p id="race-notice" class="race-notice" role="status" aria-live="polite"></p><div id="race-countdown" class="race-countdown" role="status" aria-live="assertive" hidden><span>READY</span><strong>3</strong></div>
      <div class="race-items"><button id="race-focus" type="button" class="race-focus" aria-keyshortcuts="V" hidden>집중 모드</button>${RIVAL_ITEMS.map(item => `<button type="button" id="race-${item.id}" class="race-focus" data-use-item="${item.id}" hidden>${item.name}</button>`).join('')}</div><p id="focus-feedback" class="focus-feedback" role="status" aria-live="polite"></p><footer class="drive-hud" aria-label="고도와 부스트 계기판">
        <aside class="height-guide" aria-label="고도 안내: 선택 단계, 민트색 통과 가능, 빨강 통과 불가, 주황 전환 중"><div id="height-level" class="height-bars"></div><strong id="height-instruction"></strong></aside>
        <div class="boost-readout"><div class="hud-pair"><span class="hud-label">BOOST</span><span id="boost-value" class="mono">100%</span></div><div id="boost-meter" class="boost-meter" role="progressbar" aria-label="부스트 잔량" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100"><span></span></div><div id="boost-stage-meter" class="boost-stage-meter" role="progressbar" aria-label="부스트 2단계 축적" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span></span></div><span id="boost-status">Space 유지 · 3초 후 2단계</span></div>
      </footer></div>
      <section id="drive-overlay" class="drive-overlay" aria-labelledby="drive-overlay-title">
        <div class="drive-dialog">
          <p id="race-mode-title" class="eyebrow">NEON CIRCUIT · TIME ATTACK</p><h2 id="drive-overlay-title">레이스 준비</h2><p id="drive-overlay-copy"></p>
          <p id="pause-summary" class="pause-summary" hidden></p>
          <section id="race-result" class="race-result" aria-label="경기 결과" hidden><p id="result-status" class="result-status"></p><time id="result-total" class="result-total"></time><ol id="result-laps" class="result-laps"></ol><p id="result-best"></p><div id="competition-results" hidden><p id="standings-status"></p><ol id="race-standings" class="race-standings" aria-label="참가자 순위"></ol></div><p id="result-penalties"></p><div id="result-reward" class="reward-summary" role="status" aria-live="polite"></div><p id="campaign-result" role="status"></p><button id="campaign-next" type="button" hidden>다음 트랙 ↗</button><button id="campaign-select" type="button" hidden>캠페인 선택</button><button id="reward-retry" type="button" hidden>보상 저장 다시 시도</button><button id="result-shop" type="button" hidden>상점으로 ↗</button><p id="record-warning" class="record-warning" hidden>기록을 저장하지 못했습니다. 이번 화면에서 확인할 수 있습니다.</p></section>
          <fieldset id="race-mode-picker" class="difficulty-picker mode-picker"><legend>경기 방식</legend><div><label><input type="radio" name="race-mode" value="time-attack" checked /><span>타임어택</span></label><label><input type="radio" name="race-mode" value="competition" /><span>AI 레이스 · ${AI_OPPONENT_COUNT + 1}대</span></label></div></fieldset>
          <fieldset id="difficulty-picker" class="difficulty-picker"><legend>난이도</legend><div><label><input type="radio" name="difficulty" value="beginner" checked /><span>초급</span></label><label><input type="radio" name="difficulty" value="intermediate" /><span>중급</span></label><label><input type="radio" name="difficulty" value="advanced" /><span>고급</span></label></div></fieldset><p id="difficulty-description" class="difficulty-description"></p>
          <section id="ai-roster" class="ai-roster" aria-label="이번 경기 AI 선수" hidden><p class="eyebrow">이번 경기 상대</p><ol id="ai-roster-list"></ol></section>
          <p id="ready-best" class="ready-best"></p><p class="shop-hint" id="race-loadout"></p><button type="button" id="drive-start" class="primary-action">레이스 시작 <span aria-hidden="true">↗</span></button>
          <button type="button" id="race-hangar" class="race-exit">캠페인으로</button>
          <div class="menu-preview"><span>화면 미리보기</span><div class="race-actions"><button type="button" id="race-view">콕핏 보기 <kbd>C</kbd></button><button type="button" id="race-track">트랙 PIP 보기 <kbd>X</kbd></button></div></div>
          <nav class="race-actions menu-actions" aria-label="주행 메뉴">
            <button type="button" id="race-restart" hidden>처음부터 다시 <kbd>R</kbd></button><button type="button" id="race-difficulty" hidden>난이도 변경</button><button type="button" id="race-recover" hidden>체크포인트 복귀 <kbd>F</kbd></button>
            <button type="button" id="race-settings">설정 · 조작 안내</button>
          </nav>
          <div class="app-tools" data-app-tools></div>
        </div>
      </section>
      <nav id="view-preview" class="view-preview" aria-label="정지 상태에서 시점 미리보기" hidden>
        <p>시점 미리보기 <span>· 주행 정지</span></p><div><button type="button" id="preview-view">콕핏 보기 <kbd>C</kbd></button><button type="button" id="preview-track">트랙 PIP 보기 <kbd>X</kbd></button><button type="button" id="preview-back">메뉴로</button></div>
      </nav>
      <dialog id="race-preferences" class="race-preferences" aria-labelledby="preferences-title">
        <header><h2 id="preferences-title">설정</h2><button type="button" id="preferences-close" aria-label="설정 닫기">닫기</button></header>
        <div class="preference-options"><button type="button" id="race-bloom" aria-pressed="true"><span>네온 발광 <small>Bloom</small></span></button><button type="button" id="race-sound" aria-pressed="true"><span>주행 효과음</span></button><button type="button" id="race-music" aria-pressed="true"><span>배경 음악 <small>MIDI · 5곡</small></span></button><button type="button" id="race-haptics" aria-pressed="true"><span>진동</span></button></div>
        <div class="render-options"><label for="race-quality">렌더링 품질</label><select id="race-quality">${Object.entries(RENDER_QUALITIES).map(([id, option]) => `<option value="${id}" ${id === 'balanced' ? 'selected' : ''}>${option.label}</option>`).join('')}</select></div>
        <div class="preference-options"><button type="button" id="race-haze" aria-pressed="false"><span>배기 아지랑이 <small>추적 시점</small></span></button></div>
        <p class="quality-hint">아지랑이는 배기 주변에만 적용합니다. 성능이 낮으면 끄거나 ‘성능 우선’을 선택하세요.</p>
        <details class="control-help"><summary>조작 안내</summary>
          <p class="touch-help">메뉴: 화살표로 이동 · Enter로 선택. 게임패드: 방향 패드/스틱으로 이동 · A 선택 · B 돌아가기.<br />주행: 왼쪽 스틱 조향 · 방향 패드 ↑/↓ 고도 · LT 감속 · RT/RB 부스트 · X 콕핏 · Y 트랙 뷰 · LB 아이템 · Start 일시정지/계속.</p>
          <div class="drive-keys"><span>자동 가속 · <kbd>S</kbd> 감속</span><span><kbd>A</kbd> <kbd>D</kbd> 좌우 조향</span><span><kbd>↓</kbd> <kbd>↑</kbd> 고도 한 단계 전환</span><span><kbd>Space</kbd> 길게 눌러 부스트</span><span><kbd>C</kbd> 기체·콕핏 전환</span><span><kbd>X</kbd> 트랙 PIP·자리 교환·닫기</span><span><kbd>V</kbd> 아이템 사용</span><span><kbd>Esc</kbd> 일시정지·계속하기</span></div>
          <p class="touch-help">자동으로 가속합니다. 왼쪽 조이스틱은 좌우 조향, 아래로 당기면 감속합니다. 대각선으로 두 조작을 함께 할 수 있습니다.<br />오른쪽 ↑/↓ 버튼은 고도를 한 단계 바꾸고, BOOST는 길게 눌러 사용합니다. ${(configuration.performance.boostStage2Threshold / configuration.performance.boostDrain).toFixed(1)}초 연속 부스트 시 2단계에 진입합니다.<br />시점은 일시정지 메뉴의 화면 미리보기에서 바꿀 수 있습니다.</p>
        </details>
      </dialog>
      <section id="drive-error" class="drive-overlay" role="alert" hidden><div class="drive-dialog"><h2>3D 화면 연결이<br />끊어졌습니다.</h2><p>다시 불러온 후 주행을 시작해주세요.</p><button type="button" id="drive-retry" class="primary-action">다시 불러오기</button></div></section>
    </main>`;
  const get = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const overlay = get('drive-overlay');
  const startButton = get<HTMLButtonElement>('drive-start');
  const pauseButton = get<HTMLButtonElement>('race-pause');
  const bloomButton = get<HTMLButtonElement>('race-bloom');
  const qualitySelect = get<HTMLSelectElement>('race-quality');
  const hazeButton = get<HTMLButtonElement>('race-haze');
  const soundButton = get<HTMLButtonElement>('race-sound');
  const musicButton = get<HTMLButtonElement>('race-music');
  musicButton.setAttribute('aria-pressed', String(soundtrack.enabled));
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
  const corner = get('corner-text');
  const notice = get('race-notice');
  const heightBars = get('height-level');
  const drivingOverlay = root.querySelector<HTMLElement>('.driving-overlay')!;
  const screen = root.querySelector<HTMLElement>('.drive-screen')!;
  const heightInstruction = get('height-instruction');
  const heightGuide = root.querySelector<HTMLElement>('.height-guide')!;
  let selectedDifficulty: DifficultyId = campaign ? trackPreset(campaign.track).id : 'beginner';
  let selectedMode: RaceMode = campaign?.mode ?? 'time-attack';
  const environment = selectRaceEnvironment(campaign?.track.district);
  let itemStates: RaceSnapshot['timeAttack']['items'] = [];
  let equippedRivalSlots: RivalItemId[] = [];
  let campaignOutcome: CampaignOutcome | undefined;
  let standingsKey = '';
  let lastPhase = '';
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
      get('result-reward').innerHTML = `<p>${outcome?.disqualified ? '실격' : '완주'} ${r.base}P${r.assisted ? ' · 보조 80%' : ''} · 클린 +${r.clean}P · 기록 +${r.best}P${r.bonus ? ` · 첫 통과 +${r.bonus}P` : ''}${r.penalty ? ` · 벌점 -${r.penalty}P` : ''}</p><p><strong>획득 ${r.total} P</strong> · 보유 ${profile.balance.toLocaleString()} P</p>`;
      if (campaign) {
        const passed = !outcome?.disqualified && (selectedMode === 'competition' ? outcome?.rank === 1 : outcome?.laps.length === campaign.track.laps && outcome.laps.every(lap => lap <= outcome.lapLimit));
        const next = TRACK_CATALOG.find(t => t.predecessor === campaign.track.id);
        get('campaign-result').textContent = passed ? next ? '트랙 통과 · 다음 코스가 열렸습니다.' : '캠페인 완주 · 모든 코스를 통과했습니다.' : outcome?.disqualified ? '랩 제한시간 초과 · 다시 도전하세요.' : '1위로 완주하면 다음 코스가 열립니다.';
        get('campaign-next').hidden = !passed || !next;
      }
    } catch (error) {
      if (!screenDisposed && rewardInput?.raceId === input.raceId) { get('result-reward').textContent = `보상을 저장하지 못했습니다. ${error instanceof Error ? error.message : ''}`; get('reward-retry').hidden = false; }
    } finally { rewardPending = false; if (!screenDisposed && rewardInput && rewardInput.raceId !== input.raceId) void saveReward(); }
  };
  get('race-loadout').textContent = focusSlots ? `보조 타임어택 · 집중 모드 ${focusSlots}개 · 기본 보상 80%` : '일반 타임어택 · 아이템 없음';
  let lastViewKey = '';
  let previewing = false;
  const preferences = get<HTMLDialogElement>('race-preferences');
  const paintMenu = () => {
    const racing = lastPhase === 'running' || lastPhase === 'countdown';
    overlay.hidden = racing || previewing || lost;
    get('view-preview').hidden = racing || !previewing || lost;
    screen.dataset.preview = String(previewing);
    pauseButton.innerHTML = `<span aria-hidden="true">${previewing ? '×' : lastPhase === 'paused' ? '▶' : 'Ⅱ'}</span>`;
    pauseButton.setAttribute('aria-label', previewing ? '메뉴로 돌아가기' : lastPhase === 'paused' ? '주행 계속하기' : '일시정지 메뉴');
    pauseButton.setAttribute('aria-expanded', String(lastPhase === 'paused' && !previewing));
    pauseButton.disabled = (lastPhase === 'ready' || lastPhase === 'finished') && !previewing;
  };
  const leavePreview = () => { previewing = false; paintMenu(); startButton.focus({ preventScroll: true }); };
  let lastCollisions = 0;
  let impactAnimation: Animation | undefined;
  let boostFlashAnimation: Animation | undefined;
  let lastBoostStage = 0;
  let lastAnnouncement = 0;
  let lost = false;
  let previousLevel = -1;
  let highlightUntil = 0;
  let overlayLayout = '';
  const update = (state: RaceSnapshot) => {
    const viewKey = `${state.view}/${state.trackDisplay}`;
    if (lastViewKey && lastViewKey !== viewKey && ['ready', 'paused', 'finished'].includes(state.phase) && !lost) previewing = true;
    lastViewKey = viewKey;
    const cameraAction = state.view === 'cockpit' ? '기체 보기' : '콕핏 보기';
    const trackAction = state.trackDisplay === 'hidden' ? '트랙 PIP 보기' : state.trackDisplay === 'pip' ? '트랙을 크게 보기' : '주행 화면만 보기';
    for (const id of ['race-view', 'preview-view']) get(id).innerHTML = `${cameraAction} <kbd>C</kbd>`;
    for (const id of ['race-track', 'preview-track']) get(id).innerHTML = `${trackAction} <kbd>X</kbd>`;
    get('pause-summary').textContent = `${campaign?.track.name ?? DIFFICULTIES[selectedDifficulty].label} · ${formatTime(state.elapsed)}`;
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
    focus.textContent = attack.focusRemaining > 0 ? `집중 ${attack.focusRemaining.toFixed(1)}s` : `집중 ${focusSlots - attack.focusUsed} · V`;
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
      get('result-status').textContent = competition ? `${competition.playerRank}위 · AI RACE COMPLETE` : attack.result?.isNewBest ? 'NEW BEST · 최고 기록 갱신' : attack.disqualified ? 'TIME LIMIT · 실격' : `${attack.totalLaps} LAPS COMPLETE`;
      get('result-total').textContent = formatTime(state.elapsed);
      get('result-laps').innerHTML = attack.lapTimes.map((lap, i) => `<li><span>LAP ${i + 1}</span><time>${formatTime(lap)}</time></li>`).join('');
      get('result-best').textContent = attack.result ? `최고 기록 ${formatTime(attack.result.best.total)}` : '제한시간 안에 매 랩을 완주해야 합니다.';
      get('result-penalties').textContent = state.penaltyPoints ? `코스 이탈 ${state.offTrackExits}회 · 벌점 -${state.penaltyPoints}P` : '';
      get('result-penalties').hidden = state.penaltyPoints === 0;
      get('record-warning').hidden = !attack.result || attack.result.saved;
      get('campaign-select').hidden = !campaign; get('campaign-next').hidden = true;
      get('campaign-result').textContent = campaign ? '캠페인 결과를 저장하고 있습니다…' : '';
      campaignOutcome = campaign ? { mode: selectedMode, trackId: campaign.track.id, revision: campaign.track.revision, total: state.elapsed, laps: attack.lapTimes, rank: competition?.playerRank ?? 1, disqualified: attack.disqualified, assisted: attack.assisted, lapLimit: attack.lapLimit ?? 1 } : undefined;
      get('result-shop').hidden = !onShop;
      rewardInput = { raceId: attack.raceId, difficulty: selectedDifficulty, collisions: state.collisions, offTrackExits: state.offTrackExits, recoveries: state.recoveries, penaltyPoints: state.penaltyPoints, improvedExistingBest: !!attack.result?.improvedExistingBest, assisted: attack.assisted };
      get('result-reward').textContent = store ? '완주 보상을 저장하고 있습니다…' : '';
      void saveReward();
    }
    if (state.collisions > lastCollisions && (state.notice === 'height-collision' || state.notice === 'craft-collision')) {
      const flash = get('race-impact');
      flash.style.setProperty('--impact-color', state.notice === 'craft-collision' ? '185, 236, 255' : state.heightObstacle?.kind === 'descend' ? '95, 170, 255' : '201, 132, 255');
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
    const announcement = get('race-announcement');
    announcement.hidden = !state.announcement || state.phase !== 'running';
    if (state.announcement && state.announcement.id !== lastAnnouncement) {
      lastAnnouncement = state.announcement.id;
      announcement.dataset.kind = state.announcement.kind;
      announcement.querySelector('strong')!.textContent = state.announcement.title;
      announcement.querySelector('span')!.textContent = state.announcement.detail;
    }
    if (state.announcement) {
      const age = Math.max(0, state.elapsed - state.announcement.startedAt);
      const remaining = state.announcement.duration - age;
      announcement.style.opacity = String(Math.min(1, age / 0.18, Math.max(0, remaining / 0.65)));
    }
    speed.textContent = Math.round(state.speed * 3.6).toString().padStart(3, '0');
    speed.parentElement!.dataset.boostStage = String(state.boostStage);
    const percentage = Math.round(state.charge * 100);
    charge.textContent = `${percentage}%`; meter.setAttribute('aria-valuenow', String(percentage));
    meterFill.style.transform = `scaleX(${state.charge})`;
    meter.classList.toggle('is-boosting', state.boosting);
    const stagePercent = Math.round(state.boostStageProgress * 100);
    stageFill.style.transform = `scaleX(${state.boostStageProgress})`;
    stageMeter.setAttribute('aria-valuenow', String(stagePercent));
    stageMeter.classList.toggle('is-stage2', state.boostStage === 2);
    meter.classList.toggle('is-stage2', state.boostStage === 2);
    const boostControl = coarsePointer.matches ? 'BOOST' : 'Space';
    boostStatus.textContent = state.boostStage === 2 ? '부스트 2단계 · 추가 가속'
      : state.boostStage === 1 ? `1단계 · 2단계 축적 ${stagePercent}%`
      : state.boostNeedsRelease ? `${boostControl}를 놓았다가 다시 눌러주세요` : percentage < 15 ? '회복 중'
      : `${boostControl} 유지 · ${state.boostStage2Seconds.toFixed(1)}초 후 2단계`;
    time.textContent = formatTime(state.elapsed);
    const levels = state.altitudeProfile.levels;
    // Keep altitude, boost and notices within the renderer’s driving viewport.
    const layoutKey = `${screen.clientWidth}/${screen.clientHeight}/${state.trackDisplay}/${state.view}/${coarsePointer.matches}`;
    if (layoutKey !== overlayLayout) {
      overlayLayout = layoutKey;
      const layout = raceViewLayout(screen.clientWidth, screen.clientHeight, state.trackDisplay, coarsePointer.matches);
      const viewport = layout.driving;
      Object.assign(drivingOverlay.style, { left: `${viewport.x}px`, top: `${screen.clientHeight - viewport.y - viewport.height}px`, width: `${viewport.width}px`, height: `${viewport.height}px` });
      const attachPause = coarsePointer.matches && state.trackDisplay !== 'hidden';
      pauseButton.classList.toggle('on-pip', attachPause);
      pauseButton.style.top = attachPause ? `max(env(safe-area-inset-top), ${screen.clientHeight - layout.inset.y - layout.inset.height - 22}px)` : '';
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
      const control = coarsePointer.matches ? '버튼' : '키';
      const action = nearest ? steps === 0 ? '고도 전환 중' : `${steps > 0 ? '↑' : '↓'} ${control} ${Math.abs(steps)}회` : '통과 고도 없음';
      heightInstruction.textContent = approaching && !safe ? action : '';
      heightGuide.classList.toggle('height-ready', safe);
      heightGuide.dataset.readiness = !settled ? 'switching' : safe ? 'ready' : 'blocked';
      heightGuide.classList.toggle('height-alert', approaching && !safe);
      heightGuide.classList.toggle('height-urgent', !safe && obstacle.distance < Math.max(35, state.speed * 1.5));
      heightGuide.dataset.kind = obstacle.kind;
    } else {
      heightGuide.dataset.readiness = settled ? 'neutral' : 'switching';
      heightInstruction.textContent = '';
      heightGuide.classList.remove('height-ready', 'height-alert', 'height-urgent');
    }
    const curvature = state.upcomingCurvature;
    corner.textContent = state.upcomingSection === 'vertical-loop' ? '수직 루프 · 자동 추종' : state.upcomingSection === 'helix' ? '스프링 · 자동 추종' : Math.abs(curvature) < 0.004 ? '직선' : `${curvature > 0 ? '우' : '좌'}회전${Math.abs(curvature) > 0.02 ? ' · 급한 코너' : ''}`;
    const nextNotice = state.notice === 'off-track' ? `코스 이탈 · -${OFF_TRACK_PENALTY_POINTS}P` : state.notice === 'craft-collision' ? '기체 접촉 · 감속' : state.notice === 'collision' ? '경계 접촉 · 감속' : state.notice === 'height-collision' ? '방전 접촉 · 급감속' : state.notice === 'recovery' ? '체크포인트 복귀' : '';
    if (notice.textContent !== nextNotice) notice.textContent = nextNotice;
    if (state.phase !== lastPhase) {
      lastPhase = state.phase;
      if (state.phase === 'running' || state.phase === 'countdown' || state.phase === 'finished') { previewing = false; preferences.close(); }
      get('difficulty-picker').hidden = !!campaign || state.phase !== 'ready';
      get('race-mode-picker').hidden = !!campaign || state.phase !== 'ready';
      get('difficulty-description').hidden = state.phase !== 'ready';
      get('pause-summary').hidden = state.phase !== 'paused';
      get('race-restart').hidden = state.phase !== 'paused';
      get('race-recover').hidden = state.phase !== 'paused';
      get<HTMLButtonElement>('race-recover').disabled = state.elapsed === 0;
      get('race-difficulty').hidden = state.phase !== 'paused' && state.phase !== 'finished';
      get('race-result').hidden = state.phase !== 'finished';
      get('ready-best').hidden = state.phase !== 'ready';
      screen.dataset.phase = state.phase;
      window.dispatchEvent(new CustomEvent('speedracer:phase', { detail: state.phase }));
      get('drive-overlay-title').textContent = state.phase === 'paused' ? '일시정지' : state.phase === 'finished' ? attack.disqualified ? '타임어택 실격' : '레이스 완료' : '레이스 준비';
      get('drive-overlay-copy').textContent = state.phase === 'ready' && campaign ? selectedMode === 'competition' ? `${campaign.track.laps}랩 경기에서 1위로 완주하면 다음 트랙이 열립니다.` : `매 랩 ${attack.lapLimit}초 안에 ${attack.totalLaps}랩을 완주하세요. 제한시간이 지나면 실격됩니다.` : state.phase === 'ready' ? (selectedMode === 'competition' ? `AI ${AI_OPPONENT_COUNT}대와 3랩을 겨룹니다. 직선에서 추월하고 급한 코너에서는 감속하세요.` : '3랩을 완주해 기록에 도전하세요. 자동으로 가속하며 급한 코너에서는 감속합니다.') : '';
      startButton.innerHTML = `${state.phase === 'paused' ? '계속하기' : state.phase === 'finished' ? '다시 도전' : '레이스 시작'} <span aria-hidden="true">↗</span>`;
      get('race-hangar').textContent = state.phase === 'paused' ? '포기하고 캠페인으로' : '캠페인으로';
      if (state.phase === 'paused' || state.phase === 'finished') startButton.focus({ preventScroll: true });
    }
    paintMenu();
  };
  const events = new AbortController();
  const listen = { signal: events.signal };
  // iOS long-press selection/callouts can originate on a control's child label.
  for (const type of ['contextmenu', 'selectstart', 'dragstart']) {
    screen.addEventListener(type, event => event.preventDefault(), listen);
  }
  coarsePointer.addEventListener('change', refreshHaptics, listen);
  let race: Race | undefined;
  const showError = () => {
    lost = true; preferences.close(); get('view-preview').hidden = true; overlay.hidden = true; get('drive-error').hidden = false;
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
    standingsKey = '';
    const profile = store?.snapshot();
    focusSlots = profile ? Math.min(profile.focusSlots, profile.focus) : 0;
    equippedRivalSlots = selectedMode === 'competition' && profile ? profile.rivalSlots.filter((item, index, slots) => slots.slice(0, index + 1).filter(id => id === item).length <= profile.rivalInventory[item]) : [];
    document.title = `Speedracer — ${selectedMode === 'competition' ? 'AI 레이스' : '타임어택'}`;
    get('race-mode-title').textContent = `${campaign?.track.name ?? 'NEON CIRCUIT'} · ${selectedMode === 'competition' ? 'AI RACE' : 'TIME ATTACK'}`;
    get('race-loadout').textContent = `${selectedMode === 'competition' ? `AI ${AI_OPPONENT_COUNT}대와 경쟁` : '타임어택'} · ${focusSlots || equippedRivalSlots.length ? `아이템 ${focusSlots + equippedRivalSlots.length}개 · 기본 보상 80%` : '아이템 없음'}`;
    rewardInput = undefined; campaignOutcome = undefined; get('result-reward').textContent = ''; get('reward-retry').hidden = true; get('result-shop').hidden = true;
    race?.dispose(); lastPhase = ''; lastViewKey = ''; previewing = false; lastCollisions = 0; lastBoostStage = 0; lastAnnouncement = 0; impactAnimation?.cancel(); boostFlashAnimation?.cancel();
    get('difficulty-description').textContent = `${campaign?.track.features ?? DIFFICULTIES[selectedDifficulty].description} · ${environment.label}`;
    try {
      race = createRace(get<HTMLDivElement>('race-scene'), update, showError, configuration, undefined, campaign ? trackPreset(campaign.track) : DIFFICULTIES[selectedDifficulty], focusSlots, selectedMode, campaign?.track, equippedRivalSlots, environment);
      race.setQuality(qualitySelect.value as RenderQuality);
      race.setExhaustHaze(hazeButton.getAttribute('aria-pressed') === 'true');
      race.setBloom(bloomButton.getAttribute('aria-pressed') === 'true');
      race.setSoundEnabled(soundButton.getAttribute('aria-pressed') === 'true');
      race.setMusicEnabled(musicButton.getAttribute('aria-pressed') === 'true');
      race.setHapticsEnabled(hapticsButton.getAttribute('aria-pressed') === 'true');
    } catch (error) { console.error('주행 화면 초기화 실패:', error); showError(); }
  };
  prepareRace();
  window.addEventListener('speedracer:pause-request', () => { if (lastPhase === 'running' || lastPhase === 'countdown') race?.togglePause(); }, listen);
  window.addEventListener('speedracer:menu-back', () => {
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
  get('race-difficulty').textContent = campaign ? '트랙 선택' : '난이도 변경';
  get('campaign-select').addEventListener('click', onExit, listen);
  get('campaign-next').addEventListener('click', () => { const next = TRACK_CATALOG.find(t => t.predecessor === campaign?.track.id); if (next) location.hash = `drive?track=${next.id}&mode=${selectedMode}`; }, listen);
  get('race-difficulty').addEventListener('click', () => { if (campaign) { onExit(); return; } prepareRace(); get('difficulty-picker').querySelector<HTMLInputElement>('input:checked')?.focus(); }, listen);
  for (const id of ['race-view', 'preview-view']) get(id).addEventListener('click', () => { get(id).blur(); race?.toggleCockpit(); }, listen);
  for (const id of ['race-track', 'preview-track']) get(id).addEventListener('click', () => { get(id).blur(); race?.cycleTrack(); }, listen);
  get('preview-back').addEventListener('click', leavePreview, listen);
  get('race-settings').addEventListener('click', () => preferences.showModal(), listen);
  get('preferences-close').addEventListener('click', () => preferences.close(), listen);
  window.addEventListener('keydown', event => {
    if (event.code !== 'Escape' || !previewing || preferences.open) return;
    event.preventDefault(); event.stopImmediatePropagation(); leavePreview();
  }, { ...listen, capture: true });
  startButton.addEventListener('click', () => { startButton.blur(); if (lastPhase === 'finished') prepareRace(); race?.start(); }, listen);
  pauseButton.addEventListener('click', () => { pauseButton.blur(); if (previewing) leavePreview(); else race?.togglePause(); }, listen);
  const restartRace = () => { prepareRace(); race?.start(); };
  get('race-restart').addEventListener('click', restartRace, listen);
  window.addEventListener('speedracer:restart-request', restartRace, listen);
  get('race-recover').addEventListener('click', () => race?.recover(), listen);
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
    soundButton.setAttribute('aria-pressed', String(enabled)); race?.setSoundEnabled(enabled);
  }, listen);
  musicButton.addEventListener('click', () => {
    const enabled = musicButton.getAttribute('aria-pressed') !== 'true';
    musicButton.setAttribute('aria-pressed', String(enabled)); race?.setMusicEnabled(enabled);
  }, listen);
  hapticsButton.addEventListener('click', () => {
    const enabled = hapticsButton.getAttribute('aria-pressed') !== 'true';
    hapticsButton.setAttribute('aria-pressed', String(enabled)); race?.setHapticsEnabled(enabled);
  }, listen);
  return () => { screenDisposed = true; preferences.close(); impactAnimation?.cancel(); boostFlashAnimation?.cancel(); events.abort(); race?.dispose(); window.dispatchEvent(new CustomEvent('speedracer:phase', { detail: 'hangar' })); };
}
