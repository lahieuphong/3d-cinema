/** The site's pages. */
export type RouteKind = 'landing' | 'cinema' | 'inspector' | 'not-found';

export const CINEMA_PATH = '/cinema';

/**
 * Which page a URL shows:
 * - `/` → landing page
 * - `/cinema` (with or without a trailing slash) → auditorium
 * - `/cinema?inspect=seat` → development seat inspector
 * - anything else → not found
 */
export function matchRoute(pathname: string, search: string): RouteKind {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return 'landing';
  if (path === CINEMA_PATH) return new URLSearchParams(search).get('inspect') === 'seat' ? 'inspector' : 'cinema';
  return 'not-found';
}

/**
 * A click the page may take over for in-app navigation: main button, no modifier key (Ctrl, ⌘,
 * Shift, Alt open new tabs or windows, or download), not already handled, not to another window.
 */
export function isPlainClick(event: Pick<MouseEvent, 'button' | 'defaultPrevented' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>, target = ''): boolean {
  return event.button === 0 && !event.defaultPrevented && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && (target === '' || target === '_self');
}
