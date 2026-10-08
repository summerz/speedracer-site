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
  root.innerHTML = `<main class="shop-screen">
    ${menuHeader('shop', store.snapshot().balance)}
    <section class="shop-preview" aria-label="선택 기체 미리보기"><div id="shop-scene" class="scene"></div><div class="shop-preview-label"><strong id="shop-preview-name"></strong><span id="shop-preview-role"></span></div><em id="shop-preview-badge" class="shop-badge"></em><button id="shop-preview-reset" type="button">시점 초기화</button></section>
    <section class="shop-content"><nav class="shop-tabs" aria-label="상품 종류"><button type="button" data-tab="craft" aria-pressed="true">기체</button><button type="button" data-tab="upgrade" aria-pressed="false">강화</button><button type="button" data-tab="item" aria-pressed="false">아이템</button></nav>
    <p id="shop-message" class="shop-message" role="status" aria-live="polite"></p><div id="shop-products"></div></section></main>`;
  const get = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const controller = new AbortController(); const options = { signal: controller.signal };
  let selected = store.snapshot().equipped;
  let tab: 'craft' | 'upgrade' | 'item' = 'craft'; let busy = false; let disposed = false;
  const hangar = createHangar(get<HTMLDivElement>('shop-scene'), () => { get('shop-message').textContent = '3D 미리보기 연결이 끊겼습니다. 다시 불러와주세요.'; }, upgradedConfiguration(selected, store.snapshot().upgrades[selected]), true);
  let shown = '';
  let itemMode: 'competition' | 'time-attack' = store.snapshot().campaign.last?.mode ?? 'time-attack';
  let salePending = false;
  const insufficient = (cost: number, balance: number) => cost > balance ? `<small>${cost - balance}P 부족</small>` : '';
  const render = () => {
    const profile = store.snapshot(); const entry = DRONE_CATALOG.find(craft => craft.configuration.id === selected)!;
    const levels = profile.upgrades[selected] ?? emptyLevels();
    const config = upgradedConfiguration(selected, levels);
    const key = `${selected}:${JSON.stringify(levels)}`;
    if (shown !== key) { hangar.setDrone(config); shown = key; }
    get('shop-balance').textContent = `${profile.balance.toLocaleString()} P`;
    get('shop-preview-name').textContent = entry.name; get('shop-preview-role').textContent = entry.role;
    if (store.issue) get('shop-message').textContent = store.issue;
    root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.tab === tab)));
    const statusOf = (id: string) => profile.equipped === id ? '장착 중' : profile.owned.includes(id) ? '보유' : `${CRAFT_PRICES[id].toLocaleString()} P`;
    get('shop-preview-badge').textContent = statusOf(selected);
    get('shop-preview-badge').dataset.state = profile.equipped === selected ? 'equipped' : profile.owned.includes(selected) ? 'owned' : 'price';
    const picker = `<div class="shop-craft-list" role="group" aria-label="기체 목록">${DRONE_CATALOG.map(craft => `<button type="button" data-craft="${craft.configuration.id}" aria-pressed="${selected === craft.configuration.id}" style="--craft-color:${craft.lineColor}"><i aria-hidden="true"></i><strong>${craft.name}</strong><span class="${profile.owned.includes(craft.configuration.id) ? 'is-owned' : ''}">${statusOf(craft.configuration.id)}</span></button>`).join('')}</div>`;
    const pips = (level: number) => `<span class="pips" aria-label="${level}/3 단계">${[0, 1, 2].map(i => `<i class="${i < level ? 'on' : ''}"></i>`).join('')}</span>`;
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
      const sale = owned && selected !== STARTER_ID ? `<div class="shop-sale"><button type="button" class="sell-action" data-action="sell" ${busy ? 'disabled' : ''}>${craftResaleValue(selected).toLocaleString()} P · 판매</button><small class="shop-hint">구매가의 80% 반환 · 강화 비용 제외</small>${salePending ? `<div class="sale-confirm" role="group" aria-label="기체 판매 확인"><p>${entry.name}을 판매하고 ${craftResaleValue(selected).toLocaleString()} P를 받습니다. 적용된 강화도 삭제됩니다.${profile.equipped === selected ? ' 기본 기체로 자동 장착됩니다.' : ''}</p><div><button type="button" data-action="confirm-sale" class="sell-action" ${busy ? 'disabled' : ''}>판매 확정</button><button type="button" data-action="cancel-sale" ${busy ? 'disabled' : ''}>취소</button></div></div>` : ''}</div>` : '';
      get('shop-products').innerHTML = `${picker}<div class="shop-detail"><p class="eyebrow">${entry.role}</p><h2>${entry.name}</h2><p class="shop-desc">${entry.description}</p><div class="shop-action shop-buy"><div class="shop-buy-info"><span>${owned ? isEquipped ? '장착 중' : '보유 기체' : '가격'}</span>${owned ? '' : `<strong>${price.toLocaleString()} P</strong>`}${owned ? '' : insufficient(price, profile.balance)}</div><button type="button" class="primary-action" data-action="${owned ? 'equip' : 'craft'}" ${busy || owned && isEquipped || !owned && price > profile.balance ? 'disabled' : ''}>${owned ? isEquipped ? '장착 중' : '이 기체 장착' : `<span class="full">${price.toLocaleString()} P · 구매</span><span class="short">구매하기</span>`}</button></div><p class="shop-comparison-title">${isEquipped ? `${equippedName} · 장착 중인 성능` : `<i class="ghost-key"></i>${equippedName} 장착 성능 대비 <i class="cur-key" style="--craft-color:${entry.lineColor}"></i>${entry.name}`}</p><div class="shop-stats" style="--craft-color:${entry.lineColor}">${bars}</div><p class="stat-extra"><span>부스트 1 / 2</span><span class="mono">${side(boost(current.performance), boost(config.performance))} km/h</span><span>제동력</span><span class="mono">${side(current.performance.braking.toFixed(0), config.performance.braking.toFixed(0))} m/s²</span></p><p class="shop-hint">핸들링은 216km/h 기준 · 좌우 제동 시간과 충돌 감속은 낮을수록 유리합니다. 막대는 길수록 유리합니다.</p>${sale}</div>`;
    } else if (tab === 'upgrade') {
      get('shop-products').innerHTML = `${picker}<div class="shop-detail"><h2>${entry.name} 강화</h2><p class="shop-desc">구매한 기체에 영구 적용됩니다. 최대 3단계.</p>${profile.owned.includes(selected) ? UPGRADES.map(upgrade => {
        const level = levels[upgrade.id]; const cost = UPGRADE_COSTS[level];
        const after = level < 3 ? upgradedConfiguration(selected, { ...levels, [upgrade.id]: level + 1 }) : config;
        type Metric = { label: string; before: string; after: string; unit: string };
        const kmh = (v: number) => String(Math.round(v * 3.6));
        const metrics = (): Metric[] => { const a = config.performance, n = after.performance; const m = (label: string, x: string, y: string, unit: string) => ({ label, before: x, after: y, unit });
          return upgrade.id === 'engine' ? [m('최고 속도', kmh(a.topSpeed), kmh(n.topSpeed), 'km/h'), m('부스트 1/2', `${kmh(a.boostSpeed)}/${kmh(a.boostStage2Speed)}`, `${kmh(n.boostSpeed)}/${kmh(n.boostStage2Speed)}`, 'km/h'), m('가속', a.acceleration.toFixed(1), n.acceleration.toFixed(1), 'm/s²')]
            : upgrade.id === 'brakes' ? [m('제동력', a.braking.toFixed(1), n.braking.toFixed(1), 'm/s²')]
            : upgrade.id === 'steering' ? [m('좌우 핸들링', droneStats(config)[2].value, droneStats({ ...config, performance: n })[2].value, '°/s')]
            : upgrade.id === 'stabilizer' ? [m('좌우 제동', (Math.log(10) / a.lateralBraking).toFixed(2), (Math.log(10) / n.lateralBraking).toFixed(2), 's')]
            : [m('부스트 소모', (a.boostDrain * 100).toFixed(1), (n.boostDrain * 100).toFixed(1), '%/s'), m('부스트 회복', (a.boostRecovery * 100).toFixed(1), (n.boostRecovery * 100).toFixed(1), '%/s')]; };
        const rows = metrics().map(m => `<div class="metric"><span>${m.label}</span><span class="mono"><b>${m.before}</b>${level < 3 ? ` <i>→</i> <b class="next">${m.after}</b>` : ''} <small>${m.unit}</small></span></div>`).join('');
        const reason = level < 3 && cost > profile.balance ? insufficient(cost, profile.balance) : '';
        return `<article class="shop-upgrade"><div class="upgrade-info"><h3>${upgrade.name} ${pips(level)}<small>${level}/3</small></h3><p>${upgrade.description}${upgrade.id === 'stabilizer' ? ' · 입력 해제 후 잔류 방향 90% 감소 시간' : ''}</p><div class="metrics">${rows}</div></div><div class="shop-action"><button type="button" class="primary-action" data-upgrade="${upgrade.id}" ${busy || level === 3 || cost > profile.balance ? 'disabled' : ''}>${level === 3 ? '최대 단계' : `${cost} P · 강화`}</button>${reason}</div></article>`;
      }).join('') : '<p class="shop-hint">기체를 먼저 구매하면 강화할 수 있습니다.</p>'}</div>`;
    } else {
      const total = profile.focusSlots + profile.rivalSlots.length;
      const slotNames = [...Array<string>(profile.focusSlots).fill('집중 모드'), ...profile.rivalSlots.map(id => RIVAL_ITEMS.find(item => item.id === id)?.name ?? id)];
      const loadout = `<div class="loadout" aria-label="장착 슬롯 ${total}/2">${[0, 1].map(i => `<div class="loadout-slot ${slotNames[i] ? 'filled' : ''}"><i aria-hidden="true"></i><span>${slotNames[i] ?? '빈 슬롯'}</span></div>`).join('')}<b class="mono">${total}/2</b></div>`;
      const choices = (id: 'focus' | RivalItemId, stock: number, selectedCount: number) => `<fieldset class="shop-slots"><legend>다음 경기 장착</legend>${[0, 1, 2].map(count => `<button type="button" ${id === 'focus' ? `data-slots="${count}"` : `data-rival-slots="${count}" data-item="${id}"`} aria-pressed="${selectedCount === count}" ${busy || count > stock || total - selectedCount + count > 2 || id !== 'focus' && itemMode !== 'competition' ? 'disabled' : ''}>${count === 0 ? '사용 안 함' : `${count}개`}</button>`).join('')}</fieldset>`;
      get('shop-products').innerHTML = `<div class="shop-detail"><p class="eyebrow">RACE LOADOUT</p><h2>주행 아이템</h2>${loadout}<div class="shop-item-modes" role="group" aria-label="아이템 경기 모드"><button type="button" data-item-mode="time-attack" aria-pressed="${itemMode === 'time-attack'}" ${busy ? 'disabled' : ''}>타임어택</button><button type="button" data-item-mode="competition" aria-pressed="${itemMode === 'competition'}" ${busy ? 'disabled' : ''}>경쟁 레이스</button></div><article class="shop-upgrade shop-item"><div class="item-head"><h3>집중 모드</h3><span class="stock">보유 ${profile.focus}</span><div class="shop-action"><button type="button" data-action="focus" class="primary-action" ${busy || profile.balance < FOCUS_PRICE || profile.focus >= INVENTORY_LIMIT ? 'disabled' : ''}>${FOCUS_PRICE} P · 1개 구매</button>${profile.focus >= INVENTORY_LIMIT ? '<small>최대 보유</small>' : insufficient(FOCUS_PRICE, profile.balance)}</div></div><p>2초 동안 모든 기체의 주행을 45% 속도로 늦춥니다. 경기 시계는 정상적으로 흐릅니다. · 모든 모드</p>${choices('focus', profile.focus, profile.focusSlots)}</article>${RIVAL_ITEMS.map(item => {
        const stock = profile.rivalInventory[item.id]; const count = profile.rivalSlots.filter(id => id === item.id).length;
        return `<article class="shop-upgrade shop-item"><div class="item-head"><h3>${item.name}</h3><span class="stock">보유 ${stock}</span><div class="shop-action"><button type="button" class="primary-action" data-rival-buy="${item.id}" ${busy || itemMode !== 'competition' || stock >= INVENTORY_LIMIT || profile.balance < item.price ? 'disabled' : ''}>${item.price} P · 1개 구매</button>${itemMode !== 'competition' ? '<small>경쟁 레이스 전용</small>' : stock >= INVENTORY_LIMIT ? '<small>최대 보유</small>' : insufficient(item.price, profile.balance)}</div></div><p>${item.description} · 경쟁 레이스 전용</p>${choices(item.id, stock, count)}</article>`;
      }).join('')}<div class="shop-footnote"><p>합계 2개 장착 · 공통 재사용 대기 3초. 아이템 장착 경기는 보조 기록으로 분리하며 기본 보상은 80%, 기록 갱신 보너스는 없습니다. 사용하지 않은 수량은 남습니다.</p><p>타임어택에서는 상대 기체 대상 아이템이 출전에 포함되지 않습니다. 전파 교란은 앞쪽 180m 안에 대상이 없으면 소비하지 않습니다. V / 패드 LB로 사용 가능한 다음 아이템을 쓰거나 주행 버튼을 눌러 선택하세요.</p></div></div>`;
    }
    root.querySelector('.shop-screen')!.classList.toggle('has-buy-bar', tab === 'craft');
  };
  const purchase = async (command: ProgressCommand) => {
    if (busy) return; busy = true; render();
    try { await store.command(command); if (!disposed) get('shop-message').textContent = command.kind === 'craft' ? '구매했습니다. 장착 버튼으로 선택할 수 있습니다.' : command.kind === 'sell-craft' ? `${craftResaleValue(command.id).toLocaleString()} P를 돌려받았습니다.` : command.kind === 'equip' ? '기체를 장착했습니다.' : '저장했습니다.'; }
    catch (error) { if (!disposed) get('shop-message').textContent = error instanceof Error ? error.message : '저장하지 못했습니다.'; }
    finally { busy = false; if (!disposed) render(); }
  };
  root.addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button');
    if (!button || button.disabled || busy) return;
    if (button.dataset.itemMode) { itemMode = button.dataset.itemMode as typeof itemMode; render(); }
    else if (button.dataset.rivalBuy) void purchase({ kind: 'rival-buy', item: button.dataset.rivalBuy as RivalItemId, mode: itemMode });
    else if (button.dataset.rivalSlots) { const item = button.dataset.item as RivalItemId; const slots = [...store.snapshot().rivalSlots.filter(id => id !== item), ...Array<RivalItemId>(Number(button.dataset.rivalSlots)).fill(item)]; void purchase({ kind: 'rival-slots', slots, mode: itemMode }); }
    else if (button.dataset.tab) { tab = button.dataset.tab as typeof tab; salePending = false; render(); }
    else if (button.dataset.craft) { selected = button.dataset.craft; salePending = false; render(); }
    else if (button.dataset.action === 'sell') { salePending = true; render(); }
    else if (button.dataset.action === 'cancel-sale') { salePending = false; render(); }
    else if (button.dataset.action === 'confirm-sale' && salePending) { salePending = false; void purchase({ kind: 'sell-craft', id: selected }); }
    else if (button.dataset.upgrade) void purchase({ kind: 'upgrade', id: selected, upgrade: button.dataset.upgrade as UpgradeId });
    else if (button.dataset.slots) void purchase({ kind: 'slots', count: Number(button.dataset.slots) });
    else if (button.dataset.action === 'focus') void purchase({ kind: 'focus' });
    else if (button.dataset.action === 'craft' || button.dataset.action === 'equip') void purchase({ kind: button.dataset.action, id: selected });
  }, options);
  get('shop-back').addEventListener('click', onBack, options);
  get('shop-preview-reset').addEventListener('click', () => hangar.setView('reset'), options);
  const unsubscribe = store.subscribe(() => { if (!disposed) render(); }); render();
  return () => { disposed = true; unsubscribe(); controller.abort(); hangar.dispose(); root.replaceChildren(); };
}
