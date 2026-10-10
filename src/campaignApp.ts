import { RACE_CHALLENGES, challengeLapLimit, raceChallenge, type RaceChallengeId } from './game/track/raceChallenge';
import { RACE_PARTICIPANT_COUNT } from './game/driving/aiRoster';
import { focusPrimary, usingKeys } from './platform/menuNavigation';
import { menuHeader } from './menuHeader';
import { DRONE_CATALOG } from './game/drone/droneCatalog';
import { TRACK_CATALOG, DISTRICTS, campaignRankLimit, type DistrictId, type TrackDefinition } from './game/track/trackCatalog';
import { createCatalogTrack, trackMetrics } from './game/track/trackRuntime';
import { campaignStatus, nextCampaignTrack, campaignClearRecord, campaignDifficultyProgress, campaignStars, type CampaignProgress } from './game/progression/campaign';
import type { ProgressStore } from './game/progression/progressStore';
import type { RaceMode } from './game/driving/createRaceSession';
import { MARINE_ZONES } from './game/environment/marineZones';
import { createTrackPreview } from './game/track/createTrackPreview';
import { describeTrackLandmarks } from './game/track/createTrackLandmark';
import { loadoutMarkup, mountLoadout } from './campaignLoadout';
import './campaign.css';

type View = 'districts' | 'tracks' | 'detail';
interface CardInfo { url: string; stats: string; landmark: string }
const cardCache = new Map<string, CardInfo>();
interface Snapshot { view: View; district: DistrictId; trackId: string }
const CHALLENGE_IDS = ['normal', 'easy', 'hard'] as const;
const DEPTH: Record<View, number> = { districts: 0, tracks: 1, detail: 2 };
const number2 = (n: number) => String(n).padStart(2, '0');
// ponytail: local stand-in, replaced by Codex's city contract (CityId / CITY_CATALOG / cityForDistrict, docs/CITY_STRUCTURE.md on docs/city-contract @ 83c25b2).
const CITIES = [{ id: 'neon', label: 'NEON CITY', name: '네온시티' }, { id: 'marine', label: 'MARINE CITY', name: '마린시티' }] as const;
type CityKey = typeof CITIES[number]['id'];
const MARINE_DISTRICTS: readonly string[] = ['abyss', 'kelp', 'coral', 'lagoon'];
const cityOf = (district: string): CityKey => MARINE_DISTRICTS.includes(district) ? 'marine' : 'neon';
const MARINE_BLURB = ['해구 돔과 생물 발광', '흔들리는 거대 해초', '발광 산호 군락', '수면 빛과 물고기 떼'];

export function mountCampaign(root: HTMLDivElement, store: ProgressStore, context?: { mode: RaceMode; trackId?: string; challenge?: RaceChallengeId }) {
  document.title = 'Speedracer · 캠페인';
  const initial = store.snapshot().campaign;
  let mode: RaceMode = context?.mode ?? initial.last.mode;
  let challenge = raceChallenge(context?.challenge ?? initial.last.challenge);
  const pips = (n: number) => `<span class="pips" role="img" aria-label="코스 강도 ${n}/6">${[1,2,3,4,5,6].map(i => `<i data-on="${i <= n}"></i>`).join('')}</span>`;
  const starsMarkup = (count: number) => `<span class="course-stars" aria-label="별 ${count}개 / 3개">${[1,2,3].map(n => `<span aria-hidden="true" data-earned="${n <= count}">★</span>`).join('')}</span>`;
  const bestStars = (campaign: CampaignProgress, track: TrackDefinition) => Math.max(...CHALLENGE_IDS.map(id => campaignStars(campaign, mode, track, id)));
  const time = (seconds: number) => {
    const ms = Math.round(seconds * 1000);
    return `${Math.floor(ms / 60000)}:${(Math.floor(ms / 1000) % 60).toString().padStart(2, '0')}.${(ms % 1000).toString().padStart(3, '0')}`;
  };
  const trackById = (id: string) => TRACK_CATALOG.find(t => t.id === id);

  let view: View = 'districts';
  let selected: TrackDefinition = nextCampaignTrack(initial, mode);
  let district: DistrictId = selected.district;
  let depth = 0;
  const levels: Snapshot[] = [];
  const returning = context?.trackId ? trackById(context.trackId) : undefined;
  if (returning) {
    selected = campaignStatus(initial, mode, returning) === 'locked' ? nextCampaignTrack(initial, mode) : returning;
    district = selected.district; view = 'detail';
  }

  root.innerHTML = `<main class="campaign-screen" data-view="${view}">${menuHeader('campaign', store.snapshot().balance)}
    <nav class="campaign-bar" aria-label="캠페인 탐색">
      <button id="campaign-back" class="campaign-back" type="button" aria-label="이전 단계로" hidden>←</button>
      <ol id="campaign-crumbs" class="campaign-crumbs"></ol>
      <div class="campaign-modes" role="group" aria-label="캠페인 방식"><button type="button" data-mode="time-attack" aria-keyshortcuts="T"><span>타임어택</span><span class="campaign-mode-count mono"></span><kbd class="key-badge">T</kbd></button><button type="button" data-mode="competition" aria-keyshortcuts="R"><span>경쟁 레이스</span><span class="campaign-mode-count mono"></span><kbd class="key-badge">R</kbd></button></div>
      <a id="campaign-craft" class="campaign-craft" href="#" aria-label="격납고에서 출전 기체 변경"><img id="campaign-craft-image" width="480" height="240" alt=""><span class="campaign-craft-copy"><span class="campaign-craft-caption">출전 기체</span><strong id="campaign-craft-name"></strong><span id="campaign-craft-role"></span></span></a>
    </nav>
    <div class="campaign-body">
      <section id="view-districts" class="campaign-view view-districts" aria-label="구역 선택"><div id="districts-summary" class="districts-summary"></div><div id="district-list" class="district-list"></div></section>
      <section id="view-tracks" class="campaign-view view-tracks" aria-label="트랙 선택" hidden><header id="tracks-head" class="tracks-head"></header><div id="track-list" class="track-list"></div></section>
      <section id="view-detail" class="campaign-view view-detail" aria-label="선택한 트랙" hidden>
        <div class="detail-media"><div class="campaign-preview" id="campaign-preview" aria-label="트랙 3D 경로 미리보기"><p class="campaign-preview-legend">루프 · 코일 · 노면 회전 구간</p></div>
          <div class="campaign-title"><p class="eyebrow" id="course-district"></p><div class="campaign-title-row"><h2 id="course-name"></h2><div id="course-stars-summary" class="course-stars-summary"></div></div></div>
          <div class="campaign-difficulty"><span>난이도 <kbd class="key-badge">D</kbd></span><div class="course-challenges" role="group" aria-label="출전 난이도" aria-keyshortcuts="D">${(['easy', 'normal', 'hard'] as const).map(id => `<button type="button" data-challenge="${id}"><span>${RACE_CHALLENGES[id].label}</span><span class="diff-stars"></span></button>`).join('')}</div></div></div>
        <div class="detail-info"><div class="detail-scroll"><div id="course-metrics" class="course-specs"></div><section id="course-condition" class="course-condition" aria-label="통과 조건과 통과 기록 비교"></section><section id="course-ladder" class="course-ladder" aria-label="별 등급 기준"></section><section id="course-routes" class="course-routes" aria-label="갈림길별 경험" hidden></section><div id="course-tags" class="course-tags"></div><section id="course-record" class="course-record" aria-label="최단 완주 기록"></section></div>
          <footer class="campaign-detail-actions">${loadoutMarkup()}<div class="action-main"><p id="course-access" role="status" tabindex="-1"></p><button id="course-start" class="primary-action" type="button" data-autofocus>도전하기 ↗</button></div><p id="campaign-warning" class="progress-warning" role="status"></p></footer></div>
      </section>
    </div></main>`;
  const get = (id: string) => root.querySelector<HTMLElement>(`#${id}`)!;
  const screen = root.querySelector<HTMLElement>('.campaign-screen')!;
  const events = new AbortController(); const listen = { signal: events.signal };
  let preview: ReturnType<typeof createTrackPreview> | undefined, previewKey = '', previewFailed = false;
  let disposed = false;
  const loadout = mountLoadout(root, store, () => mode, events.signal, message => { get('campaign-warning').textContent = message; });
  const portraitPhone = () => matchMedia('(max-width: 760px) and (orientation: portrait), (max-width: 639px)').matches;

  const snapshot = (): Snapshot => ({ view, district, trackId: selected.id });
  const ensurePreview = () => {
    if (!preview && !previewFailed) {
      try { preview = createTrackPreview(get('campaign-preview')); } catch { previewFailed = true; get('campaign-preview').textContent = '3D 미리보기를 표시할 수 없습니다.'; }
    }
  };
  const syncPreview = () => {
    if (view !== 'detail') return;
    ensurePreview();
    const key = `${selected.id}:${selected.revision}:${challenge}`;
    if (preview && key !== previewKey) { previewKey = key; preview.setTrack(createCatalogTrack(selected, challenge), DISTRICTS[selected.district].color, selected); }
  };

  const paintChrome = (campaign: CampaignProgress, profile: ReturnType<ProgressStore['snapshot']>) => {
    const craft = DRONE_CATALOG.find(entry => entry.configuration.id === profile.equipped) ?? DRONE_CATALOG[0];
    const craftLink = get('campaign-craft');
    craftLink.style.setProperty('--campaign-craft-color', craft.lineColor);
    craftLink.setAttribute('aria-label', `${craft.name} · ${craft.role} · 격납고에서 출전 기체 변경`);
    const craftImage = get('campaign-craft-image') as HTMLImageElement;
    const imagePath = `/craft-previews/${craft.configuration.modelVariant}.png`;
    if (craftImage.getAttribute('src') !== imagePath) craftImage.src = imagePath;
    get('campaign-craft-name').textContent = craft.name;
    get('campaign-craft-role').textContent = craft.role;
    get('campaign-balance').textContent = `${profile.balance.toLocaleString()} P`;
    for (const button of root.querySelectorAll<HTMLElement>('[data-mode]')) {
      const buttonMode = button.dataset.mode as RaceMode;
      const cleared = TRACK_CATALOG.filter(t => campaignStatus(campaign, buttonMode, t) === 'cleared').length;
      button.setAttribute('aria-pressed', String(buttonMode === mode));
      button.querySelector('.campaign-mode-count')!.textContent = `${cleared}/${TRACK_CATALOG.length}`;
    }
    screen.dataset.view = view;
    (get('campaign-back') as HTMLButtonElement).hidden = view === 'districts';
    const crumbs = [`<li>${view === 'districts' ? '<span aria-current="page">캠페인</span>' : '<button type="button" data-crumb="districts">캠페인</button>'}</li>`];
    if (view !== 'districts') crumbs.push(`<li style="--district-color:${DISTRICTS[district].color}">${view === 'tracks' ? `<span aria-current="page">${DISTRICTS[district].name}</span>` : `<button type="button" data-crumb="tracks">${DISTRICTS[district].name}</button>`}</li>`);
    if (view === 'detail') crumbs.push(`<li><span aria-current="page">${number2(selected.order)} ${selected.name}</span></li>`);
    get('campaign-crumbs').innerHTML = crumbs.join('');
  };

  const districtTracks = (id: string) => TRACK_CATALOG.filter(t => t.district === id);
  const paintDistricts = (campaign: CampaignProgress) => {
    const cleared = TRACK_CATALOG.filter(t => campaignStatus(campaign, mode, t) === 'cleared').length;
    const starTotal = TRACK_CATALOG.reduce((sum, t) => sum + bestStars(campaign, t), 0), starMax = TRACK_CATALOG.length * 3;
    const firstRun = TRACK_CATALOG.every(t => (['time-attack', 'competition'] as const).every(m => campaignStatus(campaign, m, t) !== 'cleared'));
    const finished = cleared === TRACK_CATALOG.length;
    const next = nextCampaignTrack(campaign, mode);
    const nextDistrict = finished ? undefined : next.district;
    const banner = finished
      ? `<div class="continue-banner" data-done="true"><span class="eyebrow">COMPLETE</span><strong>모든 코스 통과 · <span class="stat-stars">★ ${starTotal}/${starMax}</span></strong></div>`
      : `<div class="continue-banner" style="--district-color:${DISTRICTS[next.district].color}"><span class="continue-copy"><span class="eyebrow">${firstRun ? '첫 코스' : '이어하기'}</span><strong><em>${DISTRICTS[next.district].name}</em> · <span class="mono">${number2(next.order)}</span> ${next.name}</strong></span><button id="campaign-continue" type="button" class="continue-button" data-autofocus>${firstRun ? '첫 도전' : '이어서 도전'} ↗</button></div>`;
    get('districts-summary').innerHTML = `${banner}<div class="overall"><p class="mono"><span>통과 <b>${cleared}</b>/${TRACK_CATALOG.length}</span><span class="stat-stars">★ <b>${starTotal}</b>/${starMax}</span></p><span class="meter" aria-hidden="true"><i style="width:${starTotal / starMax * 100}%"></i></span></div>`;
    const districtCard = (id: DistrictId, entry: typeof DISTRICTS[DistrictId], index: number) => {
      const tracks = districtTracks(id);
      const statuses = tracks.map(t => campaignStatus(campaign, mode, t));
      const done = statuses.filter(s => s === 'cleared').length, stars = tracks.reduce((sum, t) => sum + bestStars(campaign, t), 0);
      const locked = statuses.every(s => s === 'locked'), complete = done === tracks.length;
      const state = complete ? 'cleared' : locked ? 'locked' : 'active';
      const label = complete ? '완주 ✓' : locked ? '잠김' : '진행 중';
      return `<button type="button" class="district-card" data-district="${id}" data-state="${state}" data-next="${id === nextDistrict}" style="--district-color:${entry.color}" aria-label="${entry.name} · ${label} · 통과 ${done}/${tracks.length} · 별 ${stars}/${tracks.length * 3}">
        <span class="district-top"><span class="district-index mono">${number2(index + 1)}</span>${id === nextDistrict ? '<span class="district-next">NEXT</span>' : ''}<span class="district-state">${label}</span></span>
        <strong class="district-name">${entry.name}</strong><span class="district-description">${entry.description}</span>
        <span class="district-foot">${locked ? '<span class="district-lock">🔒 이전 구역을 통과하면 열립니다</span>' : ''}<span class="district-dots" aria-hidden="true">${statuses.map(s => `<i data-status="${s}"></i>`).join('')}</span><span class="district-tracklist" aria-hidden="true">${tracks.map((t, i) => { const st = statuses[i], n = bestStars(campaign, t); return `<span class="dt-row" data-status="${st}" data-next="${!finished && t.id === next.id}"><span class="mono">${number2(t.order)}</span><span class="dt-name">${t.name}</span><span class="dt-mark">${st === 'locked' ? '잠김' : st === 'available' ? '도전' : `<span class="dt-stars">${'★'.repeat(n)}<s>${'★'.repeat(3 - n)}</s></span>`}</span></span>`; }).join('')}</span>
        <span class="district-stats mono"><span>통과 ${done}/${tracks.length}</span><span class="stat-stars">★ ${stars}/${tracks.length * 3}</span></span></span></button>`;
    };
    const entries = (Object.entries(DISTRICTS) as [DistrictId, typeof DISTRICTS[DistrictId]][]).filter(([id]) => TRACK_CATALOG.some(track => track.district === id));
    get('district-list').innerHTML = CITIES.map((city, cityIndex) => {
      const own = entries.filter(([id]) => cityOf(id) === city.id);
      const head = (inner: string) => `<header class="city-head"><div class="city-title"><p class="eyebrow">CITY ${number2(cityIndex + 1)}</p><h2>${city.label} <span class="city-ko">${city.name}</span></h2></div>${inner}</header>`;
      if (!own.length) {
        const tiles = MARINE_ZONES.map((zone, i) => { const env = zone.environments[0]; return `<div class="zone-preview" aria-disabled="true" style="--district-color:${zone.palette.glow}"><span class="district-top"><span class="district-index mono">${number2(i + 1)}</span><span class="district-state">준비 중</span></span><span class="zone-swatch" style="background:linear-gradient(180deg,${env.zenith},${env.horizon})"><i style="background:${zone.palette.glow}"></i><i style="background:${zone.palette.accent}"></i></span><strong class="district-name">${zone.name}</strong><span class="district-description">${MARINE_BLURB[i] ?? ''}</span></div>`; }).join('');
        return `<section class="city-group" data-city="${city.id}" data-state="locked" aria-label="${city.label} ${city.name} · 잠김">${head('<p class="city-lock">🔒 네온시티 32번 트랙을 통과하면 열립니다 · 준비 중</p>')}<div class="district-grid">${tiles}</div></section>`;
      }
      const tracks = own.flatMap(([id]) => districtTracks(id));
      const done = tracks.filter(t => campaignStatus(campaign, mode, t) === 'cleared').length, stars = tracks.reduce((sum, t) => sum + bestStars(campaign, t), 0);
      const progress = tracks.length === TRACK_CATALOG.length ? '' : `<div class="city-progress"><p class="mono"><span>통과 <b>${done}</b>/${tracks.length}</span><span class="stat-stars">★ <b>${stars}</b>/${tracks.length * 3}</span></p><span class="meter" aria-hidden="true"><i style="width:${stars / (tracks.length * 3) * 100}%"></i></span></div>`;
      return `<section class="city-group" data-city="${city.id}">${head(progress)}<div class="district-grid">${own.map(([id, entry], index) => districtCard(id, entry, index)).join('')}</div></section>`;
    }).join('');
    if (!finished) return;
    get('district-list').querySelector('[data-district]')?.setAttribute('data-autofocus', '');
  };

  const trackRecord = (campaign: CampaignProgress, t: TrackDefinition) => {
    let best: RaceChallengeId | undefined, top = -1;
    for (const id of CHALLENGE_IDS) { const stars = campaignStars(campaign, mode, t, id); if (campaignClearRecord(campaign, mode, t, id) && stars > top) { best = id; top = stars; } }
    const clear = best && campaignClearRecord(campaign, mode, t, best);
    return clear && best ? `${RACE_CHALLENGES[best].label} · ${mode === 'competition' ? `${clear.rank}위` : `${clear.laps.length}랩`} · ${time(clear.total)}${clear.assisted ? ' · 보조' : ''}` : '';
  };
  let mapToken = 0, mapTimer: ReturnType<typeof setTimeout> | undefined;
  const paintTracks = (campaign: CampaignProgress) => {
    const entry = DISTRICTS[district], tracks = districtTracks(district);
    const done = tracks.filter(t => campaignStatus(campaign, mode, t) === 'cleared').length, stars = tracks.reduce((sum, t) => sum + bestStars(campaign, t), 0);
    const head = get('tracks-head');
    head.style.setProperty('--district-color', entry.color);
    head.innerHTML = `<div class="tracks-title"><p class="eyebrow">DISTRICT ${number2(Object.keys(DISTRICTS).indexOf(district) + 1)}</p><h2>${entry.name}</h2><p class="tracks-description">${entry.description}</p></div><div class="tracks-progress"><p class="mono"><span>통과 <b>${done}</b>/${tracks.length}</span><span class="stat-stars">★ <b>${stars}</b>/${tracks.length * 3}</span></p><span class="meter" aria-hidden="true"><i style="width:${stars / (tracks.length * 3) * 100}%"></i></span></div>`;
    const list = get('track-list');
    list.style.setProperty('--district-color', entry.color);
    list.innerHTML = tracks.map(t => {
      const status = campaignStatus(campaign, mode, t);
      const fresh = !campaign.knownTracks.includes(t.id) ? '<em class="course-new">NEW</em>' : '';
      const fork = t.branches?.length ? '<em class="course-fork">갈림길</em>' : '';
      const chip = status === 'locked' ? '잠김' : status === 'cleared' ? '✓ 통과' : '도전';
      const record = status === 'cleared' ? trackRecord(campaign, t) : '';
      return `<button type="button" class="track-card" data-status="${status}" data-track="${t.id}"><span class="track-map-wrap" data-map="${t.id}">${status === 'locked' ? '<span class="track-lock" aria-hidden="true">🔒</span>' : ''}</span><span class="track-body"><span class="track-top"><span class="course-number mono">${number2(t.order)}</span><span class="track-chip">${chip}</span></span>
        <strong class="track-name">${t.name}${fresh}${fork}</strong>
        <span class="track-stats mono" data-stats="${t.id}"></span><span class="track-landmark" data-landmark="${t.id}"></span>
        ${status === 'locked' ? '<span class="track-locked">이전 코스 통과 필요</span>' : `<span class="course-meta">${pips(t.rating)}<span>${t.altitudeLevels}단 고도</span>${mode === 'competition' ? `<span>${campaignRankLimit(t)}위 이내</span>` : ''}</span><span class="track-foot">${mode === 'competition' ? `<span class="track-rank-l">${campaignRankLimit(t)}위 이내</span>` : ''}${starsMarkup(bestStars(campaign, t))}${record ? `<span class="course-card-record">${record}</span>` : ''}</span>`}</span></button>`;
    }).join('');
    // Thumbnails are snapshots of the detail preview's own scene; one track per idle tick.
    (list.querySelector(`[data-track="${nextCampaignTrack(campaign, mode).id}"]:not([data-status=locked])`) ?? list.querySelector('.track-card'))?.setAttribute('data-autofocus', '');
    const token = ++mapToken, km = (n: number) => (n / 1000).toFixed(1);
    const probe = list.querySelector<HTMLElement>('[data-map]');
    const w = Math.max(1, Math.round(probe?.clientWidth ?? 0)), h = Math.max(1, Math.round(probe?.clientHeight ?? 0));
    const fill = (t: TrackDefinition, info: CardInfo) => {
      const card = list.querySelector(`[data-track="${t.id}"]`); if (!card) return;
      if (info.url) card.querySelector('[data-map]')!.insertAdjacentHTML('afterbegin', `<img class="track-map" alt="" src="${info.url}">`);
      card.querySelector('[data-stats]')!.innerHTML = info.stats;
      card.querySelector('[data-landmark]')!.textContent = info.landmark;
    };
    const pending = tracks.filter(t => { const hit = cardCache.get(`${t.id}:${t.revision}:${w}x${h}`); if (hit) fill(t, hit); return !hit; });
    const step = () => {
      const t = pending.shift(); if (!t || token !== mapToken) return;
      const track = createCatalogTrack(t, 'normal'), m = trackMetrics(track);
      ensurePreview(); let url = '';
      try { url = preview?.snapshot(track, entry.color, t, w, h) ?? ''; previewKey = ''; } catch { /* WebGL unavailable: cards stay text-only */ }
      const info = { url, landmark: describeTrackLandmarks(track, t)[0]?.name ?? '',
        stats: `<span class="stats-full">${km(m.lengthMin)}${km(m.lengthMin) !== km(m.lengthMax) ? `–${km(m.lengthMax)}` : ''} km · 고저차 ${Math.round(m.heightRange)} m · 장애물 ${m.obstacles} · ${t.laps}랩</span><span class="stats-short">${km(m.lengthMin)}${km(m.lengthMin) !== km(m.lengthMax) ? `–${km(m.lengthMax)}` : ''}km · ${Math.round(m.heightRange)}m · 장애물 ${m.obstacles}</span>` };
      cardCache.set(`${t.id}:${t.revision}:${w}x${h}`, info); fill(t, info); schedule();
    };
    const schedule = () => { if (pending.length) mapTimer = setTimeout(step, 0); };
    clearTimeout(mapTimer); schedule();
  };

  const paintDetail = (campaign: CampaignProgress) => {
    const track = createCatalogTrack(selected, challenge), metrics = trackMetrics(track), limit = challengeLapLimit(selected, challenge);
    get('course-district').textContent = `${DISTRICTS[selected.district].name} · ${number2(selected.order)}`;
    get('course-name').textContent = selected.name;
    get('course-tags').innerHTML = [...selected.features.split(' · ').map(f => `<span>${f}</span>`), ...describeTrackLandmarks(track, selected).map(l => `<span data-kind="landmark">${l.name}</span>`)].join('');
    const routes = get('course-routes'); routes.hidden = !track.branches?.length;
    routes.innerHTML = (track.branches ?? []).map(f => `<p class="course-route-heading">${f.kind === 'horizontal' ? '좌우 분기 · 좌우 조향으로 선택' : '상하 분기 · 진입 전 고도로 선택'}</p><div>${f.routes.map((r, i) => `<article><strong>${f.kind === 'horizontal' ? (i ? '→' : '←') : (i ? '↑' : '↓')} ${r.name}</strong><span>${r.features.join(' · ')}</span><small>${Math.round(r.length)}m · ${r.description}</small></article>`).join('')}</div>`).join('');
    const km = (n: number) => (n / 1000).toFixed(1);
    const tile = (label: string, value: string) => `<div><span>${label}</span><strong>${value}</strong></div>`;
    get('course-metrics').innerHTML = tile('코스 강도', pips(selected.rating)) + tile('랩 거리', `${km(metrics.lengthMin)}${km(metrics.lengthMin) !== km(metrics.lengthMax) ? `–${km(metrics.lengthMax)}` : ''} km`) + tile('고저차', `${Math.round(metrics.heightRange)} m`) + tile('고도', `${selected.altitudeLevels}단`) + tile('장애물', `${metrics.obstacles}개`) + tile('랩 수', `${selected.laps}랩`);
    const entry = campaignDifficultyProgress(campaign, mode, selected, challenge);
    const normal = entry?.records[`${selected.revision}:normal`], assisted = entry?.records[`${selected.revision}:assisted`];
    const clear = campaignClearRecord(campaign, mode, selected, challenge);
    for (const button of root.querySelectorAll<HTMLElement>('[data-challenge]')) {
      const id = button.dataset.challenge as RaceChallengeId, earned = campaignStars(campaign, mode, selected, id);
      button.setAttribute('aria-pressed', String(id === challenge));
      button.querySelector('.diff-stars')!.innerHTML = [1, 2, 3].map(n => `<span data-earned="${n <= earned}">★</span>`).join('');
      button.setAttribute('aria-label', `${RACE_CHALLENGES[id].label} · 별 ${earned}개`);
    }
    const settings = RACE_CHALLENGES[challenge];
    const description = `${settings.label} · 장애물 ${metrics.obstacles}개 · ${challenge === 'easy' ? '이른 경고' : challenge === 'hard' ? '짧은 경고' : '기본 경고'}${mode === 'competition' ? ` · 상대 ${challenge === 'easy' ? '여유' : challenge === 'hard' ? '강화' : '표준'}` : ''}`;
    const stars = campaignStars(campaign, mode, selected, challenge);
    const cutoff = campaignRankLimit(selected);
    const tiers = mode === 'time-attack' ? ['통과', `매 랩 ${time(limit * .97)} 이내`, `매 랩 ${time(limit * .90)} 이내`] : cutoff === 2 ? ['2위', `2위 + 매 랩 ${time(limit * .97)} 이내`, '1위'] : [`${cutoff}위`, `${cutoff - 1}위 이내`, `${cutoff - 2}위 이내`];
    get('course-stars-summary').innerHTML = starsMarkup(stars);
    get('course-ladder').innerHTML = `<ol>${tiers.map((rule, i) => `<li data-earned="${stars > i}"><span class="course-stars" aria-label="별 ${i + 1}개">${'★'.repeat(i + 1)}</span><span>${rule}</span></li>`).join('')}</ol><p>충돌 2점 · 이탈 8점 감점 / 랩 평균 15점까지 등급 유지 · 감점 초과 시 별점 하락 · 통과하면 최소 1개</p>`;
    const comparisonRows = mode === 'time-attack' ? Array.from({ length: selected.laps }, (_, i) => {
      const lap = clear?.laps[i], margin = lap === undefined ? undefined : limit - lap;
      return `<tr><th scope="row">${i + 1}랩</th><td>≤ ${time(limit)}</td><td data-met="${margin === undefined ? 'unknown' : margin >= -1e-8 ? 'yes' : 'no'}">${lap === undefined ? '—' : `<strong>${time(lap)}</strong><small>${margin! >= -1e-8 ? `${Math.max(0, margin!).toFixed(3)}초 여유` : `${(-margin!).toFixed(3)}초 초과`}</small>`}</td></tr>`;
    }).join('') : `<tr><th scope="row">순위</th><td>${campaignRankLimit(selected)}위 이내 / ${RACE_PARTICIPANT_COUNT}명</td><td data-met="${clear ? clear.rank <= campaignRankLimit(selected) ? 'yes' : 'no' : 'unknown'}"><strong>${clear ? `${clear.rank}위` : '—'}</strong></td></tr><tr><th scope="row">완주</th><td>${selected.laps}랩</td><td data-met="${clear ? clear.laps.length === selected.laps ? 'yes' : 'no' : 'unknown'}"><strong>${clear ? `${clear.laps.length} / ${selected.laps}랩` : '—'}</strong></td></tr>`;
    get('course-condition').innerHTML = `<div class="course-objective-heading"><span class="eyebrow">${mode === 'time-attack' ? '타임어택' : '경쟁 레이스'} · ${description}</span>${entry?.cleared ? '<span class="course-passed">✓ 통과</span>' : ''}</div><strong>${mode === 'time-attack' ? `매 랩 ${Math.floor(limit / 60)}분 ${limit % 60}초 이내` : `${RACE_PARTICIPANT_COUNT}명 중 ${campaignRankLimit(selected)}위 이내`}</strong><table class="course-comparison"><thead><tr><th scope="col">구간</th><th scope="col">통과 조건</th><th scope="col">통과 기록</th></tr></thead><tbody>${comparisonRows}</tbody></table><span class="course-clear-summary">${clear ? `통과 경기 총 ${time(clear.total)}${clear.assisted ? ' · 보조 사용' : ''}${clear.collisions === undefined ? '' : ` · 충돌 ${clear.collisions}회 · 이탈 ${clear.offTrackExits ?? 0}회`}${clear.revision !== selected.revision ? '<small>이전 트랙 버전의 기록 · 현재 조건과 비교합니다.</small>' : ''}` : entry?.cleared ? '이전 버전 통과 완료 · 당시 기록은 저장되지 않았습니다.' : `${selected.laps}랩 ${mode === 'time-attack' ? '모두 제한시간을 지키면' : `경기에서 ${campaignRankLimit(selected)}위 이내에 들면`} 다음 코스가 열립니다.`}</span>`;
    const best = normal ?? assisted;
    get('course-record').innerHTML = best ? `<div class="course-best-record"><span>${best.assisted ? '보조 ' : ''}최단 완주</span><strong>${time(best.total)}${mode === 'competition' ? ` · ${best.rank}위` : ''}</strong></div>` : '<p>완주 기록이 없습니다.</p>';
    const status = campaignStatus(campaign, mode, selected);
    get('course-access').textContent = status === 'locked' ? `${trackById(selected.predecessor ?? '')?.name}을 이 방식으로 통과하면 열립니다.` : status === 'cleared' ? '통과한 코스 · 다시 플레이할 수 있습니다.' : '도전 가능한 코스';
    (get('course-start') as HTMLButtonElement).disabled = status === 'locked'; get('course-start').textContent = `${entry?.cleared ? '다시 도전' : '도전하기'} · ${RACE_CHALLENGES[challenge].label} ↗`;
    loadout.paint();
  };

  const focusKey = () => {
    const active = document.activeElement as HTMLElement | null;
    if (!active || !root.contains(active)) return '';
    if (active.dataset.district) return `[data-district="${active.dataset.district}"]`;
    if (active.dataset.track) return `[data-track="${active.dataset.track}"]`;
    if (active.dataset.crumb) return `[data-crumb="${active.dataset.crumb}"]`;
    return active.id === 'campaign-continue' || active.id === 'campaign-back' ? `#${active.id}` : '';
  };
  const paint = () => {
    const key = focusKey();
    const profile = store.snapshot(), campaign = profile.campaign;
    paintChrome(campaign, profile);
    for (const name of ['districts', 'tracks', 'detail'] as const) get(`view-${name}`).hidden = name !== view;
    if (view === 'districts') paintDistricts(campaign); else if (view === 'tracks') paintTracks(campaign); else { paintDetail(campaign); syncPreview(); }
    get('campaign-warning').textContent = store.issue;
    if (key) root.querySelector<HTMLElement>(key)?.focus({ preventScroll: true });
  };
  const focusEntry = () => {
    if (portraitPhone()) window.scrollTo({ top: 0, behavior: 'instant' });
    if (focusPrimary(root, true)) return;
    (view === 'tracks' ? root.querySelector<HTMLElement>('.track-card:not([data-status=locked])') ?? get('campaign-back') : view === 'detail' ? get('campaign-back') : undefined)?.focus({ preventScroll: true });
  };
  const setView = (next: Snapshot, focus = true) => {
    view = next.view; district = next.district; selected = trackById(next.trackId) ?? selected;
    paint(); if (focus) focusEntry();
  };
  const drill = (steps: Snapshot[]) => {
    for (const step of steps) {
      levels[depth] = snapshot(); depth++;
      history.pushState({ campaignDepth: depth, campaignSnapshot: step }, '', location.href);
    }
    setView(steps[steps.length - 1]);
  };
  const stepBack = () => {
    if (view === 'districts') return;
    setView({ view: view === 'detail' ? 'tracks' : 'districts', district, trackId: selected.id });
  };
  const goBack = (steps = 1) => {
    if (depth >= steps) history.go(-steps);
    else for (let i = 0; i < steps; i++) stepBack();
  };
  window.addEventListener('popstate', event => {
    if (disposed || !location.hash.startsWith('#campaign')) return;
    const target = Number((event.state as { campaignDepth?: number } | null)?.campaignDepth ?? 0);
    const snap = target > 0 ? (event.state as { campaignSnapshot: Snapshot }).campaignSnapshot : levels[0];
    if (target === depth || !snap) return;
    depth = target; setView(snap);
  }, listen);

  paint();
  const unsubscribe = store.subscribe(() => { if (!disposed) paint(); });
  root.querySelector('.campaign-bar')!.addEventListener('click', event => {
    const target = event.target as HTMLElement;
    if (target.closest('#campaign-back')) goBack();
    const crumb = target.closest<HTMLElement>('[data-crumb]');
    if (crumb) goBack(DEPTH[view] - DEPTH[crumb.dataset.crumb as View]);
  }, listen);
  get('district-list').addEventListener('click', event => {
    const card = (event.target as HTMLElement).closest<HTMLElement>('[data-district]');
    if (card) drill([{ view: 'tracks', district: card.dataset.district as DistrictId, trackId: selected.id }]);
  }, listen);
  get('districts-summary').addEventListener('click', event => {
    if (!(event.target as HTMLElement).closest('#campaign-continue')) return;
    const next = nextCampaignTrack(store.snapshot().campaign, mode);
    drill([{ view: 'tracks', district: next.district, trackId: next.id }, { view: 'detail', district: next.district, trackId: next.id }]);
  }, listen);
  get('track-list').addEventListener('click', event => {
    const card = (event.target as HTMLElement).closest<HTMLElement>('[data-track]');
    if (card) drill([{ view: 'detail', district, trackId: card.dataset.track! }]);
  }, listen);
  for (const button of root.querySelectorAll<HTMLElement>('[data-mode]')) button.addEventListener('click', () => {
    mode = button.dataset.mode as RaceMode;
    if (view === 'detail' && campaignStatus(store.snapshot().campaign, mode, selected) === 'locked') goBack(); else paint();
  }, listen);
  for (const button of root.querySelectorAll<HTMLElement>('[data-challenge]')) button.addEventListener('click', () => { challenge = raceChallenge(button.dataset.challenge); paint(); if (usingKeys() && !(get('course-start') as HTMLButtonElement).disabled) get('course-start').focus({ preventScroll: true }); }, listen);
  window.addEventListener('speedracer:menu-back', event => {
    if (view === 'districts') return;
    event.preventDefault(); goBack();
  }, listen);
  get('course-start').addEventListener('click', async () => {
    const chosenMode = mode, chosenTrack = selected.id, chosenChallenge = challenge;
    try { await store.command({ kind: 'campaign-select', mode: chosenMode, trackId: chosenTrack, challenge: chosenChallenge }); if (!disposed) location.hash = `drive?track=${chosenTrack}&mode=${chosenMode}&challenge=${chosenChallenge}`; }
    catch { if (!disposed) get('campaign-warning').textContent = store.issue; }
  }, listen);
  get('shop-back').addEventListener('click', () => { location.hash = ''; }, listen);
  get('open-shop').addEventListener('click', () => { location.hash = 'shop'; }, listen);
  const returnFrame = requestAnimationFrame(() => { if (returning) focusEntry(); else focusPrimary(root); });
  return () => { disposed = true; cancelAnimationFrame(returnFrame); events.abort(); unsubscribe(); preview?.dispose(); clearTimeout(mapTimer); mapToken++; };
}
