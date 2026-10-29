/**
 * "Giảm hiệu ứng kính": solid panes instead of glass (src/tokens.css reads `html[data-glass]`). The
 * system's "reduce transparency" setting does the same through a media query; this choice is for
 * browsers without it, or for anyone who simply reads better on solid panes. Kept for the whole site.
 */
const STORAGE_KEY = 'tp-glass';

export function loadReducedGlass(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'reduced';
  } catch {
    // No storage: glass, as by default.
    return false;
  }
}

export function setReducedGlass(reduced: boolean): void {
  if (reduced) document.documentElement.dataset.glass = 'reduced';
  else delete document.documentElement.dataset.glass;
  try {
    if (reduced) localStorage.setItem(STORAGE_KEY, 'reduced');
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Not remembered: it still applies until the tab is closed.
  }
}

/** Applies the stored choice (at start-up, before the first page is drawn). */
export function applyStoredGlass(): void {
  if (loadReducedGlass()) document.documentElement.dataset.glass = 'reduced';
}
