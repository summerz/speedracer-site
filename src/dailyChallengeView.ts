import { dailyChallengeFor, dailyDateKey, dailySnapshot, dailyChallengeHash, type DailySnapshot, type DailyGoalId, type DailySettlement } from './game/progression/dailyChallenge';
import { trackDefinition } from './game/track/trackCatalog';
import { DRONE_CATALOG } from './game/drone/droneCatalog';
import { RACE_CHALLENGES } from './game/track/raceChallenge';
import type { ProgressStore } from './game/progression/progressStore';
import './dailyChallenge.css';
export const dailyGoalLabel = (id: DailyGoalId) => ({ boost: '부스트', 'safe-pass': '안전 통과', drift: '드리프트' })[id];
const time = (seconds: number) => {
  const ticks = Math.round(seconds * 100);
  return `${Math.floor(ticks / 6000)}:${(Math.floor(ticks / 100) % 60).toString().padStart(2, '0')}.${(ticks % 100).toString().padStart(2, '0')}`;
};
export function mountDailyChallengeCard(host: HTMLElement, store: ProgressStore): () => void {
  const card = document.createElement('section'); card.className = 'daily-card'; card.setAttribute('aria-label', '오늘의 도전');
  card.innerHTML = '<div class="daily-card-heading"><span>오늘의 도전</span><b class="daily-prize"></b></div><h2></h2><p class="daily-details"></p><div class="daily-card-footer"><p class="daily-summary"></p><a class="daily-start" href="#drive?daily=1">도전하기 <span aria-hidden="true">↗</span></a></div>';
  host.append(card);
  const update = () => {
    const challenge = dailyChallengeFor(dailyDateKey()), snapshot = dailySnapshot(store.snapshot(), challenge);
    const remaining = snapshot.nextDayInSeconds, hours = Math.floor(remaining / 3600), minutes = Math.floor(remaining % 3600 / 60);
    card.querySelector('h2')!.textContent = trackDefinition(challenge.trackId)!.name;
    card.querySelector('.daily-prize')!.textContent = snapshot.rewardClaimed ? '보상 수령 완료' : '+150 P';
    card.querySelector('.daily-details')!.textContent = `${DRONE_CATALOG.find(c => c.configuration.id === challenge.craftId)!.name} 대여 · ${RACE_CHALLENGES[challenge.challenge].label} · ${dailyGoalLabel(challenge.goal.id)} ${challenge.goal.target}회`;
    card.querySelector('.daily-summary')!.textContent = `${snapshot.best ? `최고 ${time(snapshot.best.total)}` : '완주 + 목표 달성'} · ${hours}시간 ${minutes}분 후 교체`;
    const link = card.querySelector<HTMLAnchorElement>('a')!; link.href = dailyChallengeHash(); link.firstChild!.textContent = snapshot.best ? '다시 도전 ' : '도전하기 ';
  };
  update(); const unsubscribe = store.subscribe(update), timer = window.setInterval(update, 1000);
  return () => { unsubscribe(); clearInterval(timer); card.remove(); };
}
export function renderDailyHud(host: HTMLElement, snapshot: DailySnapshot | null) {
  host.hidden = !snapshot; if (!snapshot) return;
  const current = Math.min(snapshot.target, snapshot.current), text = `오늘의 도전 · ${dailyGoalLabel(snapshot.challenge.goal.id)} ${current}/${snapshot.target}${snapshot.done ? ' ✓' : ''}`;
  if (host.textContent !== text) host.textContent = text;
  host.classList.toggle('is-done', snapshot.done);
}
export function renderDailySettlement(host: HTMLElement, snapshot: DailySnapshot, settlement: DailySettlement, balance: number) {
  host.innerHTML = '<div class="reward-total"><strong></strong><span></span></div><p class="daily-result-goal"></p><p class="daily-result-best"></p><p class="daily-result-note"></p>';
  host.querySelector('strong')!.textContent = `+${settlement.awarded} P`;
  host.querySelector('.reward-total span')!.textContent = `보유 ${balance.toLocaleString()} P`;
  host.querySelector('.daily-result-goal')!.textContent = `${dailyGoalLabel(snapshot.challenge.goal.id)} ${Math.min(snapshot.current, snapshot.target)}/${snapshot.target} · ${settlement.success ? '도전 성공' : '도전 미완료'}`;
  host.querySelector('.daily-result-best')!.textContent = settlement.best ? `오늘 최고 ${time(settlement.best.total)}${settlement.isNewBest ? ' · NEW BEST' : ''}` : '오늘 최고 기록 없음';
  host.querySelector('.daily-result-note')!.textContent = settlement.awarded ? '첫 성공 보상 150P를 받았습니다.' : settlement.rewardClaimed ? '오늘 보상은 이미 받았습니다. 기록은 계속 도전할 수 있어요.' : '목표를 달성하고 제한시간 안에 완주하면 150P.';
}
