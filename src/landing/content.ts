import { BRAND, markImg } from '../brand.ts';
import { ICONS } from '../icons.ts';
import { FILMS } from '../films.ts';
import { CINEMA_PATH } from '../router.ts';

/**
 * The landing page as HTML, from one source: Vite writes it into index.html at build time (so `/`
 * has its content and links before, or without, JavaScript), and the app renders the same markup
 * when it comes back to `/` from the auditorium. Everything here is static text; nothing comes from
 * the URL or the user.
 *
 * Three parts, "a door into the cinema": the room full width with a few words over it; one space,
 * three things it does (one picture each, with a sketch; landing.ts turns the list into tabs); the
 * invitation in: a projector's beam over the five films on the screen in a strip of film (each
 * with its length, studio and licence; the full credits are in the footer), no picture of the room
 * this time (the hero has it). Every picture is a render of this auditorium (scripts/capture-brand-assets.mjs),
 * with a slate on its screen (a softly lit blank screen, or the logo) instead of a film frame.
 */

const IMG = '/brand';

/**
 * Rendered sizes (the largest file of each), so the page reserves the right space before the
 * pictures arrive (no layout shift), and the widths each is written at.
 */
export const LANDING_IMAGES = {
  hero: { widths: [960, 1440, 1920, 2560], width: 2560, height: 1440 },
  heroPortrait: { widths: [720, 900], width: 900, height: 1920 },
  way: { widths: [720, 1080, 1600], width: 1600, height: 900 },
} as const;

/**
 * "Trải nghiệm": three things the auditorium does (src/cinema: tour.ts, walker.ts and the seat
 * views), each with its picture of the room and, over it, a small live sketch of the control that
 * does it (the tour bar and its path, the walking stick, the seat map with "Xem từ ghế này").
 */
export const WAYS = [
  {
    id: 'tham-quan',
    name: 'exp-seats',
    icon: ICONS.tour,
    title: 'Tham quan tự động',
    text: 'Máy quay đưa bạn một vòng qua màn chiếu, rèm và các hàng ghế. Kéo, cuộn hay bấm phím là dừng.',
    how: 'Khám phá › Tham quan',
    alt: 'Mười hàng ghế đỏ nhìn từ trên cao ở góc trước phòng, lối đi hai bên.',
  },
  {
    id: 'di-bo',
    name: 'exp-explore',
    icon: ICONS.walk,
    title: 'Đi bộ trong rạp',
    text: 'Bước giữa các lối đi, lên xuống từng bậc như khi ở trong rạp, không xuyên qua ghế hay tường.',
    how: 'Phím W A S D · cần điều khiển trên điện thoại',
    alt: 'Bậc lối đi bên phải nhìn lên cuối phòng: đèn chân bậc, tay vịn và các hàng ghế đỏ.',
  },
  {
    id: 'xem-tu-ghe',
    name: 'exp-watch',
    icon: ICONS.eye,
    title: 'Xem từ ghế này',
    text: 'Chọn một trong 110 ghế, ngay trong phòng hoặc trên sơ đồ, rồi nhìn màn chiếu từ đúng chỗ ngồi đó.',
    how: 'Chọn ghế › Xem từ ghế này',
    alt: 'Màn chiếu và rèm đỏ nhìn từ ghế F06, giữa phòng, qua lưng các hàng ghế phía trước.',
  },
] as const;

const svgIcon = (d: string, className: string) => `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;

/** The sketch over each picture (decorative: the words beside it say the same). */
const SKETCHES: Record<(typeof WAYS)[number]['id'], string> = {
  // The tour bar with the stop it is at, and the path through the room with its stops.
  'tham-quan': `<svg class="sketch__path" viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice"><path pathLength="1" d="M146 82 C 126 72, 110 64, 96 57 S 74 44, 66 36 S 58 28, 56 22"/><circle cx="146" cy="82" r="2.2"/><circle cx="96" cy="57" r="2.2"/><circle cx="66" cy="36" r="2.2"/><circle cx="56" cy="22" r="2.2"/></svg>
<p class="sketch__chip sketch__chip--tour">${svgIcon(ICONS.tour, 'sketch__icon')}<span class="sketch__stops"><span>Tổng quan phòng chiếu</span><span>Màn chiếu, rèm và bục</span><span>Nhìn lại các hàng ghế</span></span></p>`,
  // The walking stick pushed forward, the keys, and steps going up the aisle.
  'di-bo': `<span class="sketch__steps"><span></span><span></span><span></span></span>
<span class="sketch__stick"><span class="sketch__knob"></span></span>
<span class="sketch__keys"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span>
<p class="sketch__chip">${svgIcon(ICONS.walk, 'sketch__icon')}<span>Đi bộ</span></p>`,
  // The seat map, F06 chosen, then "Xem từ ghế này".
  'xem-tu-ghe': `<span class="sketch__map"><span class="sketch__screen"></span><span class="sketch__grid"><span class="sketch__seat"></span></span><span class="sketch__label">Ghế F06</span></span>
<p class="sketch__chip sketch__chip--gold">${svgIcon(ICONS.eye, 'sketch__icon')}<span>Xem từ ghế này</span></p>`,
};

/** Each film the auditorium can show, with the attribution its licence asks for. */
const FILM_CREDITS = FILMS.map(
  (film) =>
    `<li><em>${film.title}</em> — <a href="${film.creditUrl}" rel="noopener noreferrer">${film.credit}</a> · <a href="${film.licenseUrl}" rel="noopener noreferrer">${film.license}</a></li>`,
).join('');

/** A film's still for the landing page (public/brand/film-<poster name>-{480,800}.webp, made from its poster). */
const filmStill = (film: { poster: string }) => `film-${film.poster.replace(/^\/media\//, '').replace(/-poster\.jpg$/, '')}`;

const srcset = (name: string, widths: readonly number[], ext = 'webp') => widths.map((w) => `${IMG}/${name}-${w}.${ext} ${w}w`).join(', ');

export function wordmarkHtml(className = 'wordmark'): string {
  return `<a class="${className}" href="/" aria-label="${BRAND.name}, trang chủ">${markImg()}<span class="wordmark__text" aria-hidden="true"><span class="wordmark__name">${BRAND.wordmark.name}</span><span class="wordmark__suffix">${BRAND.wordmark.suffix}</span></span></a>`;
}

export function landingHtml(): string {
  const { hero, heroPortrait, way } = LANDING_IMAGES;
  const cta = (label: string, extra = '') => `<a class="button button--primary${extra}" href="${CINEMA_PATH}" data-cta="cinema">${label}</a>`;
  return `<div class="landing" data-landing>
<a class="skip-link" href="#noi-dung">Bỏ qua, tới nội dung chính</a>
<header class="site-header">
${wordmarkHtml()}
<nav class="site-nav" aria-label="Các phần của trang">
<a href="#trai-nghiem">Trải nghiệm</a>
</nav>
<a class="button button--small" href="${CINEMA_PATH}" data-cta="cinema">Vào rạp</a>
</header>
<main id="noi-dung" tabindex="-1">
<section class="hero" aria-labelledby="hero-title">
<div class="hero__media">
<picture>
<source media="(max-aspect-ratio: 4/5)" type="image/webp" srcset="${srcset('portal-hero-portrait', heroPortrait.widths)}" sizes="100vw">
<source media="(max-aspect-ratio: 4/5)" type="image/jpeg" srcset="${IMG}/portal-hero-portrait-900.jpg 900w" sizes="100vw">
<source type="image/webp" srcset="${srcset('portal-hero', hero.widths)}" sizes="100vw">
<img class="hero__image" src="${IMG}/portal-hero-1920.jpg" width="${hero.width}" height="${hero.height}" alt="Khán phòng nhìn dọc lối đi bên trái: các hàng ghế đỏ dẫn tới màn chiếu mang logo Tân Phong Cinema." fetchpriority="high" decoding="async">
</picture>
</div>
<div class="hero__shade" aria-hidden="true"></div>
<div class="hero__content">
<h1 id="hero-title"><span class="hero__line">Một chỗ ngồi.</span> <span class="hero__line">Một góc nhìn riêng.</span></h1>
<p class="hero__lead">Khám phá khán phòng 3D, chọn ghế và thưởng thức bộ phim.</p>
<div class="hero__actions">
${cta('Vào rạp')}
<a class="hero__more" href="#trai-nghiem">Khám phá không gian <span aria-hidden="true">↓</span></a>
</div>
<p class="hero__note">${BRAND.demoNote}</p>
</div>
</section>
<section class="experience" id="trai-nghiem" aria-labelledby="experience-title" tabindex="-1">
<div class="experience__head" data-reveal>
<p class="kicker">Trải nghiệm</p>
<h2 id="experience-title">Một không gian, ba cách khám phá</h2>
<p class="experience__lead">Ba việc bạn làm được trong khán phòng, ngay trên trình duyệt.</p>
</div>
<div class="experience__stage" data-reveal>
<figure class="experience__media" id="trai-nghiem-anh">
${WAYS.map((w, i) => {
  // Only the first picture is shown before a choice (and without the script): the other two carry
  // their sources as data until the part comes near or a way is chosen (ways.ts).
  const src = i === 0 ? '' : 'data-';
  return `<div class="experience__shot" data-way="${w.id}"${i === 0 ? ' data-active' : ''}>
<picture>
<source type="image/webp" ${src}srcset="${srcset(w.name, way.widths)}" sizes="(min-width: 960px) 64vw, 100vw">
<img ${src}src="${IMG}/${w.name}-1080.jpg" width="${way.width}" height="${way.height}" alt="${w.alt}" loading="lazy" decoding="async">
</picture>
<div class="sketch sketch--${w.id}" aria-hidden="true">
${SKETCHES[w.id]}
</div>
</div>`;
}).join('\n')}
</figure>
<ol class="experience__ways">
${WAYS.map(
  (w, i) => `<li class="way" data-way="${w.id}"${i === 0 ? ' data-active' : ''}>
<h3 class="way__title" id="cach-${w.id}">${svgIcon(w.icon, 'way__icon')}<span>${w.title}</span></h3>
<p class="way__text">${w.text}</p>
<p class="way__how">${w.how}</p>
</li>`,
).join('\n')}
</ol>
</div>
</section>
<section class="finale" aria-labelledby="finale-title">
<div class="finale__beam" aria-hidden="true" data-reveal></div>
<div class="finale__content" data-reveal>
<p class="kicker">Trên màn chiếu</p>
<h2 id="finale-title">Đèn đã dịu. Mời bạn vào rạp.</h2>
<p class="finale__lead">Năm phim ngắn đang chờ trên màn chiếu. Chọn phim trong rạp, ở “Xem phim”.</p>
</div>
<div class="films" data-reveal>
<ol class="films__strip">
${FILMS.map(
  (film, i) => `<li class="film" data-edge="TP ${String(i + 1).padStart(2, '0')}">
<figure class="film__figure">
<div class="film__frame">
<img src="${IMG}/${filmStill(film)}-800.webp" srcset="${IMG}/${filmStill(film)}-480.webp 480w, ${IMG}/${filmStill(film)}-800.webp 800w" sizes="(min-width: 720px) 18vw, 74vw" width="800" height="450" alt="Một khung hình của phim ${film.title}." loading="lazy" decoding="async">
</div>
<figcaption class="film__caption">
<h3 class="film__title">${film.title}</h3>
<p class="film__meta">${film.length} · ${film.studio} · ${film.license}</p>
</figcaption>
</figure>
</li>`,
).join('\n')}
</ol>
</div>
<div class="finale__cta" data-reveal>
${cta('Bước vào rạp', ' button--large')}
</div>
</section>
</main>
<footer class="site-footer">
<p class="site-footer__brand">${BRAND.name} · ${BRAND.demoNote}. Ghế, sơ đồ và trạng thái “đã đặt” là dữ liệu minh họa.</p>
<p>Phim trong phòng chiếu:</p>
<ul class="site-footer__films">${FILM_CREDITS}</ul>
<p>Hình ảnh trên trang được kết xuất từ chính khán phòng 3D này.</p>
</footer>
</div>`;
}
