import { DIFFICULTIES } from './game/track/difficulty';
import type { DifficultyId } from './game/track/difficulty';
import { raceViewLayout } from './game/driving/createRaceViews';
import { createRace } from './game/driving/createRace';
import type { Race, RaceSnapshot } from './game/driving/createRace';
import './race.css';

const formatTime = (seconds: number) => {
  const ms = Math.round(Math.max(0, seconds) * 1000);
  return `${Math.floor(ms / 60000).toString().padStart(2, '0')}:${Math.floor(ms / 1000 % 60).toString().padStart(2, '0')}.${(ms % 1000).toString().padStart(3, '0')}`;
};

export function mountRace(root: HTMLDivElement, onHangar: () => void): () => void {
  document.title = 'Speedracer — 타임어택';
  root.innerHTML = `
    <main class="drive-screen">
      <div id="race-scene" class="race-scene"></div>
      <div id="race-impact" class="race-impact" aria-hidden="true"></div>
      <header class="race-header">
        <div class="race-telemetry" aria-label="주행 정보"><div class="telemetry-row"><span class="speed-readout"><strong id="drive-speed">000</strong><span class="mono">KM/H</span></span><span id="race-lap" class="lap-readout mono">LAP 1/3</span><time id="drive-time" class="mono">00:00.000</time></div><div class="corner-guide"><strong id="corner-text">직선</strong><span class="corner-hint">급한 코너에서는 S로 감속</span></div></div>
      </header>
      <button type="button" id="race-pause" class="race-pause" aria-label="일시정지 메뉴" aria-keyshortcuts="Escape" aria-controls="drive-overlay" aria-expanded="false"><span aria-hidden="true">Ⅱ</span></button>
      <div class="driving-overlay"><p id="race-notice" class="race-notice" role="status" aria-live="polite"></p><div id="race-countdown" class="race-countdown" role="status" aria-live="assertive" hidden><span>READY</span><strong>3</strong></div>
      <footer class="drive-hud" aria-label="고도와 부스트 계기판">
        <aside class="height-guide" aria-label="고도 안내: 청록색은 현재, 주황색은 통과 목표"><div id="height-level" class="height-bars"></div><strong id="height-instruction"></strong></aside>
        <div class="boost-readout"><div class="hud-pair"><span class="hud-label">BOOST</span><span id="boost-value" class="mono">100%</span></div><div id="boost-meter" class="boost-meter" role="progressbar" aria-label="부스트 잔량" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100"><span></span></div><div id="boost-stage-meter" class="boost-stage-meter" role="progressbar" aria-label="부스트 2단계 축적" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span></span></div><span id="boost-status">Space 유지 · 3초 후 2단계</span></div>
      </footer></div>
      <section id="drive-overlay" class="drive-overlay" aria-labelledby="drive-overlay-title">
        <div class="drive-dialog">
          <p class="eyebrow">NEON CIRCUIT · TIME ATTACK</p><h2 id="drive-overlay-title">레이스 준비</h2><p id="drive-overlay-copy"></p>
          <p id="pause-summary" class="pause-summary" hidden></p>
          <section id="race-result" class="race-result" aria-label="경기 결과" hidden><p id="result-status" class="result-status"></p><time id="result-total" class="result-total"></time><ol id="result-laps" class="result-laps"></ol><p id="result-best"></p><p id="record-warning" class="record-warning" hidden>기록을 저장하지 못했습니다. 이번 화면에서 확인할 수 있습니다.</p></section>
          <fieldset id="difficulty-picker" class="difficulty-picker"><legend>난이도</legend><div><label><input type="radio" name="difficulty" value="beginner" checked /><span>초급</span></label><label><input type="radio" name="difficulty" value="intermediate" /><span>중급</span></label><label><input type="radio" name="difficulty" value="advanced" /><span>고급</span></label></div></fieldset><p id="difficulty-description" class="difficulty-description"></p>
          <p id="ready-best" class="ready-best"></p><button type="button" id="drive-start" class="primary-action">레이스 시작 <span aria-hidden="true">↗</span></button>
          <button type="button" id="race-hangar" class="race-exit">격납고로</button>
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
        <div class="preference-options"><button type="button" id="race-bloom" aria-pressed="true"><span>네온 발광 <small>Bloom</small></span></button><button type="button" id="race-sound" aria-pressed="true"><span>부스트 음향</span></button><button type="button" id="race-haptics" aria-pressed="true"><span>진동</span></button></div>
        <details class="control-help"><summary>조작 안내</summary>
          <div class="drive-keys"><span>자동 가속 · <kbd>S</kbd> 감속</span><span><kbd>A</kbd> <kbd>D</kbd> 좌우 조향</span><span><kbd>↓</kbd> <kbd>↑</kbd> 고도 한 단계 전환</span><span><kbd>Space</kbd> 길게 눌러 부스트</span><span><kbd>C</kbd> 기체·콕핏 전환</span><span><kbd>X</kbd> 트랙 PIP·자리 교환·닫기</span><span><kbd>F</kbd> 체크포인트 복귀</span><span><kbd>Esc</kbd> 일시정지·계속하기</span></div>
          <p class="touch-help">자동으로 가속합니다. 왼쪽 조이스틱은 좌우 조향, 아래로 당기면 감속합니다. 대각선으로 두 조작을 함께 할 수 있습니다.<br />오른쪽 ↑/↓ 버튼은 고도를 한 단계 바꾸고, BOOST는 길게 눌러 사용합니다. 3초 연속 부스트 시 2단계에 진입합니다.<br />시점은 일시정지 메뉴의 화면 미리보기에서 바꿀 수 있습니다.</p>
        </details>
      </dialog>
      <section id="drive-error" class="drive-overlay" role="alert" hidden><div class="drive-dialog"><h2>3D 화면 연결이<br />끊어졌습니다.</h2><p>다시 불러온 후 주행을 시작해주세요.</p><button type="button" id="drive-retry" class="primary-action">다시 불러오기</button></div></section>
    </main>`;
  const get = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const overlay = get('drive-overlay');
  const startButton = get<HTMLButtonElement>('drive-start');
  const pauseButton = get<HTMLButtonElement>('race-pause');
  const bloomButton = get<HTMLButtonElement>('race-bloom');
  const soundButton = get<HTMLButtonElement>('race-sound');
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
  let selectedDifficulty: DifficultyId = 'beginner';
  let lastPhase = '';
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
    get('pause-summary').textContent = `${DIFFICULTIES[selectedDifficulty].label} · ${formatTime(state.elapsed)}`;
    const attack = state.timeAttack;
    get('race-lap').textContent = `LAP ${attack.lap}/${attack.totalLaps}`;
    get('race-lap').setAttribute('aria-label', `${attack.totalLaps}랩 중 ${attack.lap}랩`);
    get('ready-best').textContent = attack.bestRecord ? `최고 기록 ${formatTime(attack.bestRecord.total)}` : '3랩 · 아직 최고 기록이 없습니다';
    get('race-countdown').hidden = state.phase !== 'countdown' && !(state.phase === 'running' && state.elapsed < 0.65);
    get('race-countdown').querySelector('strong')!.textContent = state.phase === 'running' ? 'GO' : String(attack.countdown);
    get('race-countdown').querySelector('span')!.textContent = state.phase === 'running' ? 'RACE START' : 'READY';
    if (state.phase === 'finished' && lastPhase !== 'finished') {
      get('result-status').textContent = attack.result?.isNewBest ? 'NEW BEST · 최고 기록 갱신' : '3 LAPS COMPLETE';
      get('result-total').textContent = formatTime(state.elapsed);
      get('result-laps').innerHTML = attack.lapTimes.map((lap, i) => `<li><span>LAP ${i + 1}</span><time>${formatTime(lap)}</time></li>`).join('');
      get('result-best').textContent = `최고 기록 ${formatTime(attack.result!.best.total)}`;
      get('record-warning').hidden = attack.result!.saved;
    }
    if (state.collisions > lastCollisions && state.notice === 'height-collision') {
      const flash = get('race-impact');
      flash.style.setProperty('--impact-color', state.heightObstacle?.kind === 'descend' ? '95, 170, 255' : '201, 132, 255');
      impactAnimation?.cancel();
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      impactAnimation = flash.animate([{ opacity: 0 }, { opacity: reduced ? 0.08 : 0.26, offset: 0.12 }, { opacity: 0 }], { duration: reduced ? 400 : 280 });
    }
    lastCollisions = state.collisions;
    speed.textContent = Math.round(state.speed * 3.6).toString().padStart(3, '0');
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
    const currentLevel = levels.reduce((best, height, index) => Math.abs(height - state.altitude) < Math.abs(levels[best] - state.altitude) ? index : best, 0);
    heightGuide.setAttribute('aria-label', `현재 고도 ${currentLevel + 1}/${levels.length} · 청록색 현재, 주황색 통과 목표`);
    if (state.altitudeLevel !== previousLevel) {
      if (previousLevel >= 0) highlightUntil = performance.now() + 900;
      previousLevel = state.altitudeLevel;
    }
    heightGuide.classList.toggle('height-changed', performance.now() < highlightUntil);
    const obstacle = state.heightObstacle;
    [...heightBars.children].forEach((line, index) => {
      line.classList.toggle('is-active', index === currentLevel);
      line.classList.toggle('is-safe', Boolean(obstacle && levels[index] >= obstacle.minAltitude && levels[index] <= obstacle.maxAltitude));
    });
    if (obstacle) {
      const safeLevels = levels.map((height, index) => ({ height, index })).filter(({ height }) => height >= obstacle.minAltitude && height <= obstacle.maxAltitude);
      const nearest = safeLevels.sort((a, b) => Math.abs(a.index - state.altitudeLevel) - Math.abs(b.index - state.altitudeLevel))[0];
      const steps = nearest ? nearest.index - state.altitudeLevel : 0;
      const safe = state.altitude >= obstacle.minAltitude && state.altitude <= obstacle.maxAltitude;
      const approaching = obstacle.distance < Math.max(60, state.speed * 3);
      const control = coarsePointer.matches ? '버튼' : '키';
      const action = nearest ? steps === 0 ? '고도 전환 중' : `${steps > 0 ? '↑' : '↓'} ${control} ${Math.abs(steps)}회` : '통과 고도 없음';
      heightInstruction.textContent = approaching && !safe ? action : '';
      heightGuide.classList.toggle('height-ready', safe);
      heightGuide.classList.toggle('height-alert', approaching && !safe);
      heightGuide.classList.toggle('height-urgent', !safe && obstacle.distance < Math.max(35, state.speed * 1.5));
      heightGuide.dataset.kind = obstacle.kind;
    } else {
      heightInstruction.textContent = '';
      heightGuide.classList.remove('height-ready', 'height-alert', 'height-urgent');
    }
    const curvature = state.upcomingCurvature;
    corner.textContent = state.upcomingSection === 'vertical-loop' ? '수직 루프 · 자동 추종' : state.upcomingSection === 'helix' ? '스프링 · 자동 추종' : Math.abs(curvature) < 0.004 ? '직선' : `${curvature > 0 ? '우' : '좌'}회전${Math.abs(curvature) > 0.02 ? ' · 급한 코너' : ''}`;
    const nextNotice = attack.missedCheckpoint ? `체크포인트 누락 · ${coarsePointer.matches ? '일시정지 메뉴에서 복귀' : 'F로 복귀'}` : state.notice === 'collision' ? '경계 접촉 · 감속' : state.notice === 'height-collision' ? '방전 접촉 · 급감속' : state.notice === 'recovery' ? '체크포인트 복귀' : '';
    if (notice.textContent !== nextNotice) notice.textContent = nextNotice;
    if (state.phase !== lastPhase) {
      lastPhase = state.phase;
      if (state.phase === 'running' || state.phase === 'countdown' || state.phase === 'finished') { previewing = false; preferences.close(); }
      get('difficulty-picker').hidden = state.phase !== 'ready';
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
      get('drive-overlay-title').textContent = state.phase === 'paused' ? '일시정지' : state.phase === 'finished' ? '레이스 완료' : '레이스 준비';
      get('drive-overlay-copy').textContent = state.phase === 'ready' ? '체크포인트를 차례로 통과해 3랩을 완주하세요. 자동으로 가속하며 급한 코너에서는 감속합니다.' : '';
      startButton.innerHTML = `${state.phase === 'paused' ? '계속하기' : state.phase === 'finished' ? '다시 도전' : '레이스 시작'} <span aria-hidden="true">↗</span>`;
      get('race-hangar').textContent = state.phase === 'paused' ? '포기하고 격납고로' : '격납고로';
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
    get<HTMLButtonElement>('race-restart').disabled = true; pauseButton.disabled = true; bloomButton.disabled = true; soundButton.disabled = true; hapticsButton.disabled = true; get<HTMLButtonElement>('race-view').disabled = true; get<HTMLButtonElement>('race-track').disabled = true; get<HTMLButtonElement>('race-settings').disabled = true;
  };
  get('race-hangar').addEventListener('click', onHangar, listen);
  get('drive-retry').addEventListener('click', () => location.reload(), listen);
  const prepareRace = () => {
    race?.dispose(); lastPhase = ''; lastViewKey = ''; previewing = false; lastCollisions = 0; impactAnimation?.cancel();
    get('difficulty-description').textContent = DIFFICULTIES[selectedDifficulty].description;
    try {
      race = createRace(get<HTMLDivElement>('race-scene'), update, showError, undefined, undefined, DIFFICULTIES[selectedDifficulty]);
      race.setBloom(bloomButton.getAttribute('aria-pressed') === 'true');
      race.setSoundEnabled(soundButton.getAttribute('aria-pressed') === 'true');
      race.setHapticsEnabled(hapticsButton.getAttribute('aria-pressed') === 'true');
    } catch (error) { console.error('주행 화면 초기화 실패:', error); showError(); }
  };
  prepareRace();
  window.addEventListener('speedracer:pause-request', () => { if (lastPhase === 'running' || lastPhase === 'countdown') race?.togglePause(); }, listen);
  get('difficulty-picker').addEventListener('change', event => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !(target.value in DIFFICULTIES)) return;
    selectedDifficulty = target.value as DifficultyId; prepareRace();
  }, listen);
  get('race-difficulty').addEventListener('click', () => { prepareRace(); get('difficulty-picker').querySelector<HTMLInputElement>('input:checked')?.focus(); }, listen);
  for (const id of ['race-view', 'preview-view']) get(id).addEventListener('click', () => { get(id).blur(); race?.toggleCockpit(); }, listen);
  for (const id of ['race-track', 'preview-track']) get(id).addEventListener('click', () => { get(id).blur(); race?.cycleTrack(); }, listen);
  get('preview-back').addEventListener('click', leavePreview, listen);
  get('race-settings').addEventListener('click', () => preferences.showModal(), listen);
  get('preferences-close').addEventListener('click', () => preferences.close(), listen);
  window.addEventListener('keydown', event => {
    if (event.code !== 'Escape' || !previewing || preferences.open) return;
    event.preventDefault(); event.stopImmediatePropagation(); leavePreview();
  }, { ...listen, capture: true });
  startButton.addEventListener('click', () => { startButton.blur(); race?.start(); }, listen);
  pauseButton.addEventListener('click', () => { pauseButton.blur(); if (previewing) leavePreview(); else race?.togglePause(); }, listen);
  get('race-restart').addEventListener('click', () => race?.restart(), listen);
  get('race-recover').addEventListener('click', () => race?.recover(), listen);
  bloomButton.addEventListener('click', () => {
    const enabled = bloomButton.getAttribute('aria-pressed') !== 'true';
    bloomButton.setAttribute('aria-pressed', String(enabled)); race?.setBloom(enabled);
  }, listen);
  soundButton.addEventListener('click', () => {
    const enabled = soundButton.getAttribute('aria-pressed') !== 'true';
    soundButton.setAttribute('aria-pressed', String(enabled)); race?.setSoundEnabled(enabled);
  }, listen);
  hapticsButton.addEventListener('click', () => {
    const enabled = hapticsButton.getAttribute('aria-pressed') !== 'true';
    hapticsButton.setAttribute('aria-pressed', String(enabled)); race?.setHapticsEnabled(enabled);
  }, listen);
  return () => { preferences.close(); impactAnimation?.cancel(); events.abort(); race?.dispose(); window.dispatchEvent(new CustomEvent('speedracer:phase', { detail: 'hangar' })); };
}
