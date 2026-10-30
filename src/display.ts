/**
 * Whether the site runs as an app opened from the Home Screen (or installed), not in a browser tab:
 * the display mode the manifest asks for, or Safari's own flag on iPhone and iPad (which versions
 * before the manifest's display mode report instead).
 */
export function isStandalone(): boolean {
  return matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * Marks the page `html[data-display="standalone"]` or `"browser"` (styles.css sizes the auditorium to
 * the screen in an app window).
 */
export function applyDisplayMode(): void {
  document.documentElement.dataset.display = isStandalone() ? 'standalone' : 'browser';
}
