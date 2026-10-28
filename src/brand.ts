/**
 * The site's working identity, in one place: name, lines of copy, metadata and colours. "Tân Phong
 * Cinema" is a working name for this version, not an approved brand; change it here (the landing
 * page, both HTML shells, the cinema header and the page titles read from this file).
 */
export const BRAND = {
  name: 'Tân Phong Cinema',
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
    /** Wine red, from the seat upholstery. */
    wine: '#7d2232',
    /** Restrained champagne (accents, the screen frame of the mark). */
    champagne: '#d9c08c',
  },
  /** Share card (1200 × 630) rendered from the auditorium, see scripts/capture-brand-assets.mjs. */
  shareImage: '/brand/share-1200.jpg',
} as const;

export const PAGE_TITLES = {
  landing: `${BRAND.name} — ${BRAND.tagline}`,
  cinema: `Phòng chiếu 3D · ${BRAND.name}`,
  inspector: `Duyệt mẫu ghế · ${BRAND.name}`,
  notFound: `Không tìm thấy trang · ${BRAND.name}`,
} as const;

/**
 * The mark: a 16:9 screen frame in champagne over one row of wine-red seats. Inline SVG, drawn
 * for 32 × 32; decorative (the text next to it carries the name).
 */
export function markSvg(size = 32): string {
  const { champagne, wine } = BRAND.colors;
  return `<svg class="brand-mark" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect x="3.2" y="6.5" width="25.6" height="14.4" rx="2.4" fill="none" stroke="${champagne}" stroke-width="2.4"/><rect x="7.5" y="10.4" width="17" height="6.6" rx="1" fill="${champagne}" opacity=".22"/><path d="M7 26.2h4.6M13.7 26.2h4.6M20.4 26.2H25" stroke="${wine}" stroke-width="3.2" stroke-linecap="round"/></svg>`;
}
