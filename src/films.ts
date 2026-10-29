/**
 * The films shown on the screen, chosen in Xem phim. Same-origin files under public/media/, so WebGL
 * can read their frames without CORS and nothing depends on another site staying up. Credits and
 * licences: docs/media-credits.md (each film's attribution is shown in the player while it is on,
 * all of them in Cài đặt › Thông tin and on the landing page, which is why this data lives outside
 * the auditorium's code).
 */
export interface FilmSource {
  id: string;
  title: string;
  src: string;
  type: string;
  /** Still shown on the screen until the first video frame is decoded ("" for none). */
  poster: string;
  /** A small still for the film list (96 × 54 shown, 192 × 108 stored; "" for none). */
  thumb: string;
  /** Length as printed in the film list (the real one is read from the file at runtime). */
  length: string;
  /** Who made it, as printed in the film list. */
  studio: string;
  /** Size of the encoded picture; the real one is read from the file at runtime. */
  width: number;
  height: number;
  /** Attribution line the licence asks for. */
  credit: string;
  creditUrl: string;
  license: string;
  licenseUrl: string;
  /** No dialogue in these films (music and sounds only), so there are no captions to offer. */
  captions: null;
}

export const FILMS: readonly FilmSource[] = [
  {
    id: 'big-buck-bunny-trailer',
    title: 'Big Buck Bunny (trailer)',
    src: '/media/big-buck-bunny-trailer-720p.mp4',
    type: 'video/mp4',
    poster: '/media/big-buck-bunny-trailer-poster.jpg',
    thumb: '/media/big-buck-bunny-trailer-thumb.webp',
    length: '0:33',
    studio: 'Blender Foundation',
    width: 1280,
    height: 720,
    credit: '(c) copyright 2008, Blender Foundation / www.bigbuckbunny.org',
    creditUrl: 'https://peach.blender.org/about/',
    license: 'CC BY 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    captions: null,
  },
  {
    id: 'daily-dweebs',
    title: 'The Daily Dweebs',
    src: '/media/daily-dweebs-720p.mp4',
    type: 'video/mp4',
    poster: '/media/daily-dweebs-poster.jpg',
    thumb: '/media/daily-dweebs-thumb.webp',
    length: '1:00',
    studio: 'Blender Animation Studio',
    width: 1280,
    height: 720,
    credit: '© 2017 Blender Animation Studio, Amsterdam / dailydweebs.com',
    creditUrl: 'https://studio.blender.org/projects/dailydweebs/',
    license: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    captions: null,
  },
  {
    id: 'caminandes-3',
    title: 'Caminandes 3: Llamigos',
    src: '/media/caminandes-3-llamigos-720p.mp4',
    type: 'video/mp4',
    poster: '/media/caminandes-3-llamigos-poster.jpg',
    thumb: '/media/caminandes-3-llamigos-thumb.webp',
    length: '2:30',
    studio: 'Blender Institute',
    width: 1280,
    height: 720,
    credit: '© Blender Foundation / Blender Institute, caminandes.com',
    creditUrl: 'https://studio.blender.org/projects/caminandes-3/',
    license: 'CC BY',
    licenseUrl: 'https://studio.blender.org/remixing/',
    captions: null,
  },
];

/** The film the screen starts with. */
export const DEMO_FILM: FilmSource = FILMS[0];
