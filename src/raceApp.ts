import { DIFFICULTIES } from './game/track/difficulty';
import type { DifficultyId } from './game/track/difficulty';
import { VIEW_LABELS, TRACK_DISPLAY_LABELS } from './game/driving/createRaceViews';
import { createRace } from './game/driving/createRace';
import type { Race, RaceSnapshot } from './game/driving/createRace';
import './race.css';

const formatTime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  return `${minutes}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;
};

export function mountRace(root: HTMLDivElement, onHangar: () => void): () => void {
  document.title = 'Speedracer — 주행 테스트';
  root.innerHTML = `
    <main class="drive-screen">
      <div id="race-scene" class="race-scene"></div>
      <div id="race-impact" class="race-impact" aria-hidden="true"></div>
      <header class="race-header">
        <div class="race-identity"><span class="race-brand">SPEEDRACER</span><span class="mono">주행 테스트 / 01</span></div>
        <nav class="race-actions" aria-label="주행 메뉴">
          <button type="button" id="race-hangar">격납고</button>
          <button type="button" id="race-settings">난이도</button><button type="button" id="race-view">추적 <kbd>C</kbd></button><button type="button" id="race-track">트랙 보기 <kbd>X</kbd></button><button type="button" id="race-restart">다시 시작 <kbd>R</kbd></button>
          <button type="button" id="race-pause">일시정지 <kbd>Esc</kbd></button>
          <button type="button" id="race-bloom" aria-pressed="true">Bloom</button>
          <button type="button" id="race-sound" aria-pressed="true">음향</button>
          <button type="button" id="race-haptics" aria-pressed="true">진동</button>
        </nav>
      </header>
      <div class="course-label"><p class="mono">SECTOR 01 / FREE PRACTICE</p><h1>NEON LOOP<span><span id="course-mode">초급 · 추적 시점</span></span></h1></div>
      <div class="corner-guide"><span class="mono">전방 구간</span><strong id="corner-text">직선</strong><span>급한 코너에서는 S로 감속</span></div>
      <aside class="height-guide" aria-label="고도 안내"><span class="hud-label">FLIGHT HEIGHT · <kbd>↓</kbd> 하강 <kbd>↑</kbd> 상승</span><div class="height-current"><strong id="height-current">1.8</strong><span class="mono">M</span></div><div class="height-meter"><span id="height-safe"></span><i id="height-marker"></i></div><span id="height-level" class="mono">1 / 2 단계</span><strong id="height-instruction">상승 준비</strong><span id="height-distance">전방 장애물</span></aside>
      <p id="race-notice" class="race-notice" role="status" aria-live="polite"></p>
      <footer class="drive-hud" aria-label="주행 계기판">
        <div class="speed-readout"><span class="hud-label">속도</span><div><strong id="drive-speed">000</strong><span class="mono">KM/H</span></div></div>
        <div class="boost-readout"><div class="hud-pair"><span class="hud-label">부스트 <kbd>Space</kbd></span><span id="boost-value" class="mono">100%</span></div><div id="boost-meter" class="boost-meter" role="progressbar" aria-label="부스트 잔량" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100"><span></span></div><div id="boost-stage-meter" class="boost-stage-meter" role="progressbar" aria-label="부스트 2단계 축적" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span></span></div><span id="boost-status">Space 유지 · 3초 후 2단계</span></div>
        <dl class="drive-stats"><div><dt>경과 시간</dt><dd id="drive-time" class="mono">00:00.0</dd></div><div><dt>트랙 진행</dt><dd id="drive-progress" class="mono">0%</dd></div><div><dt>상대 고도</dt><dd id="drive-altitude" class="mono">1.8 M</dd></div></dl>
        <div class="drive-keys"><span><kbd>W</kbd><kbd>S</kbd> 가속 / 감속</span><span><kbd>A</kbd><kbd>D</kbd> 좌우 조향</span><span><kbd>↓</kbd><kbd>↑</kbd> 한 단계 하강 / 상승</span><span><kbd>C</kbd> 추적 / 콕핏</span><span><kbd>X</kbd> 트랙 PIP</span><span><kbd>F</kbd> 트랙 복귀</span></div>
      </footer>
      <section id="drive-overlay" class="drive-overlay" aria-labelledby="drive-overlay-title">
        <div class="drive-dialog"><p class="eyebrow">DR–01 / FREE PRACTICE</p><h2 id="drive-overlay-title">첫 주행을<br />시작해 보세요.</h2><p id="drive-overlay-copy">가속하고, 코너에 맞춰 조향하세요.<br />↓/↑를 한 번 누르면 인접 고도로 빠르게 전환합니다.<br />양쪽 기둥 사이의 전기 아크에 닿으면 속도가 크게 줄어듭니다.</p><p class="drive-scope">자유 주행 테스트 · 경기와 기록 저장은 다음 단계에서 연결합니다.</p><fieldset id="difficulty-picker" class="difficulty-picker"><legend>난이도 · 트랙과 장애물</legend>${Object.values(DIFFICULTIES).map(preset => `<label><input type="radio" name="difficulty" value="${preset.id}" ${preset.id === 'beginner' ? 'checked' : ''} /><span>${preset.label}<small>고도 ${preset.altitude.levels.length}단계</small></span></label>`).join('')}</fieldset><p id="difficulty-description" class="difficulty-description">${DIFFICULTIES.beginner.description}</p><button type="button" id="drive-start" class="primary-action">주행 시작 <span aria-hidden="true">↗</span></button><p class="keyboard-note">키보드 또는 터치로 조종합니다. 모바일은 자동 가속하며 감속 버튼으로 속도를 줄입니다. 화면을 벗어나면 자동으로 일시정지됩니다.</p></div>
      </section>
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
    root.querySelector('.corner-guide span:last-child')!.textContent = coarsePointer.matches ? '급한 코너에서는 감속 버튼' : '급한 코너에서는 S로 감속';
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
  const progress = get('drive-progress');
  const altitude = get('drive-altitude');
  const corner = get('corner-text');
  const notice = get('race-notice');
  const heightCurrent = get('height-current');
  const heightMarker = get('height-marker');
  const heightSafe = get('height-safe');
  const heightInstruction = get('height-instruction');
  const heightDistance = get('height-distance');
  const heightGuide = root.querySelector<HTMLElement>('.height-guide')!;
  let selectedDifficulty: DifficultyId = 'beginner';
  let lastPhase = '';
  let lastCollisions = 0;
  let impactAnimation: Animation | undefined;
  let lost = false;
  const update = (state: RaceSnapshot) => {
    get('course-mode').textContent = `${DIFFICULTIES[selectedDifficulty].label} · ${state.trackDisplay === 'primary' ? '전체 트랙' : VIEW_LABELS[state.view]} 시점`;
    get('race-view').innerHTML = `${VIEW_LABELS[state.view]} <kbd>C</kbd>`;
    get('race-view').setAttribute('aria-pressed', String(state.view === 'cockpit'));
    get('race-track').innerHTML = `${TRACK_DISPLAY_LABELS[state.trackDisplay]} <kbd>X</kbd>`;
    get('race-track').setAttribute('aria-pressed', String(state.trackDisplay !== 'hidden'));
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
    progress.textContent = `${Math.floor(state.distance % state.trackLength / state.trackLength * 100)}%`;
    altitude.textContent = `${state.altitude.toFixed(1)} M`;
    heightCurrent.textContent = state.altitude.toFixed(1);
    const levels = state.altitudeProfile.levels;
    const minHeight = levels[0], maxHeight = levels[levels.length - 1];
    const heightPercent = (height: number) => Math.max(0, Math.min(100, (height - minHeight) / (maxHeight - minHeight) * 100));
    get('height-level').textContent = `${state.altitudeLevel + 1} / ${levels.length} 단계`;
    heightMarker.style.bottom = `${heightPercent(state.altitude)}%`;
    const obstacle = state.heightObstacle;
    if (obstacle) {
      heightSafe.style.bottom = `${heightPercent(obstacle.minAltitude)}%`;
      heightSafe.style.height = `${heightPercent(obstacle.maxAltitude) - heightPercent(obstacle.minAltitude)}%`;
      const safeLevels = levels.map((height, index) => ({ height, index })).filter(({ height }) => height >= obstacle.minAltitude && height <= obstacle.maxAltitude);
      const nearest = safeLevels.sort((a, b) => Math.abs(a.index - state.altitudeLevel) - Math.abs(b.index - state.altitudeLevel))[0];
      const steps = nearest ? nearest.index - state.altitudeLevel : 0;
      const action = nearest ? steps === 0 ? '고도 유지' : `${steps > 0 ? '↑' : '↓'} ${Math.abs(steps)}회` : '통과 고도 없음';
      heightInstruction.textContent = `${action} · ${obstacle.kind === 'middle' ? `${obstacle.minAltitude.toFixed(1)}–${obstacle.maxAltitude.toFixed(1)}m` : obstacle.kind === 'rise' ? `${obstacle.minAltitude.toFixed(1)}m 이상` : `${obstacle.maxAltitude.toFixed(1)}m 이하`}`;
      heightDistance.textContent = `전방 ${Math.ceil(obstacle.distance)}m · ${obstacle.kind === 'middle' ? '중간 고도 통과' : obstacle.kind === 'rise' ? '하단' : '상단'} 방전 장벽`;
      const safe = state.altitude >= obstacle.minAltitude && state.altitude <= obstacle.maxAltitude;
      heightGuide.classList.toggle('height-ready', safe);
      heightGuide.classList.toggle('height-urgent', !safe && obstacle.distance < Math.max(35, state.speed * 1.5));
      heightGuide.dataset.kind = obstacle.kind;
    }
    const curvature = state.upcomingCurvature;
    corner.textContent = state.upcomingSection === 'vertical-loop' ? '수직 루프 · 자동 추종' : state.upcomingSection === 'helix' ? '스프링 · 자동 추종' : Math.abs(curvature) < 0.004 ? '직선' : `${curvature > 0 ? '우' : '좌'}회전${Math.abs(curvature) > 0.02 ? ' · 급한 코너' : ''}`;
    const nextNotice = state.notice === 'collision' ? '경계 접촉 · 속도가 줄었습니다' : state.notice === 'height-collision' ? '방전 장벽 접촉 · 속도가 크게 줄었습니다' : state.notice === 'recovery' ? '체크포인트로 복귀했습니다' : '';
    if (notice.textContent !== nextNotice) notice.textContent = nextNotice;
    if (state.phase !== lastPhase) {
      lastPhase = state.phase;
      get('difficulty-picker').hidden = state.phase !== 'ready';
      get('difficulty-description').hidden = state.phase !== 'ready';
      overlay.hidden = state.phase === 'running' || lost;
      pauseButton.innerHTML = `${state.phase === 'paused' ? '계속하기' : '일시정지'} <kbd>Esc</kbd>`;
      pauseButton.disabled = state.phase === 'ready';
      if (state.phase === 'ready') {
        get('drive-overlay-title').innerHTML = '첫 주행을<br />시작해 보세요.';
        get('drive-overlay-copy').textContent = coarsePointer.matches
          ? '자동 가속합니다. 왼쪽에서 좌우 조향·감속, 오른쪽에서 고도 전환·부스트를 조작하세요. 위의 시점·트랙 버튼으로 화면을 바꿀 수 있습니다.'
          : '난이도를 선택하고 출발하세요. ↓/↑는 고도 전환, C는 추적·콕핏 전환, X는 트랙 PIP와 자리 교환입니다.';
        startButton.innerHTML = '주행 시작 <span aria-hidden="true">↗</span>';
      }
      if (state.phase === 'paused') {
        get('drive-overlay-title').textContent = '잠시 멈췄습니다.';
        get('drive-overlay-copy').textContent = '준비되면 계속하기 또는 Esc를 눌러주세요.';
        startButton.innerHTML = '계속하기 <span aria-hidden="true">↗</span>';
        startButton.focus({ preventScroll: true });
      }
    }
  };
  const events = new AbortController();
  const listen = { signal: events.signal };
  coarsePointer.addEventListener('change', refreshHaptics, listen);
  let race: Race | undefined;
  const showError = () => {
    lost = true; overlay.hidden = true; get('drive-error').hidden = false;
    get<HTMLButtonElement>('race-restart').disabled = true; pauseButton.disabled = true; bloomButton.disabled = true; soundButton.disabled = true; hapticsButton.disabled = true; get<HTMLButtonElement>('race-view').disabled = true; get<HTMLButtonElement>('race-track').disabled = true; get<HTMLButtonElement>('race-settings').disabled = true;
  };
  get('race-hangar').addEventListener('click', onHangar, listen);
  get('drive-retry').addEventListener('click', () => location.reload(), listen);
  const prepareRace = () => {
    race?.dispose(); lastPhase = ''; lastCollisions = 0; impactAnimation?.cancel();
    get('difficulty-description').textContent = DIFFICULTIES[selectedDifficulty].description;
    try {
      race = createRace(get<HTMLDivElement>('race-scene'), update, showError, undefined, undefined, DIFFICULTIES[selectedDifficulty]);
      race.setBloom(bloomButton.getAttribute('aria-pressed') === 'true');
      race.setSoundEnabled(soundButton.getAttribute('aria-pressed') === 'true');
      race.setHapticsEnabled(hapticsButton.getAttribute('aria-pressed') === 'true');
    } catch (error) { console.error('주행 화면 초기화 실패:', error); showError(); }
  };
  prepareRace();
  get('difficulty-picker').addEventListener('change', event => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !(target.value in DIFFICULTIES)) return;
    selectedDifficulty = target.value as DifficultyId; prepareRace();
  }, listen);
  get('race-settings').addEventListener('click', () => { prepareRace(); get('difficulty-picker').querySelector<HTMLInputElement>('input:checked')?.focus(); }, listen);
  get('race-view').addEventListener('click', () => { get<HTMLButtonElement>('race-view').blur(); race?.toggleCockpit(); }, listen);
  get('race-track').addEventListener('click', () => { get<HTMLButtonElement>('race-track').blur(); race?.cycleTrack(); }, listen);
  startButton.addEventListener('click', () => { startButton.blur(); race?.start(); }, listen);
  pauseButton.addEventListener('click', () => race?.togglePause(), listen);
  get('race-restart').addEventListener('click', () => race?.restart(), listen);
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
  return () => { impactAnimation?.cancel(); events.abort(); race?.dispose(); };
}
