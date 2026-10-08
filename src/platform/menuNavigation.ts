import { createPadReader, gamepadDriving } from './gamepadInput';
import type { PadAction } from './gamepadInput';
import './menuNavigation.css';

export function mountMenuNavigation(root: HTMLElement): () => void {
  const events = new AbortController(), reader = createPadReader();
  let frame = 0, padIndex: number | undefined, suspended = false;
  const options = { signal: events.signal };
  const scope = () => root.querySelector<HTMLElement>('dialog[open]') ?? root;
  const inGame = () => !root.querySelector('dialog[open]') && ['running','countdown'].includes(root.querySelector<HTMLElement>('.drive-screen')?.dataset.phase ?? '');
  const editable = (element: Element | null) => !!element?.closest('textarea,select,input:not([type=radio]):not([type=checkbox]):not([type=button]),[contenteditable]:not([contenteditable=false])');
  const candidates = () => Array.from(scope().querySelectorAll<HTMLElement>('button,a[href],summary,select,input[type=range],input[type=radio],input[type=checkbox]')).filter(element =>
    !element.matches(':disabled,[aria-disabled=true]') && !element.closest('[hidden],[inert]') && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
  const select = () => { const active = document.activeElement; if (active instanceof HTMLElement && candidates().includes(active)) active.click(); };
  const move = (action: PadAction) => {
    const items = candidates(); if (!items.length) return;
    const active = document.activeElement as HTMLElement;
    if (!items.includes(active)) { (items.find(item => item.matches('.primary-action')) ?? items[0]).focus(); return; }
    const origin = active.getBoundingClientRect(), ox = origin.x + origin.width/2, oy = origin.y + origin.height/2;
    const horizontal = action === 'left' || action === 'right', sign = action === 'left' || action === 'up' ? -1 : 1;
    const positioned = items.filter(item => item !== active).map(item => {
      const r = item.getBoundingClientRect(), dx = r.x+r.width/2-ox, dy = r.y+r.height/2-oy;
      const ahead = sign*(horizontal ? dx : dy), across = Math.abs(horizontal ? dy : dx);
      return { item, ahead, score: ahead + across*2.5 };
    }).filter(p => p.ahead > 2).sort((a,b) => a.score-b.score);
    const fallback = items[(items.indexOf(active)+sign+items.length)%items.length];
    (positioned[0]?.item ?? fallback).focus();
  };
  const back = () => {
    const dialog = root.querySelector<HTMLDialogElement>('dialog[open]'); if (dialog) { dialog.close(); return; }
    const request = new CustomEvent('speedracer:menu-back', { cancelable: true });
    if (!window.dispatchEvent(request) || root.querySelector('.drive-screen')) return;
    if (location.hash) location.hash = '';
  };
  window.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || inGame() || editable(event.target instanceof Element ? event.target : null)) return;
    if ((event.code === 'ArrowLeft' || event.code === 'ArrowRight') && event.target instanceof Element && event.target.closest('[data-own-horizontal-keys]')) return;
    const action = ({ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right'} as const)[event.code as 'ArrowUp'];
    if (event.code === 'Escape') { event.preventDefault(); if (!event.repeat) back(); }
    else if (action) { event.preventDefault(); move(action); }
    else if (event.code === 'Enter' && candidates().includes(document.activeElement as HTMLElement)) { event.preventDefault(); if (!event.repeat) select(); }
  }, { ...options, capture: true });
  const clear = () => { suspended = true; Object.assign(gamepadDriving, { connected:false, steer:0, brake:false, boost:false }); };
  window.addEventListener('blur', clear, options);
  window.addEventListener('focus', () => { suspended = false; }, options);
  document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); else suspended = false; }, options);
  const tick = (now: number) => {
    const pads = !suspended && !document.hidden ? Array.from(navigator.getGamepads?.() ?? []).filter((pad): pad is Gamepad => !!pad && pad.connected && pad.mapping === 'standard') : [];
    const pad = pads.find(p => p.index === padIndex) ?? pads[0] ?? null; padIndex = pad?.index;
    const driving = inGame(), result = reader.read(pad, now, driving);
    Object.assign(gamepadDriving, result.snapshot);
    root.dataset.gamepad = result.snapshot.connected ? 'connected' : 'disconnected';
    for (const action of result.actions) {
      if (action === 'pause' || (driving && ['cockpit','track','focus','up','down'].includes(action))) window.dispatchEvent(new CustomEvent('speedracer:pad-action', { detail: action }));
      else if (!driving) {
        const active = document.activeElement;
        const sign = action === 'left' ? -1 : action === 'right' ? 1 : 0;
        if (sign && active instanceof HTMLSelectElement) {
          active.selectedIndex = Math.max(0, Math.min(active.options.length-1, active.selectedIndex + sign));
          active.dispatchEvent(new Event('change', { bubbles:true }));
        } else if (sign && active instanceof HTMLInputElement && active.type === 'range') {
          if (sign > 0) active.stepUp(); else active.stepDown();
          active.dispatchEvent(new Event('input', { bubbles:true })); active.dispatchEvent(new Event('change', { bubbles:true }));
        } else if (['up','down','left','right'].includes(action)) move(action);
        else if (action === 'confirm') { if (!candidates().includes(document.activeElement as HTMLElement)) move('down'); else select(); }
        else if (action === 'back') back();
      }
    }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => { events.abort(); cancelAnimationFrame(frame); clear(); delete root.dataset.gamepad; };
}
