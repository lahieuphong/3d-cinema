import { isPlainClick } from '../router.ts';
import { landingHtml } from './content.ts';
import { startHeroMotion, startPictureParallax, startStripDrift } from './motion.ts';
import { enhanceWays } from './ways.ts';

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
        fadeFromDark();
        options.enterCinema();
      },
      { signal },
    );
  }

  // Pictures still on their way shimmer in their place and the hero fades in over it (site.css);
  // the ones already here are left alone. Without this script they simply appear.
  for (const image of root.querySelectorAll<HTMLImageElement>('.hero__image, .experience__shot img, .finale__image, .film__frame img')) {
    if (image.complete) continue;
    image.dataset.loading = '';
    const arrived = () => delete image.dataset.loading;
    image.addEventListener('load', arrived, { once: true, signal });
    image.addEventListener('error', arrived, { once: true, signal });
  }

  const hero = root.querySelector<HTMLElement>('.hero');
  const layer = root.querySelector<HTMLElement>('.hero__media');
  const stopMotion = hero && layer ? startHeroMotion(hero, layer) : () => {};
  const stopParallax = startPictureParallax([...root.querySelectorAll<HTMLElement>('.finale__media > picture')]);
  const stopReveal = revealParts(root);
  const ways = root.querySelector<HTMLElement>('.experience');
  const stopWays = ways ? enhanceWays(ways) : () => {};
  const strip = root.querySelector<HTMLElement>('.films__strip');
  const stopDrift = strip ? startStripDrift(strip) : () => {};

  return () => {
    stopMotion();
    stopParallax();
    stopReveal();
    stopWays();
    stopDrift();
    listeners.abort();
  };
}

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * The parts below the first screen come up as they reach it: hidden only once this script runs
 * (`data-reveal-ready` on the page), shown for good when a tenth of them is in view (`data-shown`).
 * Without IntersectionObserver, or with reduced motion, they stay as they are: visible.
 */
function revealParts(root: HTMLElement): () => void {
  if (typeof IntersectionObserver !== 'function' || reducedMotion()) return () => {};
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        (entry.target as HTMLElement).dataset.shown = '';
        observer.unobserve(entry.target);
      }
    },
    { threshold: 0.1 },
  );
  for (const element of root.querySelectorAll('[data-reveal]')) observer.observe(element);
  root.dataset.revealReady = '';
  return () => observer.disconnect();
}

/**
 * Entering the auditorium: the next page appears under a dark veil that lifts at once (site.css
 * `.page-fade`, about a quarter of a second). Nothing waits for it and it never takes a press; it removes
 * itself when done, wherever the visitor has gone meanwhile.
 */
function fadeFromDark(): void {
  if (reducedMotion()) return;
  const veil = document.createElement('div');
  veil.className = 'page-fade';
  veil.setAttribute('aria-hidden', 'true');
  const remove = () => veil.remove();
  veil.addEventListener('animationend', remove, { once: true });
  setTimeout(remove, 1000);
  document.body.append(veil);
}
