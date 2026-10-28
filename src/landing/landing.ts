import { isPlainClick } from '../router.ts';
import { landingHtml } from './content.ts';
import { startHeroMotion } from './motion.ts';

export interface LandingPageOptions {
  /** Takes the visitor into the auditorium (in-app navigation). */
  enterCinema(): void;
  /** The visitor is about to enter (hover, focus, press): fetch the auditorium's code, build nothing. */
  preloadCinema(): void;
}

/**
 * Mounts the landing page into `host`. On a first visit to `/` the markup is already there (written
 * into index.html at build time) and is only enhanced; coming back from the auditorium it is
 * rendered from the same source. Returns a function that removes everything it added.
 *
 * "Vào rạp" / "Bước vào rạp" are real links to /cinema: a plain click is taken over for in-app
 * navigation; Ctrl/⌘/Shift/middle clicks open a new tab or window as usual.
 */
export function mountLandingPage(host: HTMLElement, options: LandingPageOptions): () => void {
  if (!host.querySelector('[data-landing]')) host.innerHTML = landingHtml();
  const root = host.querySelector<HTMLElement>('[data-landing]')!;
  const listeners = new AbortController();
  const { signal } = listeners;

  for (const link of root.querySelectorAll<HTMLAnchorElement>('a[data-cta="cinema"]')) {
    for (const type of ['pointerenter', 'focus', 'pointerdown'] as const) {
      link.addEventListener(type, () => options.preloadCinema(), { signal, passive: true });
    }
    link.addEventListener(
      'click',
      (event) => {
        if (!isPlainClick(event, link.target)) return;
        event.preventDefault();
        options.enterCinema();
      },
      { signal },
    );
  }

  const hero = root.querySelector<HTMLElement>('.hero');
  const layer = root.querySelector<HTMLElement>('.hero__media');
  const stopMotion = hero && layer ? startHeroMotion(hero, layer) : () => {};

  return () => {
    stopMotion();
    listeners.abort();
  };
}
