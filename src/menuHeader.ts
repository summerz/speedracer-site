import './menuHeader.css';

/** The hangar and shop share the same navigation and app controls. */
export function menuHeader(current: 'hangar' | 'shop' | 'campaign', balance: number): string {
  return `<header class="masthead menu-header">
    <a class="wordmark" href="/" aria-label="Speedracer 홈">
      <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M20 3 7 17h10l-5 12L26 13H16z"/></svg>
      SPEEDRACER<span class="wordmark-divider"></span><span class="wordmark-caption">DRONE RACING</span>
    </a>
    <div class="menu-header-tools">
      <button class="menu-header-button menu-music" type="button" data-music-toggle aria-pressed="true">음악 켜짐</button>
      <button class="menu-header-button" type="button" data-analytics-settings hidden>이용 분석</button>
      <div class="app-tools" data-app-tools></div>
    </div>
    <nav class="menu-navigation" aria-label="메인 메뉴">
      <div class="menu-header-tabs">
        <button id="shop-back" class="menu-header-button" type="button" ${current === 'hangar' ? 'aria-current="page" disabled' : ''}>격납고</button>
        <a class="menu-header-button" href="#campaign" ${current === 'campaign' ? 'aria-current="page"' : ''}>캠페인</a>
        <button id="open-shop" class="menu-header-button" type="button" ${current === 'shop' ? 'aria-current="page" disabled' : ''}>상점</button>
      </div>
      <strong class="menu-balance mono" id="${current}-balance" aria-label="보유 포인트">${balance.toLocaleString()} P</strong>
    </nav>
  </header>`;
}
