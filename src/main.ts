import './styles.css';
import { mountCinemaPage } from './cinema/page.ts';

const CINEMA_PATH = '/cinema';

const host = document.querySelector<HTMLElement>('#app');
if (!host) throw new Error('Missing #app element.');
const app = host;

let unmount: (() => void) | undefined;
// Bumped on every render so a slow lazy import cannot mount over a newer page.
let generation = 0;

/**
 * Mounts the page for the current URL, unmounting the previous one first, so at most one
 * renderer exists at a time:
 * - `/` and `/cinema` → auditorium (`/` is rewritten to `/cinema`)
 * - `/cinema?inspect=seat` → development seat inspector (loaded on demand)
 * - anything else → not found
 */
async function render(): Promise<void> {
  const current = ++generation;
  unmount?.();
  unmount = undefined;

  const path = location.pathname.replace(/\/+$/, '') || '/';
  if (path !== '/' && path !== CINEMA_PATH) {
    renderNotFound(app);
    return;
  }
  if (path === '/') history.replaceState(null, '', `${CINEMA_PATH}${location.search}${location.hash}`);

  if (new URLSearchParams(location.search).get('inspect') === 'seat') {
    const { mountSeatInspector } = await import('./cinema/seatInspector.ts');
    if (current !== generation) return;
    unmount = mountSeatInspector(app, { onClose: () => navigate(CINEMA_PATH) });
  } else {
    unmount = mountCinemaPage(app);
  }
}

function navigate(url: string): void {
  history.pushState(null, '', url);
  void render();
}

function renderNotFound(target: HTMLElement): void {
  document.title = 'Không tìm thấy trang';
  const page = document.createElement('main');
  page.className = 'not-found';
  const heading = document.createElement('h1');
  heading.textContent = 'Không tìm thấy trang';
  const link = document.createElement('a');
  link.href = CINEMA_PATH;
  link.textContent = 'Mở phòng chiếu 3D';
  page.append(heading, link);
  target.replaceChildren(page);
}

const onPopState = () => void render();
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
