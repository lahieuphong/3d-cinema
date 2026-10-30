/**
 * Light 2.5D depth for the hero: the photo of the auditorium drifts a few pixels against the text,
 * with the mouse (fine pointers only) and slower than the page when scrolling. Text and buttons
 * never move. Off entirely with reduced motion.
 *
 * Frames are requested only while the photo is still easing towards its target; once there,
 * nothing runs. While the hero is out of view or the tab is hidden, input is ignored and no frame
 * is scheduled.
 */
export interface HeroMotionOptions {
  /** Largest pointer drift, CSS px. */
  pointerShift?: number;
  /** Photo moves this fraction of the scroll distance (0 = fixed to the page). */
  scrollFactor?: number;
}

export function startHeroMotion(hero: HTMLElement, layer: HTMLElement, options: HeroMotionOptions = {}): () => void {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const fine = window.matchMedia?.('(hover: hover) and (pointer: fine)');
  const pointerShift = options.pointerShift ?? 10;
  const scrollFactor = options.scrollFactor ?? 0.12;
  const listeners = new AbortController();
  const { signal } = listeners;

  const target = { x: 0, y: 0 };
  const current = { x: 0, y: 0 };
  let scrollShift = 0;
  let frame: number | null = null;
  let inView = true;

  const enabled = () => !(reduce?.matches ?? false) && inView && !document.hidden;

  const apply = () => {
    layer.style.transform = `translate3d(${current.x.toFixed(2)}px, ${(current.y + scrollShift).toFixed(2)}px, 0)`;
  };
  const step = () => {
    frame = null;
    current.x += (target.x - current.x) * 0.12;
    current.y += (target.y - current.y) * 0.12;
    const settled = Math.abs(target.x - current.x) < 0.05 && Math.abs(target.y - current.y) < 0.05;
    if (settled) {
      current.x = target.x;
      current.y = target.y;
    }
    apply();
    if (!settled && enabled()) frame = requestAnimationFrame(step);
  };
  const schedule = () => {
    if (frame === null && enabled()) frame = requestAnimationFrame(step);
  };
  const stop = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  };

  hero.addEventListener(
    'pointermove',
    (event) => {
      if (event.pointerType !== 'mouse' || !(fine?.matches ?? false) || !enabled()) return;
      const rect = hero.getBoundingClientRect();
      // −1…1 from the centre; the photo drifts the other way, as a far plane would.
      target.x = -(((event.clientX - rect.left) / rect.width) * 2 - 1) * pointerShift;
      target.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1) * pointerShift * 0.6;
      schedule();
    },
    { signal, passive: true },
  );
  hero.addEventListener(
    'pointerleave',
    () => {
      target.x = 0;
      target.y = 0;
      schedule();
    },
    { signal },
  );
  const followScroll = () => {
    if (!enabled()) return;
    const next = Math.min(window.scrollY, hero.offsetHeight) * scrollFactor;
    if (Math.abs(next - scrollShift) < 0.5) return;
    scrollShift = next;
    if (frame === null) frame = requestAnimationFrame(step);
  };
  window.addEventListener('scroll', followScroll, { signal, passive: true });
  document.addEventListener('visibilitychange', () => document.hidden && stop(), { signal });
  const resetForReducedMotion = () => {
    if (!(reduce?.matches ?? false)) return;
    stop();
    target.x = target.y = current.x = current.y = scrollShift = 0;
    layer.style.transform = '';
  };
  reduce?.addEventListener('change', resetForReducedMotion, { signal });

  const observer = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(([entry]) => {
        inView = entry.isIntersecting;
        if (!inView) stop();
        // Back in view: the scroll that brought it back was ignored while it was out of view.
        else followScroll();
      })
    : null;
  observer?.observe(hero);

  hero.dataset.motion = enabled() ? 'on' : 'off';

  return () => {
    stop();
    listeners.abort();
    observer?.disconnect();
    layer.style.transform = '';
  };
}

/**
 * The frames' pictures drift a little against their frames as the page scrolls (each overhangs its
 * frame by `range` px top and bottom, site.css), only with a mouse and without reduced motion: on
 * touch screens they stay put. One frame is drawn per scroll step, and only for the pictures in
 * view; nothing runs while the page stands still.
 */
export function startFrameParallax(layers: HTMLElement[], range = 14): () => void {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const fine = window.matchMedia?.('(hover: hover) and (pointer: fine)');
  if (layers.length === 0 || typeof IntersectionObserver !== 'function' || !(fine?.matches ?? false) || (reduce?.matches ?? false)) return () => {};
  const listeners = new AbortController();
  const visible = new Set<HTMLElement>();
  let frame: number | null = null;

  const step = () => {
    frame = null;
    const middle = window.innerHeight / 2;
    for (const layer of visible) {
      const box = layer.parentElement!.getBoundingClientRect();
      // −1 when the frame's centre is a screen height below the middle, +1 a screen height above.
      const t = Math.max(-1, Math.min(1, (middle - (box.top + box.height / 2)) / window.innerHeight));
      layer.style.transform = `translate3d(0, ${(t * range).toFixed(1)}px, 0)`;
    }
  };
  const schedule = () => {
    if (frame === null && visible.size > 0 && !(reduce?.matches ?? false)) frame = requestAnimationFrame(step);
  };
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const layer = entry.target.querySelector<HTMLElement>(':scope > picture');
      if (!layer) continue;
      if (entry.isIntersecting) visible.add(layer);
      else visible.delete(layer);
    }
    schedule();
  });
  for (const layer of layers) observer.observe(layer.parentElement!);
  window.addEventListener('scroll', schedule, { signal: listeners.signal, passive: true });

  return () => {
    if (frame !== null) cancelAnimationFrame(frame);
    listeners.abort();
    observer.disconnect();
    for (const layer of layers) layer.style.transform = '';
  };
}
