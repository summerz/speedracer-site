import { gameAnalytics, setAnalyticsConsent } from './gameAnalytics';
import './analyticsPreferences.css';

/** A single menu notice; racing never opens or displays an analytics prompt. */
export function mountAnalyticsPreferences(root: HTMLElement): () => void {
  if (!gameAnalytics.available) return () => {};
  const events = new AbortController();
  const listen = { signal: events.signal };
  const notice = document.createElement('aside');
  notice.className = 'analytics-notice';
  notice.setAttribute('aria-label', '선택적 이용 분석');
  notice.innerHTML = `<p>게임 개선을 위한 이용 분석에 참여할까요?<small>Google Analytics로 방문·주행 결과를 분석합니다. 거절해도 모든 기능을 사용할 수 있습니다.</small></p><div><button type="button" data-choice="false">참여 안 함</button><button type="button" data-choice="true">참여하기</button><button type="button" data-details>자세히</button></div>`;
  const dialog = document.createElement('dialog');
  dialog.className = 'analytics-dialog';
  dialog.setAttribute('aria-labelledby', 'analytics-title');
  dialog.innerHTML = `<h2 id="analytics-title">이용 분석</h2><p>Speedracer 개선을 위해 Google Analytics 4로 방문 화면과 주행 시작·완료·중도 종료, 트랙·난이도·기체, 주행 시간과 충돌·이탈 횟수를 분석합니다.</p><p>동의하면 Google Analytics 쿠키와 브라우저·기기 정보를 이용해 재방문을 파악합니다. 이름·이메일·저장 파일은 보내지 않습니다. 광고 개인화와 Google Signals는 사용하지 않습니다.</p><p>동의 전 기록은 전송하지 않습니다. 아래에서 언제든 참여를 해제할 수 있으며, 게임 기록과 구매 내역에는 영향이 없습니다.</p><p data-consent-status></p><div><button type="button" data-choice="false">참여 안 함</button><button type="button" data-choice="true">참여하기</button><button type="button" data-close>닫기</button></div>`;
  document.body.append(notice, dialog);
  const paint = () => {
    const menu = !!root.querySelector('.menu-header');
    notice.hidden = !menu || gameAnalytics.consent !== null;
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-analytics-settings]')) button.hidden = false;
    dialog.querySelector('[data-consent-status]')!.textContent = gameAnalytics.consent === true ? '현재: 참여 중' : gameAnalytics.consent === false ? '현재: 참여 안 함' : '현재: 아직 선택하지 않음';
  };
  const observer = new MutationObserver(paint);
  observer.observe(root, { childList: true });
  const open = () => { paint(); if (!dialog.open) dialog.showModal(); };
  root.addEventListener('click', event => {
    if (event.target instanceof Element && event.target.closest('[data-analytics-settings]')) open();
  }, listen);
  notice.querySelector('[data-details]')!.addEventListener('click', open, listen);
  const choose = (event: Event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-choice]') : null;
    if (!button) return;
    setAnalyticsConsent(button.dataset.choice === 'true');
    dialog.close(); paint();
  };
  notice.addEventListener('click', choose, listen);
  dialog.addEventListener('click', choose, listen);
  dialog.querySelector('[data-close]')!.addEventListener('click', () => dialog.close(), listen);
  window.addEventListener('storage', event => {
    if (event.key !== 'speedracer.analytics-consent.v1' && event.key !== null) return;
    gameAnalytics.setConsent(event.newValue === 'granted'); paint();
  }, listen);
  paint();
  return () => { events.abort(); observer.disconnect(); dialog.close(); dialog.remove(); notice.remove(); };
}
