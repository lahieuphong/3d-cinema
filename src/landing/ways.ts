/**
 * "Trải nghiệm": one picture and three ways to use the room. The list (each way's name and sentence,
 * all readable without this script) becomes a set of tabs over the picture:
 * - the list is the tablist and each item a tab, named by its heading and described by its
 *   sentence; the picture's frame is the panel;
 * - a press or a tap chooses a way, as do the arrow keys (then Home, End) on the focused tab;
 *   choosing is enough, there is no carousel and nothing changes on its own;
 * - the chosen picture fades in over the one before (site.css), once it has been decoded, so the
 *   frame never shows an empty or half-drawn picture; the frame keeps its shape throughout;
 * - narrow screens put the three names in a row and the chosen sentence under them;
 * - the two pictures not shown first come with their sources held back (content.ts): they are
 *   fetched when the picture comes into view, or at the first choice, not with the page.
 * Returns a function that removes its listeners.
 */
export function enhanceWays(section: HTMLElement): () => void {
  const list = section.querySelector<HTMLElement>('.experience__ways');
  const panel = section.querySelector<HTMLElement>('.experience__media');
  if (!list || !panel) return () => {};
  const ways = [...list.querySelectorAll<HTMLElement>('.way')];
  const shots = new Map([...panel.querySelectorAll<HTMLElement>('.experience__shot')].map((shot) => [shot.dataset.way, shot]));
  const listeners = new AbortController();
  const { signal } = listeners;

  // The chosen way's sentence under the row of names on narrow screens (the tabs already carry it
  // as their description, so it is hidden from assistive technology).
  const caption = document.createElement('p');
  caption.className = 'experience__caption';
  caption.setAttribute('aria-hidden', 'true');
  list.after(caption);

  list.setAttribute('role', 'tablist');
  list.setAttribute('aria-label', 'Cách trải nghiệm');
  panel.setAttribute('role', 'tabpanel');
  ways.forEach((way, index) => {
    const title = way.querySelector('.way__title');
    const text = way.querySelector('.way__text');
    way.id = `tab-${way.dataset.way}`;
    if (text) text.id = `mo-ta-${way.dataset.way}`;
    way.setAttribute('role', 'tab');
    if (title) way.setAttribute('aria-labelledby', title.id);
    if (text) way.setAttribute('aria-describedby', text.id);
    way.setAttribute('aria-controls', panel.id);
    way.dataset.index = String(index);
  });

  // The held-back pictures: their sources go in once, when wanted.
  let near: IntersectionObserver | null = null;
  const fetchAll = () => {
    for (const element of panel.querySelectorAll<HTMLSourceElement | HTMLImageElement>('[data-srcset], [data-src]')) {
      if (element.dataset.srcset) element.srcset = element.dataset.srcset;
      if (element instanceof HTMLImageElement && element.dataset.src) element.src = element.dataset.src;
      delete element.dataset.srcset;
      delete element.dataset.src;
    }
    near?.disconnect();
  };
  if (typeof IntersectionObserver === 'function') {
    near = new IntersectionObserver((entries) => entries.some((entry) => entry.isIntersecting) && fetchAll());
    near.observe(panel);
  } else {
    fetchAll();
  }

  let leaving: ReturnType<typeof setTimeout> | undefined;
  let chosen = ways.findIndex((way) => way.hasAttribute('data-active'));
  if (chosen < 0) chosen = 0;

  const showShot = (shot: HTMLElement) => {
    const previous = [...shots.values()].find((s) => s.hasAttribute('data-active'));
    if (previous === shot) return;
    clearTimeout(leaving);
    for (const s of shots.values()) delete s.dataset.leaving;
    if (previous) {
      delete previous.dataset.active;
      previous.dataset.leaving = '';
    }
    shot.dataset.active = '';
    // The one before stays under it until the fade (0.28 s) is over.
    leaving = setTimeout(() => previous && delete previous.dataset.leaving, 320);
  };

  const choose = (index: number, focus: boolean, chosenByVisitor = true) => {
    chosen = index;
    ways.forEach((way, i) => {
      const on = i === index;
      way.setAttribute('aria-selected', String(on));
      way.tabIndex = on ? 0 : -1;
      if (on) way.dataset.active = '';
      else delete way.dataset.active;
    });
    const way = ways[index];
    panel.setAttribute('aria-labelledby', way.id);
    caption.textContent = way.querySelector('.way__text')?.textContent ?? '';
    if (focus) way.focus();
    const shot = shots.get(way.dataset.way);
    if (!shot) return;
    if (chosenByVisitor) fetchAll();
    const image = shot.querySelector('img');
    // Shown once it can be drawn whole; a picture that fails is shown anyway (its alt text).
    const ready = image && !image.complete ? image.decode().catch(() => {}) : Promise.resolve();
    void ready.then(() => {
      if (chosen === index) showShot(shot);
    });
  };

  list.addEventListener(
    'click',
    (event) => {
      const way = (event.target as Element | null)?.closest<HTMLElement>('.way');
      if (way && list.contains(way)) choose(Number(way.dataset.index), false);
    },
    { signal },
  );
  list.addEventListener(
    'keydown',
    (event) => {
      const last = ways.length - 1;
      const next: Record<string, number> = {
        ArrowRight: chosen === last ? 0 : chosen + 1,
        ArrowDown: chosen === last ? 0 : chosen + 1,
        ArrowLeft: chosen === 0 ? last : chosen - 1,
        ArrowUp: chosen === 0 ? last : chosen - 1,
        Home: 0,
        End: last,
      };
      if (!(event.key in next)) {
        // Enter and Space on a tab choose it too (it is already chosen when focused by arrow).
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          choose(chosen, false);
        }
        return;
      }
      event.preventDefault();
      choose(next[event.key], true);
    },
    { signal },
  );

  choose(chosen, false, false);
  section.dataset.ways = 'tabs';

  return () => {
    clearTimeout(leaving);
    near?.disconnect();
    listeners.abort();
  };
}
