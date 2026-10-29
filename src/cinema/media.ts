import { DEMO_FILM, type FilmSource } from '../films.ts';

export { DEMO_FILM, FILMS, type FilmSource } from '../films.ts';

/**
 * Development only: `?film=<file>` plays a generated test clip from fixtures/media/ instead (see
 * scripts/make-media-fixtures.mjs), without a poster. Unknown names simply fail to load, which is
 * how the missing-file check works.
 */
export function devFilm(search: string): FilmSource | null {
  const params = new URLSearchParams(search);
  // `?poster=<file>`: the demo film with another still from fixtures/brand/ (the brand pictures use a
  // slate there, so no film frame appears without its credit).
  const poster = params.get('poster');
  if (poster && /^[\w.-]+$/.test(poster)) return { ...DEMO_FILM, poster: `/fixtures/brand/${poster}` };
  const name = params.get('film');
  if (!name || !/^[\w.-]+$/.test(name)) return null;
  return {
    ...DEMO_FILM,
    id: `fixture:${name}`,
    title: `Clip kiểm tra: ${name}`,
    src: `/fixtures/media/${name}`,
    type: name.endsWith('.webm') ? 'video/webm' : 'video/mp4',
    poster: '',
    credit: 'Clip kiểm tra nội bộ, sinh bằng code',
    creditUrl: '#',
    license: 'Nội bộ',
    licenseUrl: '#',
  };
}
