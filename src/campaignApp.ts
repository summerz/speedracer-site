import { menuHeader } from './menuHeader';
import { TRACK_CATALOG, DISTRICTS, campaignLapLimit } from './game/track/trackCatalog';
import { createCatalogTrack, trackMetrics } from './game/track/trackRuntime';
import { campaignStatus, nextCampaignTrack } from './game/progression/campaign';
import type { ProgressStore } from './game/progression/progressStore';
import type { RaceMode } from './game/driving/createRaceSession';
import { createTrackPreview } from './game/track/createTrackPreview';
import { describeTrackLandmarks } from './game/track/createTrackLandmark';
import './campaign.css';

export function mountCampaign(root: HTMLDivElement, store: ProgressStore) {
  document.title = 'Speedracer · 캠페인';
  const initial = store.snapshot().campaign;
  let mode: RaceMode = initial.last.mode;
  let selected = TRACK_CATALOG.find(t => t.id === initial.last.trackId && campaignStatus(initial, mode, t) !== 'locked') ?? nextCampaignTrack(initial, mode);
  root.innerHTML = `<main class="campaign-screen">${menuHeader('campaign', store.snapshot().balance)}
    <section class="campaign-heading"><div><p class="eyebrow">CITY CIRCUITS</p><h1>CAMPAIGN<span>.</span></h1></div><p id="campaign-count" class="mono"></p></section>
    <div class="campaign-layout"><section class="campaign-courses" aria-label="트랙 선택">
      <div class="campaign-modes" role="group" aria-label="캠페인 방식"><button type="button" data-mode="time-attack">타임어택</button><button type="button" data-mode="competition">AI 레이스</button></div>
      <p id="campaign-rule" class="campaign-rule"></p><div id="campaign-list" class="campaign-list"></div>
    </section><section class="campaign-detail" aria-label="선택한 트랙"><div class="campaign-preview" id="campaign-preview" aria-label="트랙 3D 경로 미리보기"><p class="campaign-preview-legend">루프 · 코일 · 노면 회전 구간</p></div>
      <div class="campaign-detail-copy"><p class="eyebrow" id="course-district"></p><h2 id="course-name"></h2><p id="course-features"></p><p id="course-landmark"></p><dl id="course-metrics"></dl><p id="course-record"></p><p id="course-access" role="status"></p><button id="course-start" class="primary-action" type="button">도전하기 ↗</button><p id="campaign-warning" class="progress-warning" role="status"></p></div>
    </section></div></main>`;
  const get = (id: string) => root.querySelector<HTMLElement>(`#${id}`)!;
  const events = new AbortController(); const listen = { signal: events.signal };
  let preview: ReturnType<typeof createTrackPreview> | undefined;
  try { preview = createTrackPreview(get('campaign-preview')); } catch { get('campaign-preview').textContent = '3D 미리보기를 표시할 수 없습니다.'; }
  let disposed = false;
  const paint = () => {
    const focusedTrack = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.track : undefined;
    const profile = store.snapshot(), campaign = profile.campaign;
    get('campaign-balance').textContent = `${profile.balance.toLocaleString()} P`;
    const count = TRACK_CATALOG.filter(t => campaignStatus(campaign, mode, t) === 'cleared').length;
    get('campaign-count').textContent = `${count} / ${TRACK_CATALOG.length} CLEARED`;
    get('campaign-rule').textContent = mode === 'time-attack' ? '매 랩 제한시간 안에 완주하면 다음 코스가 열립니다.' : '1위로 완주하면 다음 코스가 열립니다. 통과한 코스는 다시 도전할 수 있습니다.';
    for (const button of root.querySelectorAll<HTMLElement>('[data-mode]')) button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    get('campaign-list').innerHTML = Object.entries(DISTRICTS).map(([id, district]) => `<section class="course-district"><h3>${district.name}</h3><div>${TRACK_CATALOG.filter(t => t.district === id).map(t => {
      const status = campaignStatus(campaign, mode, t);
      return `<button type="button" class="course-card" data-track="${t.id}" aria-pressed="${t.id === selected.id}" style="--district-color:${district.color}"><span class="course-number mono">${String(t.order).padStart(2, '0')}</span><span><strong>${t.name}</strong><small>난이도 ${t.rating}/6 · ${t.altitudeLevels}단 고도</small></span><span class="course-status">${!campaign.knownTracks.includes(t.id) ? 'NEW · ' : ''}${status === 'cleared' ? '✓ 통과' : status === 'locked' ? '잠김' : '도전'}</span></button>`;
    }).join('')}</div></section>`).join('');
    const track = createCatalogTrack(selected), metrics = trackMetrics(track), limit = campaignLapLimit(selected);
    preview?.setTrack(track, DISTRICTS[selected.district].color, selected);
    get('course-landmark').textContent = `랜드마크 · ${describeTrackLandmarks(track, selected).map(landmark => landmark.name).join(' / ')}`;
    get('course-district').textContent = `${DISTRICTS[selected.district].name} · ${String(selected.order).padStart(2, '0')}`;
    get('course-name').textContent = selected.name; get('course-features').textContent = selected.features;
    get('course-metrics').innerHTML = `<div><dt>난이도</dt><dd>${selected.rating}/6</dd></div><div><dt>랩 거리</dt><dd>${(metrics.length / 1000).toFixed(1)} km</dd></div><div><dt>고저차</dt><dd>${Math.round(metrics.heightRange)} m</dd></div><div><dt>고도 / 장애물</dt><dd>${selected.altitudeLevels}단 / ${metrics.obstacles}개</dd></div><div><dt>경기</dt><dd>${selected.laps}랩</dd></div><div><dt>${mode === 'time-attack' ? '매 랩 제한' : '통과 조건'}</dt><dd>${mode === 'time-attack' ? `${Math.floor(limit / 60)}분 ${limit % 60}초` : '1위'}</dd></div>`;
    const entry = campaign.modes[mode][selected.id];
    const normal = entry?.records[`${selected.revision}:normal`], assisted = entry?.records[`${selected.revision}:assisted`];
    get('course-record').textContent = normal ? `최고 기록 ${normal.total.toFixed(3)}초${mode === 'competition' ? ` · ${normal.rank}위` : ''}` : assisted ? `보조 최고 기록 ${assisted.total.toFixed(3)}초` : '아직 완주 기록이 없습니다.';
    const status = campaignStatus(campaign, mode, selected);
    get('course-access').textContent = status === 'locked' ? `${TRACK_CATALOG.find(t => t.id === selected.predecessor)?.name}을 이 방식으로 통과하면 열립니다.` : status === 'cleared' ? '통과한 코스 · 다시 플레이할 수 있습니다.' : '도전 가능한 코스';
    (get('course-start') as HTMLButtonElement).disabled = status === 'locked'; get('course-start').textContent = status === 'cleared' ? '다시 도전 ↗' : '도전하기 ↗';
    get('campaign-warning').textContent = store.issue;
    if (focusedTrack) root.querySelector<HTMLElement>(`[data-track="${focusedTrack}"]`)?.focus({ preventScroll:true });
  };
  const unsubscribe = store.subscribe(() => { if (!disposed) paint(); }); paint();
  get('campaign-list').addEventListener('click', event => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-track]');
    if (!target) return; selected = TRACK_CATALOG.find(t => t.id === target.dataset.track)!; paint();
    if (matchMedia('(max-width: 760px)').matches) get('course-name').scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, listen);
  for (const button of root.querySelectorAll<HTMLElement>('[data-mode]')) button.addEventListener('click', () => {
    mode = button.dataset.mode as RaceMode;
    if (campaignStatus(store.snapshot().campaign, mode, selected) === 'locked') selected = nextCampaignTrack(store.snapshot().campaign, mode);
    paint();
  }, listen);
  get('course-start').addEventListener('click', async () => {
    const chosenMode = mode, chosenTrack = selected.id;
    try { await store.command({ kind: 'campaign-select', mode: chosenMode, trackId: chosenTrack }); if (!disposed) location.hash = `drive?track=${chosenTrack}&mode=${chosenMode}`; }
    catch { if (!disposed) get('campaign-warning').textContent = store.issue; }
  }, listen);
  get('shop-back').addEventListener('click', () => { location.hash = ''; }, listen);
  get('open-shop').addEventListener('click', () => { location.hash = 'shop'; }, listen);
  return () => { disposed = true; events.abort(); unsubscribe(); preview?.dispose(); };
}
