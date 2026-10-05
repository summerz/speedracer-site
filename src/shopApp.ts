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
    <section class="shop-preview" aria-label="선택 기체 미리보기"><div id="shop-scene" class="scene"></div><div class="shop-preview-label"><strong id="shop-preview-name"></strong><span id="shop-preview-role"></span></div><button id="shop-preview-reset" type="button">시점 초기화</button></section>
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
    const picker = `<div class="shop-craft-list" role="group" aria-label="기체 목록">${DRONE_CATALOG.map(craft => `<button type="button" data-craft="${craft.configuration.id}" aria-pressed="${selected === craft.configuration.id}" style="--craft-color:${craft.lineColor}"><i aria-hidden="true"></i><strong>${craft.name}</strong><span>${profile.equipped === craft.configuration.id ? '장착 중' : profile.owned.includes(craft.configuration.id) ? '보유' : `${CRAFT_PRICES[craft.configuration.id].toLocaleString()} P`}</span></button>`).join('')}</div>`;
    if (tab === 'craft') {
      const owned = profile.owned.includes(selected); const price = CRAFT_PRICES[selected];
      const current = upgradedConfiguration(profile.equipped, profile.upgrades[profile.equipped]);
      const currentStats = droneStats(current);
      get('shop-products').innerHTML = `${picker}<div class="shop-detail"><p class="eyebrow">${entry.role}</p><h2>${entry.name}</h2><p>${entry.description}</p><p class="shop-comparison-title">${DRONE_CATALOG.find(c => c.configuration.id === profile.equipped)!.name} 장착 성능 → 선택 기체</p><dl class="shop-stats">${droneStats(config).map((stat, i) => `<div><dt>${stat.label}</dt><dd><span>${currentStats[i].value}</span><b aria-hidden="true">→</b><strong>${stat.value}</strong> <small>${stat.unit}</small></dd></div>`).join('')}<div><dt>부스트 1 / 2</dt><dd><span>${Math.round(current.performance.boostSpeed*3.6)} / ${Math.round(current.performance.boostStage2Speed*3.6)}</span><b>→</b><strong>${Math.round(config.performance.boostSpeed*3.6)} / ${Math.round(config.performance.boostStage2Speed*3.6)}</strong> <small>km/h</small></dd></div><div><dt>제동력</dt><dd><span>${current.performance.braking.toFixed(0)}</span><b>→</b><strong>${config.performance.braking.toFixed(0)}</strong> <small>m/s²</small></dd></div></dl><p class="shop-hint">핸들링은 216km/h 기준 · 충돌 감속은 낮을수록 유리합니다.</p><div class="shop-action"><button type="button" class="primary-action" data-action="${owned ? 'equip' : 'craft'}" ${busy || owned && profile.equipped === selected || !owned && price > profile.balance ? 'disabled' : ''}>${owned ? profile.equipped === selected ? '장착 중' : '이 기체 장착' : `${price.toLocaleString()} P · 구매`}</button>${owned ? '' : insufficient(price, profile.balance)}${owned && selected !== STARTER_ID ? `<button type="button" class="sell-action" data-action="sell" ${busy ? 'disabled' : ''}>${craftResaleValue(selected).toLocaleString()} P · 판매</button><small class="shop-hint">구매가의 80% 반환 · 강화 비용 제외</small>${salePending ? `<div class="sale-confirm" role="group" aria-label="기체 판매 확인"><p>${entry.name}을 판매하고 ${craftResaleValue(selected).toLocaleString()} P를 받습니다. 적용된 강화도 삭제됩니다.${profile.equipped === selected ? ' 기본 기체로 자동 장착됩니다.' : ''}</p><div><button type="button" data-action="confirm-sale" class="sell-action" ${busy ? 'disabled' : ''}>판매 확정</button><button type="button" data-action="cancel-sale" ${busy ? 'disabled' : ''}>취소</button></div></div>` : ''}` : ''}</div></div>`;
    } else if (tab === 'upgrade') {
      get('shop-products').innerHTML = `${picker}<div class="shop-detail"><h2>${entry.name} 강화</h2><p>구매한 기체에 영구 적용됩니다. 최대 3단계.</p>${profile.owned.includes(selected) ? UPGRADES.map(upgrade => {
        const level = levels[upgrade.id]; const cost = UPGRADE_COSTS[level];
        const after = level < 3 ? upgradedConfiguration(selected, { ...levels, [upgrade.id]: level + 1 }) : config;
        const value = (p: typeof config.performance) => upgrade.id === 'engine' ? `${Math.round(p.topSpeed * 3.6)} km/h · 부스트 ${Math.round(p.boostSpeed*3.6)}/${Math.round(p.boostStage2Speed*3.6)} · 가속 ${p.acceleration.toFixed(1)}` : upgrade.id === 'brakes' ? `${p.braking.toFixed(1)} m/s²` : upgrade.id === 'steering' ? `${droneStats({ ...config, performance: p })[2].value} °/s` : `소모 ${(p.boostDrain * 100).toFixed(1)}%/s · 회복 ${(p.boostRecovery * 100).toFixed(1)}%/s`;
        return `<article class="shop-upgrade"><div><h3>${upgrade.name} <small>${level}/3</small></h3><p>${upgrade.description}</p><p class="mono">${value(config.performance)}${level < 3 ? ` → ${value(after.performance)}` : ''}</p></div><div class="shop-action"><button type="button" class="primary-action" data-upgrade="${upgrade.id}" ${busy || level === 3 || cost > profile.balance ? 'disabled' : ''}>${level === 3 ? '최대 단계' : `${cost} P · 강화`}</button>${level < 3 ? insufficient(cost, profile.balance) : ''}</div></article>`;
      }).join('') : '<p class="shop-hint">기체를 먼저 구매하면 강화할 수 있습니다.</p>'}</div>`;
    } else {
      const total = profile.focusSlots + profile.rivalSlots.length;
      const choices = (id: 'focus' | RivalItemId, stock: number, selectedCount: number) => `<fieldset class="shop-slots"><legend>다음 경기 장착</legend>${[0, 1, 2].map(count => `<button type="button" ${id === 'focus' ? `data-slots="${count}"` : `data-rival-slots="${count}" data-item="${id}"`} aria-pressed="${selectedCount === count}" ${busy || count > stock || total - selectedCount + count > 2 || id !== 'focus' && itemMode !== 'competition' ? 'disabled' : ''}>${count === 0 ? '사용 안 함' : `${count}개`}</button>`).join('')}</fieldset>`;
      get('shop-products').innerHTML = `<div class="shop-detail"><p class="eyebrow">RACE LOADOUT · ${total}/2</p><h2>주행 아이템</h2><div class="shop-item-modes" role="group" aria-label="아이템 경기 모드"><button type="button" data-item-mode="time-attack" aria-pressed="${itemMode === 'time-attack'}" ${busy ? 'disabled' : ''}>타임어택</button><button type="button" data-item-mode="competition" aria-pressed="${itemMode === 'competition'}" ${busy ? 'disabled' : ''}>AI 레이스</button></div><p class="shop-hint">합계 2개 장착 · 공통 재사용 대기 3초. 아이템 장착 경기는 보조 기록으로 분리하며 기본 보상은 80%, 기록 갱신 보너스는 없습니다. 사용하지 않은 수량은 남습니다.</p><article class="shop-upgrade"><div><h3>집중 모드</h3><p>2초 동안 모든 기체의 주행을 45% 속도로 늦춥니다. 경기 시계는 정상적으로 흐릅니다.</p><p>보유 <strong>${profile.focus}개</strong> · 모든 모드</p></div><div class="shop-action"><button type="button" data-action="focus" class="primary-action" ${busy || profile.balance < FOCUS_PRICE || profile.focus >= INVENTORY_LIMIT ? 'disabled' : ''}>${FOCUS_PRICE} P · 1개 구매</button>${insufficient(FOCUS_PRICE, profile.balance)}</div>${choices('focus', profile.focus, profile.focusSlots)}</article>${RIVAL_ITEMS.map(item => {
        const stock = profile.rivalInventory[item.id]; const count = profile.rivalSlots.filter(id => id === item.id).length;
        return `<article class="shop-upgrade"><div><h3>${item.name}</h3><p>${item.description}</p><p>보유 <strong>${stock}개</strong> · AI 레이스 전용</p></div><div class="shop-action"><button type="button" class="primary-action" data-rival-buy="${item.id}" ${busy || itemMode !== 'competition' || stock >= INVENTORY_LIMIT || profile.balance < item.price ? 'disabled' : ''}>${item.price} P · 1개 구매</button>${insufficient(item.price, profile.balance)}</div>${choices(item.id, stock, count)}</article>`;
      }).join('')}<p class="shop-hint">타임어택에서는 AI 전용 아이템이 출전에 포함되지 않습니다. 전파 교란은 앞쪽 180m 안에 대상이 없으면 소비하지 않습니다. V / 패드 LB로 사용 가능한 다음 아이템을 쓰거나 주행 버튼을 눌러 선택하세요.</p></div>`;
    }
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
