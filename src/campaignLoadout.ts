import { RIVAL_ITEMS, type RivalItemId } from './game/progression/catalog';
import type { ProgressStore } from './game/progression/progressStore';
import type { RaceMode } from './game/driving/createRaceSession';

const FOCUS_DESCRIPTION = '2초 동안 모든 기체의 주행을 45% 속도로 늦춥니다. 경기 시계는 정상적으로 흐릅니다. · 모든 모드';

/** Loadout summary row (inside the detail action bar) + the item dialog. */
export const loadoutMarkup = () => `<div class="loadout" id="campaign-loadout"><div class="loadout-row"><span class="loadout-label">아이템 <b class="mono" id="loadout-count">0/2</b></span><span class="loadout-slots" id="loadout-slots"></span><button type="button" id="loadout-open" class="loadout-change">변경</button></div><p id="loadout-rule" class="loadout-rule" hidden>아이템 장착 경기는 보조 기록 · 기본 보상 80%</p></div><dialog id="loadout-dialog" class="loadout-dialog" aria-labelledby="loadout-title"></dialog>`;

export function mountLoadout(root: HTMLElement, store: ProgressStore, getMode: () => RaceMode, signal: AbortSignal, warn: (message: string) => void) {
  const get = (id: string) => root.querySelector<HTMLElement>(`#${id}`)!;
  const dialog = get('loadout-dialog') as HTMLDialogElement;
  let busy = false;
  const equipped = () => {
    const profile = store.snapshot(), competition = getMode() === 'competition';
    return [...Array<string>(profile.focusSlots).fill('집중 모드'), ...(competition ? profile.rivalSlots.map(id => RIVAL_ITEMS.find(item => item.id === id)?.name ?? id) : [])];
  };
  const paintDialog = () => {
    const profile = store.snapshot(), competition = getMode() === 'competition';
    const total = profile.focusSlots + profile.rivalSlots.length;
    const entries = [{ id: 'focus', name: '집중 모드', description: FOCUS_DESCRIPTION, stock: profile.focus, count: profile.focusSlots },
      ...(competition ? RIVAL_ITEMS.map(item => ({ id: item.id as string, name: item.name, description: `${item.description} · 경쟁 레이스 전용`, stock: profile.rivalInventory[item.id], count: profile.rivalSlots.filter(id => id === item.id).length })) : [])];
    const noStock = entries.every(entry => entry.stock === 0);
    const blocked = !competition && profile.rivalSlots.length > 0 ? `<p class="loadout-note">경쟁 레이스용 아이템 ${profile.rivalSlots.length}개가 슬롯을 차지하고 있습니다. 경쟁 레이스에서 변경할 수 있습니다.</p>` : '';
    const focusKey = dialog.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.opt : undefined;
    dialog.innerHTML = `<p class="eyebrow">NEXT RACE</p><h2 id="loadout-title">출전 아이템 <span class="mono">${equipped().length}/2</span></h2>
      ${entries.map(entry => `<fieldset class="loadout-item"><legend><strong>${entry.name}</strong><span class="mono">보유 ${entry.stock}</span></legend><p>${entry.description}</p><div class="loadout-seg" role="group" aria-label="${entry.name} 장착 수량">${[0, 1, 2].map(count => `<button type="button" data-opt="${entry.id}:${count}" data-item="${entry.id}" data-count="${count}" aria-pressed="${entry.count === count}" ${busy || count > entry.stock || total - entry.count + count > 2 ? 'disabled' : ''}>${count === 0 ? '사용 안 함' : `${count}개`}</button>`).join('')}</div></fieldset>`).join('')}
      ${competition ? '' : '<p class="loadout-note">경쟁 레이스 전용 아이템은 이 모드에서 사용되지 않습니다</p>'}${blocked}
      ${noStock ? '<a class="loadout-shop" href="#shop">상점에서 구매 ↗</a>' : ''}
      <p class="loadout-note">아이템 장착 경기는 보조 기록 · 기본 보상 80%</p><p class="progress-warning" role="status">${store.issue}</p>
      <form method="dialog"><button class="loadout-close" ${busy ? 'disabled' : ''}>닫기</button></form>`;
    if (focusKey) dialog.querySelector<HTMLElement>(`[data-opt="${focusKey}"]:not(:disabled)`)?.focus({ preventScroll: true });
  };
  const paint = () => {
    const names = equipped();
    get('loadout-count').textContent = `${names.length}/2`;
    get('loadout-slots').innerHTML = [0, 1].map(i => `<span class="loadout-slot" data-filled="${i < names.length}">${names[i] ?? '비어 있음'}</span>`).join('');
    get('loadout-rule').hidden = names.length === 0;
    (get('loadout-open') as HTMLButtonElement).disabled = busy;
    if (dialog.open) paintDialog();
  };
  const apply = async (id: string, count: number) => {
    const profile = store.snapshot(); busy = true; paint();
    try {
      if (id === 'focus') await store.command({ kind: 'slots', count });
      else await store.command({ kind: 'rival-slots', slots: [...profile.rivalSlots.filter(slot => slot !== id), ...Array<RivalItemId>(count).fill(id as RivalItemId)], mode: 'competition' });
    } catch { warn(store.issue); }
    busy = false; paint();
  };
  get('loadout-open').addEventListener('click', () => { paintDialog(); dialog.showModal(); }, { signal });
  dialog.addEventListener('click', event => {
    if (event.target === dialog) { dialog.close(); return; }
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-item]');
    if (button && !button.disabled) void apply(button.dataset.item!, Number(button.dataset.count));
  }, { signal });
  dialog.addEventListener('close', () => get('loadout-open').focus({ preventScroll: true }), { signal });
  signal.addEventListener('abort', () => { if (dialog.open) dialog.close(); });
  return { paint };
}
