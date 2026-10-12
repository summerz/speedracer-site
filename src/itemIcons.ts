/** Inline 24px item icons; currentColor so each screen can tint them. */
export const SUPPORT_MISSILE_ICON = '<svg class="item-icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><circle cx="16.5" cy="7.5" r="5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="3 1.6"/><circle cx="16.5" cy="7.5" r="1.1" fill="currentColor"/><path d="M3 21l1.6-4.6 6-6 2.3 2.3-6 6z" fill="currentColor" opacity=".9"/><path d="M5 15.5L2.5 14l2-.5M8.5 19l1.5 2.5.5-2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M12 11l2.2-2.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
const glyph = (paths: string) => `<svg class="item-icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
const SPEED_ICON = glyph('<path d="M3 16a9 9 0 1 1 18 0M12 16l5-7M5 16h2M17 16h2"/><circle cx="12" cy="16" r="1.5"/>');
const BOOST_ICON = glyph('<path d="M14 2L5 13h6l-1 9 9-13h-6z"/>');
const HEAD_START_ICON = glyph('<path d="M4 21V3h13l-2 4 2 4H4M10 17h10m-3-3 3 3-3 3"/>');
const FOCUS_ICON = glyph('<path d="M4 8V4h4m8 0h4v4m0 8v4h-4M8 20H4v-4"/><circle cx="12" cy="12" r="4"/>');
const STOP_ICON = glyph('<circle cx="12" cy="12" r="9"/><path d="M9 8v8m6-8v8"/>');
const INTERFERENCE_ICON = glyph('<circle cx="12" cy="12" r="2"/><path d="M7 7a7 7 0 0 0 0 10m10-10a7 7 0 0 1 0 10M4 4a11 11 0 0 0 0 16M20 4a11 11 0 0 1 0 16"/>');
export const itemIcon = (id: string): string => id.startsWith('speed-') ? SPEED_ICON : id.startsWith('boost-') ? BOOST_ICON
  : id === 'head-start' ? HEAD_START_ICON : id === 'focus' ? FOCUS_ICON : id === 'time-stop' ? STOP_ICON
  : id === 'interference' ? INTERFERENCE_ICON : id === 'support-missile' ? SUPPORT_MISSILE_ICON : '';
