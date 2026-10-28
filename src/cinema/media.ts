/**
 * The demo film shown on the screen. Same-origin file under public/media/, so WebGL can read its
 * frames without CORS and nothing depends on another site staying up. Credits and licence:
 * docs/media-credits.md (the attribution below is shown in the player and on the landing page).
 */
export interface FilmSource {
  id: string;
  title: string;
  src: string;
  type: string;
  /** Still shown on the screen until the first video frame is decoded ("" for none). */
  poster: string;
  /** Size of the encoded picture; the real one is read from the file at runtime. */
  width: number;
  height: number;
  /** Attribution line the licence asks for. */
  credit: string;
  creditUrl: string;
  license: string;
  licenseUrl: string;
  /** No dialogue in this clip, so there are no captions to offer. */
  captions: null;
}

export const DEMO_FILM: FilmSource = {
  id: 'big-buck-bunny-trailer',
  title: 'Big Buck Bunny (trailer)',
  src: '/media/big-buck-bunny-trailer-720p.mp4',
  type: 'video/mp4',
  poster: '/media/big-buck-bunny-trailer-poster.jpg',
  width: 1280,
  height: 720,
  credit: '(c) copyright 2008, Blender Foundation / www.bigbuckbunny.org',
  creditUrl: 'https://peach.blender.org/about/',
  license: 'CC BY 3.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
  captions: null,
};

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
