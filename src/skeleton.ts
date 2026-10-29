import { markImg } from './brand.ts';

/**
 * Skeletons: while something loads, placeholders in its shape with a slow sheen across them
 * (styles in src/site.css, loaded on every page). The shapes are decorative (aria-hidden); the words
 * that say what is happening stay with them for everyone, and every page that shows a skeleton has
 * a status line too.
 *
 * - `roomSkeleton`: the auditorium as it will appear — the screen, then rows of seats widening
 *   towards the viewer. `screen` goes inside the screen (the words that say what is loading).
 * - `seatSkeleton`: one seat (the seat inspector).
 * - `cinemaPageSkeleton`: the whole /cinema page — the header's two clusters, the room, the task bar
 *   (on phones, the round button instead) — before its code has arrived.
 */
export function roomSkeleton(screen = ''): string {
  const rows = [0, 1, 2, 3].map(() => '<span class="skeleton"></span>').join('');
  return `<div class="room-skeleton"><div class="skeleton room-skeleton__screen">${screen}</div><span class="room-skeleton__rows" aria-hidden="true">${rows}</span></div>`;
}

export function seatSkeleton(): string {
  return '<span class="seat-skeleton" aria-hidden="true"><span class="skeleton seat-skeleton__back"></span><span class="skeleton seat-skeleton__arm"></span><span class="skeleton seat-skeleton__cushion"></span><span class="skeleton seat-skeleton__arm"></span></span>';
}

export function cinemaPageSkeleton(screen = ''): string {
  return (
    '<div class="page-skeleton">' +
    `<span class="page-skeleton__head" aria-hidden="true"><span class="skeleton page-skeleton__brand">${markImg(28)}</span><span class="skeleton page-skeleton__menu"></span></span>` +
    roomSkeleton(screen) +
    '<span class="page-skeleton__foot" aria-hidden="true"><span class="skeleton page-skeleton__dock"></span><span class="skeleton page-skeleton__tasks"></span></span>' +
    '<span class="skeleton page-skeleton__hub" aria-hidden="true"></span>' +
    '</div>'
  );
}
