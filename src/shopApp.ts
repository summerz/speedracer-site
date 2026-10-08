import { createHangar } from './game/createHangar';
import { menuHeader } from './menuHeader';
import { DRONE_CATALOG, droneStats } from './game/drone/droneCatalog';
import { CRAFT_PRICES, craftResaleValue, STARTER_ID, emptyLevels, FOCUS_PRICE, RIVAL_ITEMS, INVENTORY_LIMIT, UPGRADES, UPGRADE_COSTS, upgradedConfiguration } from './game/progression/catalog';
import type { UpgradeId, RivalItemId } from './game/progression/catalog';
import type { ProgressCommand } from './game/progression/progress';
import type { ProgressStore } from './game/progression/progressStore';
import './shop.css';

export function mountShop(root: HTMLDivElement, store: ProgressStore, onBack: () => void) {
  document.title = 'Speedracer · 상점';
  const total = DRONE_CATALOG.length;
  root.innerHTML = `<main class="shop-screen" data-view="craft">
    ${menuHeader('shop', store.snapshot().balance)}
    <nav class="shop-tabs shop-top-tabs" aria-label="상품 종류"><button type="button" data-tab="craft" aria-pressed="true">기체</button><button type="button" data-tab="item" aria-pressed="false">아이템</button></nav>
    <section class="shop-hero" aria-label="선택 기체 미리보기"><div class="shop-preview"><div id="shop-scene" class="scene"></div><div class="shop-preview-label"><strong id="shop-preview-name"></strong><span id="shop-preview-role"></span></div><em id="shop-preview-badge" class="shop-badge"></em><button id="shop-preview-reset" type="button">시점 초기화</button>
      <button type="button" class="shop-arrow is-prev" data-craft-step="-1" data-own-horizontal-keys aria-label="이전 기체"><span aria-hidden="true">◀</span></button><button type="button" class="shop-arrow is-next" data-craft-step="1" data-own-horizontal-keys aria-label="다음 기체"><span aria-hidden="true">▶</span></button></div>
      <div class="shop-pager" role="group" aria-label="기체 선택">${DRONE_CATALOG.map(craft => `<button type="button" class="shop-dot" data-craft="${craft.configuration.id}" style="--craft-color:${craft.lineColor}"><i aria-hidden="true"></i></button>`).join('')}<b id="shop-pager-count" class="mono"></b></div></section>
    <section class="shop-content">
    <p id="shop-message" class="shop-message" role="status" aria-live="polite"></p><div id="shop-products"></div></section></main>`;
  const get = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const controller = new AbortController(); const options = { signal: controller.signal };
  let selected = store.snapshot().equipped;
  let tab: 'craft' | 'item' = 'craft'; let sub: 'stats' | 'upgrade' = 'stats'; let busy = false; let disposed = false;
  const hangar = createHangar(get<HTMLDivElement>('shop-scene'), () => { get('shop-message').textContent = '3D 미리보기 연결이 끊겼습니다. 다시 불러와주세요.'; }, upgradedConfiguration(selected, store.snapshot().upgrades[selected]), true);
  let shown = '';
  let salePending = false;
  const insufficient = (cost: number, balance: number) => cost > balance ? `<small>${cost - balance}P 부족</small>` : '';
  const pips = (level: number) => `<span class="pips" aria-label="${level}/3 단계">${[0, 1, 2].map(i => `<i class="${i < level ? 'on' : ''}"></i>`).join('')}</span>`;
  const kmh = (v: number) => String(Math.round(v * 3.6));
  type Metric = { label: string; before: string; after: string; unit: string };
  const upgradeMetrics = (id: UpgradeId, from: ReturnType<typeof upgradedConfiguration>, to: ReturnType<typeof upgradedConfiguration>): Metric[] => {
    const a = from.performance, n = to.performance; const m = (label: string, x: string, y: string, unit: string) => ({ label, before: x, after: y, unit });
    return id === 'engine' ? [m('최고 속도', kmh(a.topSpeed), kmh(n.topSpeed), 'km/h'), m('부스트 1/2', `${kmh(a.boostSpeed)}/${kmh(a.boostStage2Speed)}`, `${kmh(n.boostSpeed)}/${kmh(n.boostStage2Speed)}`, 'km/h'), m('가속', a.acceleration.toFixed(1), n.acceleration.toFixed(1), 'm/s²')]
      : id === 'brakes' ? [m('제동력', a.braking.toFixed(1), n.braking.toFixed(1), 'm/s²')]
      : id === 'steering' ? [m('좌우 핸들링', droneStats(from)[2].value, droneStats(to)[2].value, '°/s')]
      : id === 'stabilizer' ? [m('좌우 제동', (Math.log(10) / a.lateralBraking).toFixed(2), (Math.log(10) / n.lateralBraking).toFixed(2), 's')]
      : [m('부스트 소모', (a.boostDrain * 100).toFixed(1), (n.boostDrain * 100).toFixed(1), '%/s'), m('부스트 회복', (a.boostRecovery * 100).toFixed(1), (n.boostRecovery * 100).toFixed(1), '%/s')];
  };
  const render = () => {
    const profile = store.snapshot(); const entry = DRONE_CATALOG.find(craft => craft.configuration.id === selected)!;
    const levels = profile.upgrades[selected] ?? emptyLevels();
    const config = upgradedConfiguration(selected, levels);
    const key = `${selected}:${JSON.stringify(levels)}`;
    if (shown !== key) { hangar.setDrone(config); shown = key; }
    get('shop-balance').textContent = `${profile.balance.toLocaleString()} P`;
    get('shop-preview-name').textContent = entry.name; get('shop-preview-role').textContent = entry.role;
    if (store.issue) get('shop-message').textContent = store.issue;
    root.querySelector<HTMLElement>('.shop-screen')!.dataset.view = tab;
    root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.tab === tab)));
    const statusOf = (id: string) => profile.equipped === id ? '장착 중' : profile.owned.includes(id) ? '보유' : `${CRAFT_PRICES[id].toLocaleString()} P`;
    get('shop-preview-badge').textContent = statusOf(selected);
    get('shop-preview-badge').dataset.state = profile.equipped === selected ? 'equipped' : profile.owned.includes(selected) ? 'owned' : 'price';
    const index = DRONE_CATALOG.findIndex(craft => craft.configuration.id === selected);
    const neighbour = (step: number) => DRONE_CATALOG[(index + step + total) % total].name;
    const hero = root.querySelector<HTMLElement>('.shop-hero')!; hero.style.setProperty('--craft-color', entry.lineColor);
    root.querySelector('.shop-arrow.is-prev')!.setAttribute('aria-label', `이전 기체 · ${neighbour(-1)}`);
    root.querySelector('.shop-arrow.is-next')!.setAttribute('aria-label', `다음 기체 · ${neighbour(1)}`);
    root.querySelectorAll<HTMLButtonElement>('.shop-dot').forEach(dot => { const id = dot.dataset.craft!; const name = DRONE_CATALOG.find(craft => craft.configuration.id === id)!.name; dot.setAttribute('aria-pressed', String(id === selected)); dot.setAttribute('aria-label', `${name} · ${statusOf(id)}`); dot.classList.toggle('is-owned', profile.owned.includes(id)); });
    get('shop-pager-count').textContent = `${index + 1}/${total}`;
    if (tab === 'craft') {
      const owned = profile.owned.includes(selected); const price = CRAFT_PRICES[selected];
      const isEquipped = profile.equipped === selected;
      const current = upgradedConfiguration(profile.equipped, profile.upgrades[profile.equipped]);
      const currentStats = droneStats(current);
      const equippedName = DRONE_CATALOG.find(c => c.configuration.id === profile.equipped)!.name;
      const pct = (fill: number) => `${Math.round(Math.max(0, Math.min(1, fill)) * 100)}%`;
      const delta = (now: { value: string; fill: number }, before: { value: string; fill: number }) => {
        if (isEquipped) return '';
        const decimals = now.value.split('.')[1]?.length ?? 0; const diff = Number(now.value) - Number(before.value);
        if (Math.abs(diff) < Math.pow(10, -decimals) / 2 || now.fill === before.fill) return '<em class="delta"></em>';
        const better = now.fill > before.fill;
        return `<em class="delta ${better ? 'up' : 'down'}">${better ? '+' : '−'}${Math.abs(diff).toFixed(decimals)}</em>`;
      };
      const bars = droneStats(config).map((stat, i) => `<div class="stat-row"><span class="stat-label">${stat.label}</span><span class="stat-track">${isEquipped ? '' : `<i class="ghost" style="width:${pct(currentStats[i].fill)}"></i>`}<i class="cur" style="width:${pct(stat.fill)}"></i></span><span class="stat-value"><b>${stat.value}</b><small>${stat.unit}</small>${delta(stat, currentStats[i])}</span></div>`).join('');
      const side = (a: string, b: string) => isEquipped || a === b ? `<b>${b}</b>` : `<span>${a}</span> → <b>${b}</b>`;
      const boost = (p: typeof config.performance) => `${Math.round(p.boostSpeed * 3.6)} / ${Math.round(p.boostStage2Speed * 3.6)}`;
      const sale = owned && selected !== STARTER_ID ? `<div class="shop-sale"><div class="shop-sale-row"><button type="button" class="sell-action" data-action="sell" ${busy ? 'disabled' : ''}>${craftResaleValue(selected).toLocaleString()} P · 판매</button><small class="shop-hint">구매가의 80% 반환 · 강화 비용 제외</small></div>${salePending ? `<div class="sale-confirm" role="group" aria-label="기체 판매 확인"><p>${entry.name}을 판매하고 ${craftResaleValue(selected).toLocaleString()} P를 받습니다. 적용된 강화도 삭제됩니다.${profile.equipped === selected ? ' 기본 기체로 자동 장착됩니다.' : ''}</p><div><button type="button" data-action="confirm-sale" class="sell-action" ${busy ? 'disabled' : ''}>판매 확정</button><button type="button" data-action="cancel-sale" ${busy ? 'disabled' : ''}>취소</button></div></div>` : ''}</div>` : '';
      const statsView = `<p class="shop-comparison-title">${isEquipped ? `${equippedName} · 장착 중인 성능` : `<i class="ghost-key"></i>${equippedName} 장착 성능 대비 <i class="cur-key"></i>${entry.name}`}</p><div class="shop-stats">${bars}</div><p class="stat-extra"><span>부스트 1 / 2</span><span class="mono">${side(boost(current.performance), boost(config.performance))} km/h</span><span>제동력</span><span class="mono">${side(current.performance.braking.toFixed(0), config.performance.braking.toFixed(0))} m/s²</span></p><p class="shop-hint">핸들링은 216km/h 기준 · 좌우 제동 시간과 충돌 감속은 낮을수록 유리합니다. 막대는 길수록 유리합니다.</p>`;
      const upgradeView = `<p class="shop-desc">${owned ? '구매한 기체에 영구 적용됩니다. 최대 3단계.' : '구매 후 강화할 수 있습니다'}</p>${owned ? '' : '<p class="shop-comparison-title">최대 3단계 강화 시</p>'}${UPGRADES.map(upgrade => {
        const level = levels[upgrade.id]; const cost = UPGRADE_COSTS[level];
        const after = owned ? level < 3 ? upgradedConfiguration(selected, { ...levels, [upgrade.id]: level + 1 }) : config : upgradedConfiguration(selected, { ...levels, [upgrade.id]: 3 });
        const showNext = !owned || level < 3;
        const rows = upgradeMetrics(upgrade.id, config, after).map(m => `<div class="metric"><span>${m.label}</span><span class="mono"><b>${m.before}</b>${showNext ? ` <i>→</i> <b class="next">${m.after}</b>` : ''} <small>${m.unit}</small></span></div>`).join('');
        const reason = level < 3 && cost > profile.balance ? insufficient(cost, profile.balance) : '';
        const button = owned ? `<div class="shop-action"><button type="button" class="primary-action" data-upgrade="${upgrade.id}" ${busy || level === 3 || cost > profile.balance ? 'disabled' : ''}>${level === 3 ? '최대 단계' : `${cost} P · 강화`}</button>${reason}</div>` : '';
        return `<article class="shop-upgrade ${owned ? '' : 'is-preview'}"><div class="upgrade-info"><h3>${upgrade.name} ${pips(owned ? level : 0)}<small>${owned ? level : 0}/3</small></h3><p>${upgrade.description}${upgrade.id === 'stabilizer' ? ' · 입력 해제 후 잔류 방향 90% 감소 시간' : ''}</p><div class="metrics">${rows}</div></div>${button}</article>`;
      }).join('')}`;
      get('shop-products').innerHTML = `<div class="shop-detail"><div class="shop-title"><p class="eyebrow">${entry.role}</p><h2>${entry.name}</h2><p class="shop-desc">${entry.description}</p></div><div class="shop-action-zone">${isEquipped ? '<div class="shop-action shop-buy is-status"><strong class="equipped-status">✓ 장착 중</strong></div>' : `<div class="shop-action shop-buy"><div class="shop-buy-info"><span>${owned ? '보유' : '가격'}</span>${owned ? '' : `<strong>${price.toLocaleString()} P</strong>`}${owned ? '' : insufficient(price, profile.balance)}</div><button type="button" class="primary-action" data-action="${owned ? 'equip' : 'craft'}" ${busy || !owned && price > profile.balance ? 'disabled' : ''}>${owned ? '이 기체 장착' : `<span class="full">${price.toLocaleString()} P · 구매</span><span class="short">구매하기</span>`}</button></div>`}${sale}</div><nav class="shop-tabs shop-subtabs" aria-label="기체 정보"><button type="button" data-subtab="stats" aria-pressed="${sub === 'stats'}">성능</button><button type="button" data-subtab="upgrade" aria-pressed="${sub === 'upgrade'}">강화</button></nav><div class="shop-subview" style="--craft-color:${entry.lineColor}">${sub === 'stats' ? statsView : upgradeView}</div></div>`;
    } else {
      get('shop-products').innerHTML = `<div class="shop-detail"><p class="eyebrow">RACE ITEMS</p><h2>주행 아이템</h2><p class="shop-note">장착은 캠페인에서 트랙을 고른 뒤 출전 직전에 선택합니다 <a href="#campaign">캠페인으로 ↗</a></p><div class="shop-item-grid">${(() => {
        const card = (name: string, desc: string, stock: number, price: number, attrs: string, only: boolean) => `<article class="shop-upgrade shop-item"><div class="item-head"><h3>${name}</h3>${only ? '<span class="scope">경쟁 레이스 전용</span>' : ''}<span class="stock">보유 ${stock} / ${INVENTORY_LIMIT}</span><div class="shop-action"><button type="button" class="primary-action" ${attrs} ${busy || stock >= INVENTORY_LIMIT || profile.balance < price ? 'disabled' : ''}>${price} P · 1개 구매</button>${stock >= INVENTORY_LIMIT ? '<small>최대 보유</small>' : insufficient(price, profile.balance)}</div></div><p>${desc}</p></article>`;
        return card('집중 모드', '2초 동안 모든 기체의 주행을 45% 속도로 늦춥니다. 경기 시계는 정상적으로 흐릅니다. · 모든 모드', profile.focus, FOCUS_PRICE, 'data-action="focus"', false)
          + RIVAL_ITEMS.map(item => card(item.name, item.description, profile.rivalInventory[item.id], item.price, `data-rival-buy="${item.id}"`, true)).join('');
      })()}</div><div class="shop-footnote"><p>합계 2개 장착 · 공통 재사용 대기 3초. 아이템 장착 경기는 보조 기록으로 분리하며 기본 보상은 80%, 기록 갱신 보너스는 없습니다. 사용하지 않은 수량은 남습니다.</p><p>타임어택에서는 상대 기체 대상 아이템이 출전에 포함되지 않습니다. 전파 교란은 앞쪽 180m 안에 대상이 없으면 소비하지 않습니다. V / 패드 LB로 사용 가능한 다음 아이템을 쓰거나 주행 버튼을 눌러 선택하세요.</p></div></div>`;
    }
  };
  const purchase = async (command: ProgressCommand) => {
    if (busy) return; busy = true; render();
    try { await store.command(command); if (!disposed) get('shop-message').textContent = command.kind === 'craft' ? '구매했습니다. 장착 버튼으로 선택할 수 있습니다.' : command.kind === 'sell-craft' ? `${craftResaleValue(command.id).toLocaleString()} P를 돌려받았습니다.` : command.kind === 'equip' ? '기체를 장착했습니다.' : '저장했습니다.'; }
    catch (error) { if (!disposed) get('shop-message').textContent = error instanceof Error ? error.message : '저장하지 못했습니다.'; }
    finally { busy = false; if (!disposed) render(); }
  };
  const step = (by: number) => { const index = DRONE_CATALOG.findIndex(craft => craft.configuration.id === selected); selected = DRONE_CATALOG[(index + by + total) % total].configuration.id; salePending = false; render(); };
  root.addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button');
    if (!button || button.disabled || busy) return;
    if (button.dataset.rivalBuy) void purchase({ kind: 'rival-buy', item: button.dataset.rivalBuy as RivalItemId, mode: 'competition' });
    else if (button.dataset.tab) { tab = button.dataset.tab as typeof tab; salePending = false; render(); }
    else if (button.dataset.subtab) { sub = button.dataset.subtab as typeof sub; render(); }
    else if (button.dataset.craftStep) step(Number(button.dataset.craftStep));
    else if (button.dataset.craft) { selected = button.dataset.craft; salePending = false; render(); }
    else if (button.dataset.action === 'sell') { salePending = true; render(); }
    else if (button.dataset.action === 'cancel-sale') { salePending = false; render(); }
    else if (button.dataset.action === 'confirm-sale' && salePending) { salePending = false; void purchase({ kind: 'sell-craft', id: selected }); }
    else if (button.dataset.upgrade) void purchase({ kind: 'upgrade', id: selected, upgrade: button.dataset.upgrade as UpgradeId });
    else if (button.dataset.action === 'focus') void purchase({ kind: 'focus' });
    else if (button.dataset.action === 'craft' || button.dataset.action === 'equip') void purchase({ kind: button.dataset.action, id: selected });
  }, options);
  root.addEventListener('keydown', event => {
    if (!(event.target as Element).closest('.shop-arrow') || busy || (event.code !== 'ArrowLeft' && event.code !== 'ArrowRight')) return;
    event.preventDefault(); step(event.code === 'ArrowLeft' ? -1 : 1);
  }, options);
  get('shop-back').addEventListener('click', onBack, options);
  get('shop-preview-reset').addEventListener('click', () => hangar.setView('reset'), options);
  const unsubscribe = store.subscribe(() => { if (!disposed) render(); }); render();
  return () => { disposed = true; unsubscribe(); controller.abort(); hangar.dispose(); root.replaceChildren(); };
}
