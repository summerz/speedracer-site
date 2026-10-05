import { RACE_PARTICIPANT_COUNT } from './game/driving/aiRoster';
import { menuHeader } from './menuHeader';
import { TRACK_CATALOG, DISTRICTS, campaignLapLimit } from './game/track/trackCatalog';
import { createCatalogTrack, trackMetrics } from './game/track/trackRuntime';
import { campaignStatus, nextCampaignTrack, campaignClearRecord } from './game/progression/campaign';
import type { ProgressStore } from './game/progression/progressStore';
import type { RaceMode } from './game/driving/createRaceSession';
import { createTrackPreview } from './game/track/createTrackPreview';
import { describeTrackLandmarks } from './game/track/createTrackLandmark';
import './campaign.css';

export function mountCampaign(root: HTMLDivElement, store: ProgressStore, context?: { mode: RaceMode; trackId?: string }) {
  document.title = 'Speedracer · 캠페인';
  const initial = store.snapshot().campaign;
  let mode: RaceMode = context?.mode ?? initial.last.mode;
  let selected = TRACK_CATALOG.find(t => t.id === (context?.trackId ?? initial.last.trackId) && campaignStatus(initial, mode, t) !== 'locked') ?? nextCampaignTrack(initial, mode);
  root.innerHTML = `<main class="campaign-screen">${menuHeader('campaign', store.snapshot().balance)}
    <section class="campaign-heading"><div><p class="eyebrow">CITY CIRCUITS</p><h1>CAMPAIGN<span>.</span></h1></div><p id="campaign-count" class="mono"></p></section>
    <div class="campaign-layout"><section class="campaign-courses" aria-label="트랙 선택">
      <div class="campaign-modes" role="group" aria-label="캠페인 방식"><button type="button" data-mode="time-attack">타임어택</button><button type="button" data-mode="competition">AI 레이스</button></div>
      <p id="campaign-rule" class="campaign-rule"></p><div id="campaign-list" class="campaign-list"></div>
    </section><section class="campaign-detail" aria-label="선택한 트랙"><div class="campaign-preview" id="campaign-preview" aria-label="트랙 3D 경로 미리보기"><p class="campaign-preview-legend">루프 · 코일 · 노면 회전 구간</p></div>
      <div class="campaign-detail-copy"><p class="eyebrow" id="course-district"></p><h2 id="course-name"></h2><p id="course-features"></p><p id="course-landmark"></p><section id="course-condition" class="course-condition" aria-label="통과 조건과 통과 기록 비교"></section><dl id="course-metrics"></dl><section id="course-record" class="course-record" aria-label="최단 완주 기록"></section><p id="course-access" role="status" tabindex="-1"></p><button id="course-start" class="primary-action" type="button">도전하기 ↗</button><p class="campaign-key-hint">Enter 선택 · Esc 이전으로</p><p id="campaign-warning" class="progress-warning" role="status"></p></div>
    </section></div></main>`;
  const get = (id: string) => root.querySelector<HTMLElement>(`#${id}`)!;
  const events = new AbortController(); const listen = { signal: events.signal };
  let preview: ReturnType<typeof createTrackPreview> | undefined;
  try { preview = createTrackPreview(get('campaign-preview')); } catch { get('campaign-preview').textContent = '3D 미리보기를 표시할 수 없습니다.'; }
  let disposed = false;
  const time = (seconds: number) => {
    const ms = Math.round(seconds * 1000);
    return `${Math.floor(ms / 60000)}:${(Math.floor(ms / 1000) % 60).toString().padStart(2, '0')}.${(ms % 1000).toString().padStart(3, '0')}`;
  };
  const focusSelected = () => {
    const card = root.querySelector<HTMLElement>(`[data-track="${selected.id}"]`);
    card?.focus({ preventScroll: true }); card?.scrollIntoView({ block: 'nearest' });
  };
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
      const clear = campaignClearRecord(campaign, mode, t);
      const record = clear ? `${mode === 'competition' ? `${clear.rank}위` : `${clear.laps.length}랩 통과`} · ${time(clear.total)}${clear.assisted ? ' · 보조' : ''}` : status === 'cleared' ? '이전 통과 기록' : '';
      return `<button type="button" class="course-card" data-status="${status}" data-track="${t.id}" aria-pressed="${t.id === selected.id}" style="--district-color:${district.color}"><span class="course-number mono">${String(t.order).padStart(2, '0')}</span><span class="course-card-copy"><strong>${t.name}</strong><small>난이도 ${t.rating}/6 · ${t.altitudeLevels}단 고도</small>${record ? `<small class="course-card-record">${record}</small>` : ''}</span><span class="course-status">${!campaign.knownTracks.includes(t.id) ? 'NEW · ' : ''}${status === 'cleared' ? '✓ 통과' : status === 'locked' ? '잠김' : '도전 가능'}</span></button>`;
    }).join('')}</div></section>`).join('');
    const track = createCatalogTrack(selected), metrics = trackMetrics(track), limit = campaignLapLimit(selected);
    preview?.setTrack(track, DISTRICTS[selected.district].color, selected);
    get('course-landmark').textContent = `랜드마크 · ${describeTrackLandmarks(track, selected).map(landmark => landmark.name).join(' / ')}`;
    get('course-district').textContent = `${DISTRICTS[selected.district].name} · ${String(selected.order).padStart(2, '0')}`;
    get('course-name').textContent = selected.name; get('course-features').textContent = selected.features;
    get('course-metrics').innerHTML = `<div><dt>난이도</dt><dd>${selected.rating}/6</dd></div><div><dt>랩 거리</dt><dd>${(metrics.length / 1000).toFixed(1)} km</dd></div><div><dt>고저차</dt><dd>${Math.round(metrics.heightRange)} m</dd></div><div><dt>고도 / 장애물</dt><dd>${selected.altitudeLevels}단 / ${metrics.obstacles}개</dd></div><div><dt>경기</dt><dd>${selected.laps}랩</dd></div>`;
    const entry = campaign.modes[mode][selected.id];
    const normal = entry?.records[`${selected.revision}:normal`], assisted = entry?.records[`${selected.revision}:assisted`];
    const clear = campaignClearRecord(campaign, mode, selected);
    const comparisonRows = mode === 'time-attack' ? Array.from({ length: selected.laps }, (_, i) => {
      const lap = clear?.laps[i], margin = lap === undefined ? undefined : limit - lap;
      return `<tr><th scope="row">${i + 1}랩</th><td>≤ ${time(limit)}</td><td data-met="${margin === undefined ? 'unknown' : margin >= -1e-8 ? 'yes' : 'no'}">${lap === undefined ? '—' : `<strong>${time(lap)}</strong><small>${margin! >= -1e-8 ? `${Math.max(0, margin!).toFixed(3)}초 여유` : `${(-margin!).toFixed(3)}초 초과`}</small>`}</td></tr>`;
    }).join('') : `<tr><th scope="row">순위</th><td>1위 / ${RACE_PARTICIPANT_COUNT}명</td><td data-met="${clear ? clear.rank === 1 ? 'yes' : 'no' : 'unknown'}"><strong>${clear ? `${clear.rank}위` : '—'}</strong></td></tr><tr><th scope="row">완주</th><td>${selected.laps}랩</td><td data-met="${clear ? clear.laps.length === selected.laps ? 'yes' : 'no' : 'unknown'}"><strong>${clear ? `${clear.laps.length} / ${selected.laps}랩` : '—'}</strong></td></tr>`;
    get('course-condition').innerHTML = `<div class="course-objective-heading"><span class="eyebrow">${mode === 'time-attack' ? '타임어택' : 'AI 레이스'}</span>${entry?.cleared ? '<span class="course-passed">✓ 통과</span>' : ''}</div><strong>${mode === 'time-attack' ? `매 랩 ${Math.floor(limit / 60)}분 ${limit % 60}초 이내` : `${RACE_PARTICIPANT_COUNT}명 중 1위로 완주`}</strong><table class="course-comparison"><thead><tr><th scope="col">구간</th><th scope="col">통과 조건</th><th scope="col">통과 기록</th></tr></thead><tbody>${comparisonRows}</tbody></table><span class="course-clear-summary">${clear ? `통과 경기 총 ${time(clear.total)}${clear.assisted ? ' · 보조 사용' : ''}${clear.revision !== selected.revision ? '<small>이전 트랙 버전의 기록 · 현재 조건과 비교합니다.</small>' : ''}` : entry?.cleared ? '이전 버전 통과 완료 · 당시 기록은 저장되지 않았습니다.' : `${selected.laps}랩 ${mode === 'time-attack' ? '모두 제한시간을 지키면' : '경기에서 우승하면'} 다음 코스가 열립니다.`}</span>`;
    const best = normal ?? assisted;
    get('course-record').innerHTML = best ? `<div class="course-best-record"><span>${best.assisted ? '보조 ' : ''}최단 완주</span><strong>${time(best.total)}${mode === 'competition' ? ` · ${best.rank}위` : ''}</strong></div>` : '<p>완주 기록이 없습니다.</p>';
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
    const action = (get('course-start') as HTMLButtonElement).disabled ? get('course-access') : get('course-start');
    action.focus({ preventScroll: true });
    const mobile = matchMedia('(max-width: 760px)').matches;
    action.scrollIntoView({ block: mobile ? 'center' : 'nearest', behavior: mobile ? 'smooth' : 'auto' });
  }, listen);
  for (const button of root.querySelectorAll<HTMLElement>('[data-mode]')) button.addEventListener('click', () => {
    mode = button.dataset.mode as RaceMode;
    if (campaignStatus(store.snapshot().campaign, mode, selected) === 'locked') selected = nextCampaignTrack(store.snapshot().campaign, mode);
    paint();
  }, listen);
  window.addEventListener('speedracer:menu-back', event => {
    if (document.activeElement === get('course-start') || document.activeElement === get('course-access')) { event.preventDefault(); focusSelected(); }
  }, listen);
  const returnFrame = context ? requestAnimationFrame(focusSelected) : 0;
  get('course-start').addEventListener('click', async () => {
    const chosenMode = mode, chosenTrack = selected.id;
    try { await store.command({ kind: 'campaign-select', mode: chosenMode, trackId: chosenTrack }); if (!disposed) location.hash = `drive?track=${chosenTrack}&mode=${chosenMode}`; }
    catch { if (!disposed) get('campaign-warning').textContent = store.issue; }
  }, listen);
  get('shop-back').addEventListener('click', () => { location.hash = ''; }, listen);
  get('open-shop').addEventListener('click', () => { location.hash = 'shop'; }, listen);
  return () => { disposed = true; cancelAnimationFrame(returnFrame); events.abort(); unsubscribe(); preview?.dispose(); };
}
