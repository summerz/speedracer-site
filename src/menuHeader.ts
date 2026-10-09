import './menuHeader.css';

/** All menu pages share the same navigation and app controls. */
export function menuHeader(current: 'hangar' | 'shop' | 'campaign' | 'sound-lab', balance: number): string {
  return `<header class="masthead menu-header">
    <a class="wordmark" href="/" aria-label="Speedracer 홈">
      <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M20 3 7 17h10l-5 12L26 13H16z"/></svg>
      SPEEDRACER<span class="wordmark-divider"></span><span class="wordmark-caption">DRONE RACING</span>
    </a>
    <div class="menu-header-tools">
      <button class="menu-header-button menu-music" type="button" data-music-toggle aria-pressed="true" aria-keyshortcuts="M"><span data-music-label>음악 켜짐</span><kbd class="key-badge">M</kbd></button>
      <button class="menu-header-button" type="button" data-analytics-settings hidden>이용 분석</button>
      <div class="app-tools" data-app-tools></div>
    </div>
    <nav class="menu-navigation" aria-label="메인 메뉴">
      <div class="menu-header-tabs">
        <button id="shop-back" class="menu-header-button" type="button" aria-keyshortcuts="1" ${current === 'hangar' ? 'aria-current="page"' : ''}>격납고 <kbd class="key-badge">1</kbd></button>
        <a class="menu-header-button" href="#campaign" aria-keyshortcuts="2" ${current === 'campaign' ? 'aria-current="page"' : ''}>캠페인 <kbd class="key-badge">2</kbd></a>
        <button id="open-shop" class="menu-header-button" type="button" aria-keyshortcuts="3" ${current === 'shop' ? 'aria-current="page"' : ''}>상점 <kbd class="key-badge">3</kbd></button>
        ${import.meta.env.DEV ? `<a class="menu-header-button" href="#sound-lab" aria-keyshortcuts="4" ${current === 'sound-lab' ? 'aria-current="page"' : ''}>사운드 관리 <kbd class="key-badge">4</kbd></a>` : ''}
      </div>
      <strong class="menu-balance mono" id="${current}-balance" aria-label="보유 포인트">${balance.toLocaleString()} P</strong>
    </nav>
  </header>`;
}
