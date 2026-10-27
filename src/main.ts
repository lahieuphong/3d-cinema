import './styles.css';
import { mountCinemaPage } from './cinema/page.ts';

const CINEMA_PATH = '/cinema';

const host = document.querySelector<HTMLElement>('#app');
if (!host) throw new Error('Missing #app element.');

const path = location.pathname.replace(/\/+$/, '') || '/';
let unmount: (() => void) | undefined;

if (path === '/' || path === CINEMA_PATH) {
  // The site currently has a single page: "/" lands on /cinema.
  if (path === '/') history.replaceState(null, '', `${CINEMA_PATH}${location.search}${location.hash}`);
  unmount = mountCinemaPage(host);
} else {
  renderNotFound(host);
}

function renderNotFound(target: HTMLElement): void {
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

if (import.meta.hot) {
  // Re-mount on hot update instead of reloading; the old canvas, controls and listeners are disposed first.
  import.meta.hot.dispose(() => unmount?.());
  import.meta.hot.accept();
}
