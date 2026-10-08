import { DRONE_CATALOG, droneStats } from './game/drone/droneCatalog';
import type { DroneCatalogEntry } from './game/drone/droneCatalog';
import { createHangar } from './game/createHangar';
import type { Hangar } from './game/createHangar';
import type { ThrustMode } from './game/drone/createThrusterEffect';
import type { ProgressStore } from './game/progression/progressStore';
import { upgradedConfiguration } from './game/progression/catalog';
import { menuHeader } from './menuHeader';
import { craftCards } from './craftCards';
import { TRACK_CATALOG, DISTRICTS, type TrackDefinition } from './game/track/trackCatalog';
import { campaignStatus, campaignStars, nextCampaignTrack, type CampaignProgress } from './game/progression/campaign';
import type { RaceMode } from './game/driving/createRaceSession';
import './hangar.css';

const CHALLENGE_IDS = ['normal', 'easy', 'hard'] as const;
const MODE_LABEL: Record<RaceMode, string> = { 'time-attack': '타임어택', competition: '경쟁 레이스' };

/** Resume card: the next track to attempt in the last-played mode, deep-linked into the campaign detail. */
function continueCard(campaign: CampaignProgress, mode: RaceMode): string {
  const next = nextCampaignTrack(campaign, mode);
  if (campaignStatus(campaign, mode, next) === 'cleared') return `<section class="home-continue" data-done="true" aria-label="이어하기"><div class="continue-copy"><p class="eyebrow">이어하기 · ${MODE_LABEL[mode]}</p><strong class="continue-track">모든 코스 통과</strong></div><a class="primary-action continue-action" id="continue-campaign" href="#campaign">캠페인 <span aria-hidden="true">↗</span></a></section>`;
  const stars = Math.max(...CHALLENGE_IDS.map(id => campaignStars(campaign, mode, next, id)));
  const district = DISTRICTS[next.district];
  return `<section class="home-continue" style="--district-color:${district.color}" aria-label="이어하기"><div class="continue-copy"><p class="eyebrow">이어하기 · ${MODE_LABEL[mode]}</p><p class="continue-district">${district.name}</p><strong class="continue-track"><span class="mono">${String(next.order).padStart(2, '0')}</span> ${next.name}</strong><span class="course-stars" aria-label="최고 별 ${stars}개 / 3개">${[1, 2, 3].map(n => `<span aria-hidden="true" data-earned="${n <= stars}">★</span>`).join('')}</span></div><a class="primary-action continue-action" id="continue-campaign" href="#campaign?track=${next.id}&mode=${mode}&challenge=${campaign.last.challenge ?? 'normal'}">이어서 도전 <span aria-hidden="true">↗</span></a></section>`;
}

export function mountHangar(root: HTMLDivElement, selected: DroneCatalogEntry, onSelect: (entry: DroneCatalogEntry) => void, onDrive: () => void, store: ProgressStore): () => void {
  document.title = 'Speedracer · 격납고';
  const profile = store.snapshot();
  const { campaign } = profile; const mode = campaign.last.mode;
  const ownedEntries = DRONE_CATALOG.filter(entry => profile.owned.includes(entry.configuration.id));
  const bestStars = (track: TrackDefinition) => Math.max(...CHALLENGE_IDS.map(id => campaignStars(campaign, mode, track, id)));
  const cleared = TRACK_CATALOG.filter(track => campaignStatus(campaign, mode, track) === 'cleared').length;
  const starTotal = TRACK_CATALOG.reduce((sum, track) => sum + bestStars(track), 0);
  root.innerHTML = `
    <main class="hangar">
      ${menuHeader('hangar', profile.balance)}

      <div class="hangar-body">
        <section class="viewport" aria-label="드론 3D 미리보기">
          <div class="scene" id="scene"></div>
          <h1 id="drone-title" class="hangar-title">RACING <span>DRONE</span></h1>
          <div class="scene-label"><span class="mono">DR–01</span><span>EXTERIOR VIEW</span></div>
          <div class="scene-status" role="status" aria-live="polite">기체를 준비하고 있습니다…</div>
          <div class="scene-error" role="alert" hidden>
            <h2>3D 화면을 표시할 수 없습니다.</h2>
            <p>브라우저의 하드웨어 가속과 WebGL 지원을 확인한 후 다시 시도해주세요.</p>
            <button type="button" id="retry">다시 불러오기</button>
          </div>
          <p class="orbit-hint"><span class="hint-cross" aria-hidden="true">＋</span>드래그하여 회전</p>
        </section>

        <section class="hangar-panel" aria-labelledby="drone-title">
          ${continueCard(campaign, mode)}
          <div class="home-actions"><button type="button" id="start-driving" class="home-secondary">캠페인 <span aria-hidden="true">↗</span></button><a class="home-secondary free-drive-link" href="#drive">자유 주행 <small>타임어택 / 경쟁 레이스</small></a></div>
          <p class="home-chips mono"><span>캠페인 통과 <b>${cleared}</b>/${TRACK_CATALOG.length}</span><span class="stat-stars">★ <b>${starTotal}</b>/${TRACK_CATALOG.length * 3}</span><span>보유 기체 <b>${ownedEntries.length}</b>/${DRONE_CATALOG.length}</span><a href="#shop">상점 ↗</a></p>
          <p class="progress-warning" id="hangar-progress-warning" role="status"></p>
          <section class="home-craft" aria-labelledby="home-craft-title">
            <h2 id="home-craft-title">내 기체</h2>
            <div id="hangar-cards"></div>
            <p id="craft-description" class="craft-description"></p>
            <div id="craft-stats" class="home-stats"></div>
          </section>
          <div class="thrust-test" role="group" aria-labelledby="thrust-heading">
            <div class="thrust-heading"><span id="thrust-heading">추진 테스트</span><span id="thrust-status" role="status" aria-live="polite">대기</span></div>
            <div class="thrust-controls" role="group" aria-label="추진 상태">
              <button type="button" data-thrust="idle" aria-pressed="true" aria-keyshortcuts="1"><kbd>1</kbd>대기</button>
              <button type="button" data-thrust="accelerate" aria-pressed="false" aria-keyshortcuts="2"><kbd>2</kbd>가속</button>
              <button type="button" data-thrust="boost" aria-pressed="false" aria-keyshortcuts="3"><kbd>3</kbd>부스트</button>
            </div>
          </div>
        </section>
      </div>

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
  root.querySelector('#hangar-balance')!.textContent = `${profile.balance.toLocaleString()} P`;
  root.querySelector('#hangar-progress-warning')!.textContent = store.issue;
  root.querySelector<HTMLButtonElement>('#start-driving')!.addEventListener('click', onDrive, listen);
  root.querySelector<HTMLButtonElement>('#retry')!.addEventListener('click', () => location.reload(), listen);
  const cards = root.querySelector<HTMLElement>('#hangar-cards')!;
  cards.innerHTML = craftCards({ entries: ownedEntries, selectedId: selected.configuration.id, attr: 'data-hangar-craft', label: '보유 기체 선택', status: () => ({ label: '장착', tone: 'owned' }) });
  try {
    hangar = createHangar(scene, showError, selected.configuration);
    const displayCraft = () => {
      cards.querySelectorAll<HTMLButtonElement>('[data-hangar-craft]').forEach(button => {
        const active = button.dataset.hangarCraft === selected.configuration.id;
        button.setAttribute('aria-pressed', String(active));
        button.dataset.tone = active ? 'equipped' : 'owned';
        button.querySelector('.craft-card-status')!.textContent = active ? '✓ 장착 중' : '장착';
      });
      root.querySelector('#craft-description')!.innerHTML = `<strong>${selected.name}</strong> · ${selected.role}<br>${selected.description}`;
      root.querySelector('.scene-label .mono')!.textContent = selected.name.toUpperCase();
      root.querySelector<HTMLElement>('.hangar-panel')!.style.setProperty('--craft-color', selected.lineColor);
      root.querySelector('#craft-stats')!.innerHTML = droneStats(selected.configuration).map(stat => `<div class="home-stat" title="${stat.hint}"><span class="stat-label">${stat.label}</span><span class="stat-track" aria-hidden="true"><i style="width:${Math.round(Math.max(0, Math.min(1, stat.fill)) * 100)}%"></i></span><span class="stat-value"><b>${stat.value}</b><small>${stat.unit}</small></span></div>`).join('');
    };
    displayCraft();
    let selecting = false;
    cards.addEventListener('click', async event => {
      const picker = (event.target as Element).closest<HTMLButtonElement>('[data-hangar-craft]');
      if (!picker || !ready || selecting || picker.dataset.hangarCraft === selected.configuration.id) return;
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
