import type { DroneCatalogEntry } from './game/drone/droneCatalog';
import './craftCards.css';

export type CraftTone = 'price' | 'owned' | 'equipped' | 'warn';
export interface CraftCardsOptions {
  entries: readonly DroneCatalogEntry[];
  selectedId: string;
  /** Data attribute carrying the craft id, e.g. `data-craft`. */
  attr: string;
  status: (entry: DroneCatalogEntry) => { label: string; tone: CraftTone };
  label: string;
}

/** Horizontal set of craft thumbnail cards: scroll-snap row on phones, one filled row on desktop. */
export function craftCards({ entries, selectedId, attr, status, label }: CraftCardsOptions): string {
  return `<div class="craft-cards" role="group" aria-label="${label}">${entries.map(entry => {
    const id = entry.configuration.id; const { label: text, tone } = status(entry);
    return `<button type="button" class="craft-card" ${attr}="${id}" aria-pressed="${id === selectedId}" data-tone="${tone}" style="--craft-color:${entry.lineColor}"><img src="/craft-previews/${entry.configuration.modelVariant}.png" alt="" width="120" height="60" loading="lazy" decoding="async"><strong class="craft-card-name">${entry.name}</strong><span class="craft-card-status">${text}</span></button>`;
  }).join('')}</div>`;
}

/** Keep the selected card inside a horizontally scrolling row. */
export function revealSelectedCard(container: HTMLElement, scrollLeft = 0) {
  const row = container.querySelector<HTMLElement>('.craft-cards'); if (!row) return;
  row.scrollLeft = scrollLeft;
  const card = row.querySelector<HTMLElement>('[aria-pressed=true]'); if (!card || row.scrollWidth <= row.clientWidth) return;
  if (card.offsetLeft < row.scrollLeft + row.offsetLeft) row.scrollLeft = card.offsetLeft - row.offsetLeft - 8;
  else if (card.offsetLeft + card.offsetWidth > row.scrollLeft + row.offsetLeft + row.clientWidth) row.scrollLeft = card.offsetLeft + card.offsetWidth - row.offsetLeft - row.clientWidth + 8;
}
