/**
 * The site's working identity, in one place: name, lines of copy, metadata and colours. "Tân Phong
 * Cinema" is a working name for this version, not an approved brand; change it here (the landing
 * page, both HTML shells, the cinema header and the page titles read from this file).
 */
export const BRAND = {
  name: 'Tân Phong Cinema',
  /** Under the icon on the Home Screen, where the full name does not fit. */
  shortName: 'TP Cinema',
  /** Two-line wordmark: the name, then a small spaced word. */
  wordmark: { name: 'Tân Phong', suffix: 'Cinema' },
  /** Short line for titles and the share card. */
  tagline: 'Trải nghiệm phòng chiếu 3D trên trình duyệt',
  description: 'Khám phá khán phòng, chọn một chỗ ngồi và xem màn chiếu từ chính vị trí đó. Bản demo tương tác, không bán vé.',
  cinemaDescription: 'Khán phòng 3D tương tác: tham quan, chọn ghế, xem góc nhìn từ chỗ ngồi và phát video demo trên màn chiếu.',
  demoNote: 'Bản demo tương tác · Không bán vé',
  /**
   * Where the site is served: the Vercel deployment of this repository (checked on 2026-10-28:
   * `/cinema` answers 200). Used only for absolute metadata URLs (canonical, share image).
   */
  origin: 'https://tp3d-cinema.vercel.app',
  locale: 'vi_VN',
  colors: {
    /** Warm charcoal (page background). */
    charcoal: '#14110f',
    /** The auditorium page's background (tokens.css `--canvas`): the app's window and splash screen. */
    room: '#0d0d10',
    /** Wine red, from the seat upholstery. */
    wine: '#7d2232',
    /** Restrained champagne (accents; it sits with the gold of the logo). */
    champagne: '#d9c08c',
  },
  /** Share card (1200 × 630) rendered from the auditorium, see scripts/capture-brand-assets.mjs. */
  shareImage: '/brand/share-1200.jpg',
} as const;

/**
 * The web app manifest (served as /manifest.webmanifest, written by vite.config.ts). Added to the Home
 * Screen, the site opens on the auditorium as an app of its own: no address bar or browser toolbar
 * (the clock, the Dynamic Island and the home indicator stay the system's). The icons are the reel on
 * charcoal (scripts/capture-brand-assets.mjs); the maskable one keeps it inside the central circle
 * that every mask shape leaves. There is no service worker: nothing is cached for offline use.
 */
export function webAppManifest() {
  return {
    id: '/cinema',
    name: BRAND.name,
    short_name: BRAND.shortName,
    description: BRAND.cinemaDescription,
    lang: 'vi',
    dir: 'ltr',
    start_url: '/cinema',
    scope: '/',
    display: 'standalone',
    theme_color: BRAND.colors.room,
    background_color: BRAND.colors.room,
    icons: [
      { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/brand/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

export const PAGE_TITLES = {
  landing: `${BRAND.name} — ${BRAND.tagline}`,
  cinema: `Phòng chiếu 3D · ${BRAND.name}`,
  inspector: `Duyệt mẫu ghế · ${BRAND.name}`,
  notFound: `Không tìm thấy trang · ${BRAND.name}`,
} as const;

/**
 * The mark: the gold film reel (fixtures/brand/logo-source.png; every size, the tab and home screen
 * icons and the slate on the screen in the landing's pictures are made from it by
 * scripts/capture-brand-assets.mjs). A square image, `size` CSS px; decorative (the text next to
 * it carries the name).
 */
export function markImg(size = 32): string {
  const srcset = [64, 128, 256].map((w) => `/brand/logo-${w}.webp ${w}w`).join(', ');
  return `<img class="brand-mark" src="/brand/logo-128.webp" srcset="${srcset}" sizes="${size}px" width="${size}" height="${size}" alt="" aria-hidden="true" decoding="async" draggable="false">`;
}
