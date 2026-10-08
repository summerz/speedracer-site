import { RACE_CHALLENGES, challengeLapLimit, raceChallenge, type RaceChallengeId } from './game/track/raceChallenge';
import { RACE_PARTICIPANT_COUNT } from './game/driving/aiRoster';
import { menuHeader } from './menuHeader';
import { DRONE_CATALOG } from './game/drone/droneCatalog';
import { TRACK_CATALOG, DISTRICTS, campaignRankLimit } from './game/track/trackCatalog';
import { createCatalogTrack, trackMetrics } from './game/track/trackRuntime';
import { campaignStatus, nextCampaignTrack, campaignClearRecord, campaignDifficultyProgress, campaignStars } from './game/progression/campaign';
import type { ProgressStore } from './game/progression/progressStore';
import type { RaceMode } from './game/driving/createRaceSession';
import { createTrackPreview } from './game/track/createTrackPreview';
import { describeTrackLandmarks } from './game/track/createTrackLandmark';
import './campaign.css';

export function mountCampaign(root: HTMLDivElement, store: ProgressStore, context?: { mode: RaceMode; trackId?: string; challenge?: RaceChallengeId }) {
  document.title = 'Speedracer · 캠페인';
  const initial = store.snapshot().campaign;
  let mode: RaceMode = context?.mode ?? initial.last.mode;
  let challenge = raceChallenge(context?.challenge ?? initial.last.challenge);
  const pips = (n: number) => `<span class="pips" role="img" aria-label="코스 강도 ${n}/6">${[1,2,3,4,5,6].map(i => `<i data-on="${i <= n}"></i>`).join('')}</span>`;
  const starsMarkup = (count: number) => `<span class="course-stars" aria-label="별 ${count}개 / 3개">${[1,2,3].map(n => `<span aria-hidden="true" data-earned="${n <= count}">★</span>`).join('')}</span>`;
  let selected = TRACK_CATALOG.find(t => t.id === (context?.trackId ?? initial.last.trackId) && campaignStatus(initial, mode, t) !== 'locked') ?? nextCampaignTrack(initial, mode);
  root.innerHTML = `<main class="campaign-screen">${menuHeader('campaign', store.snapshot().balance)}
    <section class="campaign-heading"><div class="campaign-heading-title"><p class="eyebrow">CITY CIRCUITS</p><h1>CAMPAIGN<span>.</span></h1><div class="campaign-progress"><p id="campaign-count" class="mono"></p><span class="meter" aria-hidden="true"><i id="campaign-progress-bar"></i></span></div></div>
      <a id="campaign-craft" class="campaign-craft" href="#" aria-label="격납고에서 출전 기체 변경"><img id="campaign-craft-image" width="480" height="240" alt=""><span class="campaign-craft-copy"><span class="campaign-craft-caption">출전 기체<span aria-hidden="true">변경 ↗</span></span><strong id="campaign-craft-name"></strong><span id="campaign-craft-role"></span></span></a>
    </section>
    <div class="campaign-layout"><section class="campaign-courses" aria-label="트랙 선택">
      <div class="campaign-modes" role="group" aria-label="캠페인 방식"><button type="button" data-mode="time-attack"><span>타임어택</span><span class="campaign-mode-count"></span></button><button type="button" data-mode="competition"><span>경쟁 레이스</span><span class="campaign-mode-count"></span></button></div>
      <div class="campaign-difficulty"><span>출전 난이도</span><div class="course-challenges" role="group" aria-label="출전 난이도"><button type="button" data-challenge="easy">쉬움</button><button type="button" data-challenge="normal">중간</button><button type="button" data-challenge="hard">어려움</button></div></div>
      <p id="campaign-rule" class="campaign-rule"></p><div id="campaign-list" class="campaign-list"></div>
    </section><section class="campaign-detail" aria-label="선택한 트랙"><button id="course-list-back" class="course-list-back" type="button">← 코스 목록</button><div class="campaign-detail-copy"><div class="campaign-detail-head"><div class="campaign-preview" id="campaign-preview" aria-label="트랙 3D 경로 미리보기"><p class="campaign-preview-legend">루프 · 코일 · 노면 회전 구간</p></div>
      <div class="campaign-title"><p class="eyebrow" id="course-district"></p><div class="campaign-title-row"><h2 id="course-name"></h2><div id="course-stars-summary" class="course-stars-summary"></div></div></div></div>
      <div id="course-metrics" class="course-specs"></div><section id="course-condition" class="course-condition" aria-label="통과 조건과 통과 기록 비교"></section><section id="course-ladder" class="course-ladder" aria-label="별 등급 기준"></section><section id="course-routes" class="course-routes" aria-label="갈림길별 경험" hidden></section><div id="course-tags" class="course-tags"></div><section id="course-record" class="course-record" aria-label="최단 완주 기록"></section></div><footer class="campaign-detail-actions"><p id="course-access" role="status" tabindex="-1"></p><button id="course-start" class="primary-action" type="button">도전하기 ↗</button><p class="campaign-key-hint">Enter 선택 · Esc 이전으로</p><p id="campaign-warning" class="progress-warning" role="status"></p></footer>
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
  const screen = root.querySelector<HTMLElement>('.campaign-screen')!;
  const compact = () => matchMedia('(max-width: 999px) and (orientation: portrait), (max-width: 639px)').matches;
  const focusSelected = () => {
    screen.dataset.detail = 'closed';
    const card = root.querySelector<HTMLElement>(`[data-track="${selected.id}"]`);
    card?.focus({ preventScroll: true }); card?.scrollIntoView({ block: 'nearest' });
  };
  const paint = () => {
    const focusedTrack = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.track : undefined;
    const profile = store.snapshot(), campaign = profile.campaign;
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
    const count = TRACK_CATALOG.filter(t => campaignStatus(campaign, mode, t) === 'cleared').length;
    const starTotal = TRACK_CATALOG.reduce((sum, t) => sum + campaignStars(campaign, mode, t, challenge), 0), starMax = TRACK_CATALOG.length * 3;
    get('campaign-count').innerHTML = `<span>통과 <b>${count}</b>/${TRACK_CATALOG.length}</span><span class="stat-stars">★ <b>${starTotal}</b>/${starMax}</span>`;
    get('campaign-progress-bar').style.width = `${starMax ? starTotal / starMax * 100 : 0}%`;
    get('campaign-rule').textContent = mode === 'time-attack' ? '매 랩 제한시간 안에 완주하면 다음 트랙이 열립니다.' : `다른 기체 ${RACE_PARTICIPANT_COUNT - 1}대와 겨뤄 통과 순위 안에 완주하면 다음 트랙이 열립니다.`;
    for (const button of root.querySelectorAll<HTMLElement>('[data-mode]')) {
      const buttonMode = button.dataset.mode as RaceMode;
      const cleared = TRACK_CATALOG.filter(t => campaignStatus(campaign, buttonMode, t) === 'cleared').length;
      button.setAttribute('aria-pressed', String(buttonMode === mode));
      button.querySelector('.campaign-mode-count')!.textContent = `통과 ${cleared} / ${TRACK_CATALOG.length}`;
    }
    get('campaign-list').innerHTML = Object.entries(DISTRICTS).map(([id, district]) => {
      const tracks = TRACK_CATALOG.filter(t => t.district === id);
      if (tracks.every(t => campaignStatus(campaign, mode, t) === 'locked' && t.id !== selected.id)) return `<section class="course-district district-locked" style="--district-color:${district.color}"><div class="district-head"><h3>${district.name}</h3><span class="district-stat">잠김 · ${tracks.length}코스</span></div><p class="district-locked-list">${tracks.map(t => `${String(t.order).padStart(2, '0')} ${t.name}`).join(' · ')}</p></section>`;
      const dStars = tracks.reduce((sum, t) => sum + campaignStars(campaign, mode, t, challenge), 0), dCleared = tracks.filter(t => campaignStatus(campaign, mode, t) === 'cleared').length;
      return `<section class="course-district" style="--district-color:${district.color}"><div class="district-head"><h3>${district.name}</h3><span class="district-stat mono">통과 ${dCleared}/${tracks.length} · ★ ${dStars}/${tracks.length * 3}</span></div><span class="meter district-meter" aria-hidden="true"><i style="width:${dStars / (tracks.length * 3) * 100}%"></i></span><p class="district-description">${district.description}</p><div>${tracks.map(t => {
      const status = campaignStatus(campaign, mode, t);
      const clear = campaignClearRecord(campaign, mode, t, challenge);
      const stars = campaignStars(campaign, mode, t, challenge);
      const record = clear ? `${mode === 'competition' ? `${clear.rank}위` : `${clear.laps.length}랩 통과`} · ${time(clear.total)}${clear.assisted ? ' · 보조' : ''}` : status === 'cleared' ? campaignDifficultyProgress(campaign, mode, t, challenge)?.cleared ? '이전 통과 기록' : '다른 난이도에서 통과' : '';
      const fresh = !campaign.knownTracks.includes(t.id) ? '<em class="course-new">NEW</em>' : '';
      const meta = status === 'locked' ? '' : `<small class="course-meta">${pips(t.rating)}<span>${t.altitudeLevels}단 고도</span>${mode === 'competition' ? `<span>${campaignRankLimit(t)}위 이내</span>` : ''}</small>`;
      const side = status === 'locked' ? '<span class="course-status">잠김</span>' : status === 'cleared' ? starsMarkup(stars) : '<span class="course-status">도전</span>';
      return `<button type="button" class="course-card" data-status="${status}" data-track="${t.id}" aria-pressed="${t.id === selected.id}" style="--district-color:${district.color}"><span class="course-number mono">${String(t.order).padStart(2, '0')}</span><span class="course-card-copy"><strong>${t.name}${fresh}</strong>${meta}${record && status !== 'locked' ? `<small class="course-card-record">${record}</small>` : ''}</span><span class="course-card-status">${side}</span></button>`;
    }).join('')}</div></section>`; }).join('');
    const track = createCatalogTrack(selected, challenge), metrics = trackMetrics(track), limit = challengeLapLimit(selected, challenge);
    preview?.setTrack(track, DISTRICTS[selected.district].color, selected);
    get('course-district').textContent = `${DISTRICTS[selected.district].name} · ${String(selected.order).padStart(2, '0')}`;
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
    for (const button of root.querySelectorAll<HTMLElement>('[data-challenge]')) button.setAttribute('aria-pressed', String(button.dataset.challenge === challenge));
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
    get('course-access').textContent = status === 'locked' ? `${TRACK_CATALOG.find(t => t.id === selected.predecessor)?.name}을 이 방식으로 통과하면 열립니다.` : status === 'cleared' ? '통과한 코스 · 다시 플레이할 수 있습니다.' : '도전 가능한 코스';
    (get('course-start') as HTMLButtonElement).disabled = status === 'locked'; get('course-start').textContent = `${entry?.cleared ? '다시 도전' : '도전하기'} · ${RACE_CHALLENGES[challenge].label} ↗`;
    get('campaign-warning').textContent = store.issue;
    if (focusedTrack) root.querySelector<HTMLElement>(`[data-track="${focusedTrack}"]`)?.focus({ preventScroll:true });
  };
  const unsubscribe = store.subscribe(() => { if (!disposed) paint(); }); paint();
  get('campaign-list').addEventListener('click', event => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-track]');
    if (!target) return; selected = TRACK_CATALOG.find(t => t.id === target.dataset.track)!; paint();
    const action = (get('course-start') as HTMLButtonElement).disabled ? get('course-access') : get('course-start');
    screen.dataset.detail = 'open';
    if (compact()) window.scrollTo({ top: 0, behavior: 'instant' });
    action.focus({ preventScroll: true });
  }, listen);
  for (const button of root.querySelectorAll<HTMLElement>('[data-mode]')) button.addEventListener('click', () => {
    mode = button.dataset.mode as RaceMode;
    if (campaignStatus(store.snapshot().campaign, mode, selected) === 'locked') selected = nextCampaignTrack(store.snapshot().campaign, mode);
    paint();
  }, listen);
  for (const button of root.querySelectorAll<HTMLElement>('[data-challenge]')) button.addEventListener('click', () => { challenge = raceChallenge(button.dataset.challenge); paint(); }, listen);
  get('course-list-back').addEventListener('click', focusSelected, listen);
  window.addEventListener('speedracer:menu-back', event => {
    if ((compact() && screen.dataset.detail === 'open') || document.activeElement === get('course-start') || document.activeElement === get('course-access')) { event.preventDefault(); focusSelected(); }
  }, listen);
  const returnFrame = context ? requestAnimationFrame(focusSelected) : 0;
  get('course-start').addEventListener('click', async () => {
    const chosenMode = mode, chosenTrack = selected.id, chosenChallenge = challenge;
    try { await store.command({ kind: 'campaign-select', mode: chosenMode, trackId: chosenTrack, challenge: chosenChallenge }); if (!disposed) location.hash = `drive?track=${chosenTrack}&mode=${chosenMode}&challenge=${chosenChallenge}`; }
    catch { if (!disposed) get('campaign-warning').textContent = store.issue; }
  }, listen);
  get('shop-back').addEventListener('click', () => { location.hash = ''; }, listen);
  get('open-shop').addEventListener('click', () => { location.hash = 'shop'; }, listen);
  return () => { disposed = true; cancelAnimationFrame(returnFrame); events.abort(); unsubscribe(); preview?.dispose(); };
}
