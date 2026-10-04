import { DRONE_CATALOG, droneStats } from './game/drone/droneCatalog';
import type { DroneCatalogEntry } from './game/drone/droneCatalog';
import { mountRace } from './raceApp';
import { createHangar } from './game/createHangar';
import type { Hangar } from './game/createHangar';
import type { ThrustMode } from './game/drone/createThrusterEffect';

function mountHangar(root: HTMLDivElement, selected: DroneCatalogEntry, onSelect: (entry: DroneCatalogEntry) => void, onDrive: () => void): () => void {
  document.title = 'Speedracer · 격납고';
  root.innerHTML = `
    <main class="hangar">
      <header class="masthead">
        <a class="wordmark" href="/" aria-label="Speedracer 홈">
          <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M20 3 7 17h10l-5 12L26 13H16z"/></svg>
          SPEEDRACER<span class="wordmark-divider"></span><span class="wordmark-caption">DRONE RACING</span>
        </a>
        <div class="app-tools" data-app-tools></div><span class="location"><span class="status-dot"></span>격납고 <span class="mono">/ 01</span></span>
      </header>

      <section class="introduction" aria-labelledby="drone-title">
        <p class="eyebrow"><span class="short-rule"></span> PILOTED RACING DRONE</p>
        <h1 id="drone-title">RACING<br /><span>DRONE.</span></h1>
        <div class="craft-picker"><label for="craft-select">기체 선택</label><select id="craft-select">${DRONE_CATALOG.map((entry) => `<option value="${entry.configuration.id}" ${entry === selected ? 'selected' : ''}>${entry.name} · ${entry.role}</option>`).join('')}</select></div>
        <div class="model-id"><span class="mono" id="craft-name"></span><span id="craft-role"></span></div>
        <p id="craft-description" class="craft-description"></p>
        <dl id="craft-stats" class="craft-stats"></dl>
        <p class="craft-trial">상점 오픈 전 · 모든 기체 시험 주행 가능</p>
        <div class="thrust-test" aria-labelledby="thrust-heading">
          <div class="thrust-heading"><span id="thrust-heading">추진 테스트</span><span id="thrust-status" role="status" aria-live="polite">대기</span></div>
          <div class="thrust-controls" role="group" aria-label="추진 상태">
            <button type="button" data-thrust="idle" aria-pressed="true" aria-keyshortcuts="1"><kbd>1</kbd>대기</button>
            <button type="button" data-thrust="accelerate" aria-pressed="false" aria-keyshortcuts="2"><kbd>2</kbd>가속</button>
            <button type="button" data-thrust="boost" aria-pressed="false" aria-keyshortcuts="3"><kbd>3</kbd>부스트</button>
          </div>
          <p class="thrust-hint">1 · 2 · 3 키 또는 버튼으로 전환</p>
        </div>
        <button type="button" id="start-driving" class="primary-action hangar-start">타임어택 <span aria-hidden="true">↗</span></button>
      </section>

      <section class="viewport" aria-label="드론 3D 미리보기">
        <div class="scene" id="scene"></div>
        <div class="scene-label"><span class="mono">DR–01</span><span>EXTERIOR VIEW</span></div>
        <div class="scene-status" role="status" aria-live="polite">기체를 준비하고 있습니다…</div>
        <div class="scene-error" role="alert" hidden>
          <h2>3D 화면을 표시할 수 없습니다.</h2>
          <p>브라우저의 하드웨어 가속과 WebGL 지원을 확인한 후 다시 시도해주세요.</p>
          <button type="button" id="retry">다시 불러오기</button>
        </div>
        <p class="orbit-hint"><span class="hint-cross" aria-hidden="true">＋</span>드래그하여 회전 <span class="hint-divider">/</span> 스크롤하여 확대</p>
      </section>

      <footer class="toolbar">
        <div class="toolbar-label"><span class="mono">01</span><span>기체 살펴보기</span></div>
        <div class="view-controls" role="group" aria-label="기체 보기 방향">
          <button type="button" data-view="front">전면</button>
          <button type="button" data-view="rear">후면</button>
          <button type="button" data-view="reset" aria-label="기본 시점으로 초기화">시점 초기화 <span aria-hidden="true">↗</span></button>
        </div>
        <div class="effect-controls">
          <button class="toggle" type="button" id="rotate-toggle" aria-pressed="true">자동 회전<span class="toggle-track" aria-hidden="true"></span></button>
          <button class="toggle" type="button" id="bloom-toggle" aria-pressed="true">Bloom<span class="toggle-track" aria-hidden="true"></span></button>
        </div>
      </footer>
    </main>`;

  const scene = root.querySelector<HTMLDivElement>('#scene')!;
  const status = root.querySelector<HTMLDivElement>('.scene-status')!;
  const error = root.querySelector<HTMLDivElement>('.scene-error')!;
  const bloomButton = root.querySelector<HTMLButtonElement>('#bloom-toggle')!;
  const rotateButton = root.querySelector<HTMLButtonElement>('#rotate-toggle')!;
  const thrustButtons = root.querySelectorAll<HTMLButtonElement>('[data-thrust]');
  const thrustStatus = root.querySelector<HTMLSpanElement>('#thrust-status')!;
  const eventController = new AbortController();
  const listen = { signal: eventController.signal };
  let hangar: Hangar | undefined;
  let ready = false;

  const showError = () => {
    ready = false;
    error.hidden = false;
    status.classList.remove('is-ready');
    status.textContent = '화면 연결을 확인해주세요';
    root.querySelectorAll<HTMLButtonElement>('.toolbar button, [data-thrust], #craft-select, #start-driving').forEach((button) => { button.disabled = true; });
    thrustStatus.textContent = '연결 끊김';
  };

  root.querySelector<HTMLButtonElement>('#start-driving')!.addEventListener('click', onDrive, listen);
  root.querySelector<HTMLButtonElement>('#retry')!.addEventListener('click', () => location.reload(), listen);
  try {
    hangar = createHangar(scene, showError, selected.configuration);
    const displayCraft = () => {
      root.querySelector('#craft-name')!.textContent = selected.name;
      root.querySelector('#craft-role')!.textContent = selected.role;
      root.querySelector('#craft-description')!.textContent = selected.description;
      root.querySelector('.scene-label .mono')!.textContent = selected.name.toUpperCase();
      root.querySelector<HTMLElement>('.introduction')!.style.setProperty('--craft-color', selected.lineColor);
      root.querySelector('#craft-stats')!.innerHTML = droneStats(selected.configuration).map((stat) => `<div><dt>${stat.label}</dt><dd><strong>${stat.value}</strong> <small>${stat.unit}</small></dd><span class="stat-line" aria-hidden="true"><i style="width:${Math.min(1, stat.fill) * 100}%"></i></span><p>${stat.hint}</p></div>`).join('');
    };
    displayCraft();
    root.querySelector<HTMLSelectElement>('#craft-select')!.addEventListener('change', (event) => {
      if (!ready) return;
      selected = DRONE_CATALOG.find((entry) => entry.configuration.id === (event.target as HTMLSelectElement).value)!;
      hangar!.setDrone(selected.configuration); displayCraft(); onSelect(selected);
    }, listen);
    ready = true;
    status.textContent = '기체 연결됨';
    status.classList.add('is-ready');
    const setThrustMode = (mode: ThrustMode) => {
      if (!ready) return;
      hangar!.setThrustMode(mode);
      thrustStatus.textContent = { idle: '대기', accelerate: '가속', boost: '부스트', 'boost-stage2': '부스트 2단계' }[mode];
      thrustButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.thrust === mode)));
    };
    thrustButtons.forEach((button) => {
      button.addEventListener('click', () => setThrustMode(button.dataset.thrust as ThrustMode), listen);
    });
    window.addEventListener('keydown', (event) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
      const mode = ({ '1': 'idle', '2': 'accelerate', '3': 'boost' } as const)[event.key as '1' | '2' | '3'];
      if (!mode || !ready) return;
      event.preventDefault();
      setThrustMode(mode);
    }, listen);
    bloomButton.addEventListener('click', () => {
      const enabled = bloomButton.getAttribute('aria-pressed') !== 'true';
      hangar!.setBloom(enabled);
      bloomButton.setAttribute('aria-pressed', String(enabled));
    }, listen);
    rotateButton.addEventListener('click', () => {
      const enabled = rotateButton.getAttribute('aria-pressed') !== 'true';
      hangar!.setAutoRotate(enabled);
      rotateButton.setAttribute('aria-pressed', String(enabled));
    }, listen);
    root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => {
      button.addEventListener('click', () => {
        hangar!.setView(button.dataset.view as 'front' | 'rear' | 'reset');
      }, listen);
    });
  } catch (cause) {
    console.error('격납고 초기화 실패:', cause);
    showError();
  }

  return () => {
    eventController.abort();
    hangar?.dispose();
    root.replaceChildren();
  };
}

export function mountApp(root: HTMLDivElement): () => void {
  let selected = DRONE_CATALOG[0];
  let disposeScreen = () => {};
  const render = () => {
    disposeScreen();
    disposeScreen = location.hash === '#drive'
      ? mountRace(root, () => { location.hash = ''; }, selected.configuration)
      : mountHangar(root, selected, (entry) => { selected = entry; }, () => { location.hash = 'drive'; });
  };
  window.addEventListener('hashchange', render);
  render();
  return () => {
    window.removeEventListener('hashchange', render);
    disposeScreen();
    root.replaceChildren();
  };
}
