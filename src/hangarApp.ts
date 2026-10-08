import { DRONE_CATALOG, droneStats } from './game/drone/droneCatalog';
import type { DroneCatalogEntry } from './game/drone/droneCatalog';
import { createHangar } from './game/createHangar';
import type { Hangar } from './game/createHangar';
import type { ThrustMode } from './game/drone/createThrusterEffect';
import type { ProgressStore } from './game/progression/progressStore';
import { upgradedConfiguration } from './game/progression/catalog';
import { menuHeader } from './menuHeader';

export function mountHangar(root: HTMLDivElement, selected: DroneCatalogEntry, onSelect: (entry: DroneCatalogEntry) => void, onDrive: () => void, store: ProgressStore): () => void {
  document.title = 'Speedracer · 격납고';
  root.innerHTML = `
    <main class="hangar">
      ${menuHeader('hangar', store.snapshot().balance)}

      <section class="introduction" aria-labelledby="drone-title">
        <h1 id="drone-title">RACING <span>DRONE.</span></h1>
        <div class="craft-picker" role="group" aria-label="보유 기체 선택">${DRONE_CATALOG.filter(entry => store.snapshot().owned.includes(entry.configuration.id)).map((entry) => `<button class="craft-choice" type="button" data-hangar-craft="${entry.configuration.id}" aria-pressed="${entry.configuration.id === selected.configuration.id}" style="--choice-color:${entry.lineColor}"><span class="craft-choice-name">${entry.name}</span><span class="craft-choice-role">${entry.role}</span><span class="craft-choice-status">${entry.configuration.id === selected.configuration.id ? '선택 중' : '선택'}</span></button>`).join('')}</div>
        <p id="craft-description" class="craft-description"></p>
        <dl id="craft-stats" class="craft-stats"></dl>
        <p class="progress-warning" id="hangar-progress-warning" role="status"></p>
        <div class="thrust-test" aria-labelledby="thrust-heading">
          <div class="thrust-heading"><span id="thrust-heading">추진 테스트</span><span id="thrust-status" role="status" aria-live="polite">대기</span></div>
          <div class="thrust-controls" role="group" aria-label="추진 상태">
            <button type="button" data-thrust="idle" aria-pressed="true" aria-keyshortcuts="1"><kbd>1</kbd>대기</button>
            <button type="button" data-thrust="accelerate" aria-pressed="false" aria-keyshortcuts="2"><kbd>2</kbd>가속</button>
            <button type="button" data-thrust="boost" aria-pressed="false" aria-keyshortcuts="3"><kbd>3</kbd>부스트</button>
          </div>
        </div>
        <button type="button" id="start-driving" class="primary-action hangar-start">캠페인 시작 <span aria-hidden="true">↗</span></button><a class="free-drive-link" href="#drive">자유 주행 · 타임어택 / 경쟁 레이스</a>
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
        <p class="orbit-hint"><span class="hint-cross" aria-hidden="true">＋</span>드래그하여 회전</p>
      </section>

    </main>`;

  const scene = root.querySelector<HTMLDivElement>('#scene')!;
  const status = root.querySelector<HTMLDivElement>('.scene-status')!;
  const error = root.querySelector<HTMLDivElement>('.scene-error')!;
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
    root.querySelectorAll<HTMLButtonElement>('[data-thrust], [data-hangar-craft], #start-driving').forEach((button) => { button.disabled = true; });
    thrustStatus.textContent = '연결 끊김';
  };

  root.querySelector<HTMLButtonElement>('#open-shop')!.addEventListener('click', () => { location.hash = 'shop'; }, listen);
  root.querySelector('#hangar-balance')!.textContent = `${store.snapshot().balance.toLocaleString()} P`;
  root.querySelector('#hangar-progress-warning')!.textContent = store.issue;
  root.querySelector<HTMLButtonElement>('#start-driving')!.addEventListener('click', onDrive, listen);
  root.querySelector<HTMLButtonElement>('#retry')!.addEventListener('click', () => location.reload(), listen);
  try {
    hangar = createHangar(scene, showError, selected.configuration);
    const displayCraft = () => {
      root.querySelectorAll<HTMLButtonElement>('[data-hangar-craft]').forEach(button => {
        const active = button.dataset.hangarCraft === selected.configuration.id;
        button.setAttribute('aria-pressed', String(active));
        button.querySelector('.craft-choice-status')!.textContent = active ? '선택 중' : '선택';
      });
      root.querySelector('#craft-description')!.textContent = selected.description;
      root.querySelector('.scene-label .mono')!.textContent = selected.name.toUpperCase();
      root.querySelector<HTMLElement>('.introduction')!.style.setProperty('--craft-color', selected.lineColor);
      root.querySelector('#craft-stats')!.innerHTML = droneStats(selected.configuration).map((stat) => `<div><dt>${stat.label}</dt><dd><strong>${stat.value}</strong> <small>${stat.unit}</small></dd><span class="stat-line" aria-hidden="true"><i style="width:${Math.min(1, stat.fill) * 100}%"></i></span><p>${stat.hint}</p></div>`).join('');
    };
    displayCraft();
    let selecting = false;
    root.querySelectorAll<HTMLButtonElement>('[data-hangar-craft]').forEach(picker => picker.addEventListener('click', async () => {
      if (!ready || selecting || picker.dataset.hangarCraft === selected.configuration.id) return;
      selecting = true;
      const controls = root.querySelectorAll<HTMLButtonElement>('[data-hangar-craft], #start-driving');
      controls.forEach(button => { button.disabled = true; });
      try {
        const profile = await store.command({ kind: 'equip', id: picker.dataset.hangarCraft! });
        const entry = DRONE_CATALOG.find(craft => craft.configuration.id === profile.equipped)!;
        selected = { ...entry, configuration: upgradedConfiguration(profile.equipped, profile.upgrades[profile.equipped]) };
        if (!eventController.signal.aborted) { hangar!.setDrone(selected.configuration); displayCraft(); onSelect(selected); }
      } catch (error) { if (!eventController.signal.aborted) root.querySelector('#hangar-progress-warning')!.textContent = String(error instanceof Error ? error.message : error); }
      finally { selecting = false; if (!eventController.signal.aborted && ready) controls.forEach(button => { button.disabled = false; }); }
    }, listen));
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
