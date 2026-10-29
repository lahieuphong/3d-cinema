import './tokens.css';
import './site.css';
import { BRAND, markImg, PAGE_TITLES } from './brand.ts';
import type { CinemaSession } from './cinema/page.ts';
import { applyStoredGlass } from './glass.ts';
import { mountLandingPage } from './landing/landing.ts';
import { createLoader, savesData } from './landing/loader.ts';
import { CINEMA_PATH, isPlainClick, matchRoute, type RouteKind } from './router.ts';
import { cinemaPageSkeleton } from './skeleton.ts';

const host = document.querySelector<HTMLElement>('#app');
if (!host) throw new Error('Missing #app element.');
const app = host;
// "Giảm hiệu ứng kính", chosen on an earlier visit (the HTML shells already set it before painting).
applyStoredGlass();

// The auditorium comes in two downloads: its page (tasks, seat map, player) and its 3D part
// (three.js, the room). Neither is fetched by the landing page on its own: only when the visitor
// heads for /cinema, or shows they are about to (hover, focus or press on "Bước vào rạp"). Fetching
// code builds nothing: no renderer or scene exists until the page mounts.
const cinemaPage = createLoader(() => import('./cinema/page.ts'));
const cinemaScene = createLoader(() => import('./cinema/view.ts'));
const seatInspector = createLoader(() => import('./cinema/seatInspector.ts'));

let unmount: (() => void) | undefined;
let mounted: RouteKind | null = null;
// Seat selection, the film's place and the task live for the whole visit: landing ↔ auditorium ↔
// inspector. Created with the auditorium's first mount.
let session: CinemaSession | null = null;
// Bumped on every render, so a slow download cannot mount over a newer page (Back pressed meanwhile).
let generation = 0;

const DESCRIPTIONS: Record<RouteKind, string> = {
  landing: BRAND.description,
  cinema: BRAND.cinemaDescription,
  inspector: BRAND.cinemaDescription,
  'not-found': BRAND.description,
};

/**
 * Shows the page for the current URL, unmounting the previous one first (at most one renderer at
 * a time). `moveFocus` after in-app navigation: focus goes to the new page's main heading.
 */
async function render({ moveFocus = false, force = false } = {}): Promise<void> {
  const kind = matchRoute(location.pathname, location.search);
  // Links inside the landing page (#cach-su-dung) change the history too: same page, nothing to do.
  if (kind === mounted && !force) return;
  const current = ++generation;
  unmount?.();
  unmount = undefined;
  mounted = kind;
  document.documentElement.dataset.route = kind;
  document.querySelector('meta[name="description"]')?.setAttribute('content', DESCRIPTIONS[kind]);

  if (kind === 'landing') {
    document.title = PAGE_TITLES.landing;
    unmount = mountLandingPage(app, { enterCinema: () => navigate(CINEMA_PATH), preloadCinema });
    if (moveFocus) app.querySelector<HTMLElement>('#noi-dung')?.focus({ preventScroll: true });
    return;
  }
  if (kind === 'not-found') {
    renderNotFound();
    if (moveFocus) app.querySelector('h1')?.focus();
    return;
  }

  // The auditorium or the inspector: their code may still be on its way.
  const inspector = kind === 'inspector';
  if (!inspector) cinemaScene.preload();
  if ((inspector ? seatInspector : cinemaPage).state !== 'loaded') showOpening(current);
  try {
    if (inspector) {
      const { mountSeatInspector } = await seatInspector.get();
      if (current !== generation) return;
      unmount = mountSeatInspector(app, { onClose: () => navigate(CINEMA_PATH) });
    } else {
      const { createCinemaSession, mountCinemaPage } = await cinemaPage.get();
      if (current !== generation) return;
      session ??= createCinemaSession();
      unmount = mountCinemaPage(app, {
        openInspector: () => navigate(`${CINEMA_PATH}?inspect=seat`),
        goHome: () => navigate('/'),
        session,
      });
    }
  } catch (error) {
    if (current !== generation) return;
    console.error('[cinema] Could not load the page:', error);
    showOpening(current, true);
    return;
  }
  window.scrollTo(0, 0);
  if (moveFocus) app.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
}

/** The visitor shows they are about to enter: fetch the code (not with Save-Data on). */
function preloadCinema(): void {
  if (savesData()) return;
  cinemaPage.preload();
  cinemaScene.preload();
}

function navigate(url: string): void {
  if (`${location.pathname}${location.search}` === url) return;
  history.pushState(null, '', url);
  void render({ moveFocus: true });
}

/**
 * While the auditorium's code downloads: the page that is coming as a skeleton, with what is
 * happening and a way back on its screen. After a failure: what went wrong, "Thử lại" and the way back.
 */
function showOpening(current: number, failed = false): void {
  const page = document.createElement('main');
  page.className = 'route-status';
  page.dataset.state = failed ? 'error' : 'loading';
  const text = document.createElement('div');
  text.className = 'route-status__text';
  text.setAttribute('role', failed ? 'alert' : 'status');
  text.innerHTML = failed
    ? '<h1 tabindex="-1">Không mở được phòng chiếu</h1><p class="route-status__message">Phần mã của phòng chiếu chưa tải được. Kiểm tra kết nối mạng rồi thử lại.</p>'
    : '<h1 tabindex="-1" class="shimmer-text">Đang mở phòng chiếu…</h1>';
  const actions = document.createElement('div');
  actions.className = 'route-status__actions';
  if (failed) {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'button button--primary';
    retry.dataset.action = 'retry-page';
    retry.textContent = 'Thử lại';
    retry.addEventListener('click', () => current === generation && void render({ force: true, moveFocus: true }));
    actions.append(retry);
  }
  const home = document.createElement('a');
  home.className = 'button button--ghost';
  home.href = '/';
  home.textContent = 'Về trang chủ';
  home.addEventListener('click', (event) => {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    navigate('/');
  });
  actions.append(home);
  if (failed) {
    page.insertAdjacentHTML('afterbegin', markImg(56));
    page.append(text, actions);
  } else {
    page.innerHTML = cinemaPageSkeleton();
    page.querySelector('.room-skeleton__screen')!.append(text, actions);
  }
  app.replaceChildren(page);
  if (failed) page.querySelector<HTMLElement>('h1')?.focus();
}

function renderNotFound(): void {
  document.title = PAGE_TITLES.notFound;
  const page = document.createElement('main');
  page.className = 'not-found';
  page.innerHTML = `${markImg(56)}<h1 tabindex="-1">Không tìm thấy trang</h1><p class="route-status__message">Địa chỉ này không có trong ${BRAND.name}.</p>`;
  const links = document.createElement('div');
  links.className = 'not-found__links';
  for (const [href, label, kind] of [
    ['/', 'Về trang chủ', 'ghost'],
    [CINEMA_PATH, 'Mở phòng chiếu 3D', 'primary'],
  ]) {
    const link = document.createElement('a');
    link.className = `button button--${kind}`;
    link.href = href;
    link.textContent = label;
    links.append(link);
  }
  page.append(links);
  app.replaceChildren(page);
}

const onPopState = () => void render({ moveFocus: true });
window.addEventListener('popstate', onPopState);
void render();

if (import.meta.hot) {
  // Re-mount on hot update instead of reloading; the old canvas, controls and listeners are disposed first.
  import.meta.hot.dispose(() => {
    generation++;
    window.removeEventListener('popstate', onPopState);
    unmount?.();
  });
  import.meta.hot.accept();
}
