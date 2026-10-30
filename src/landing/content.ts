import { BRAND, markImg } from '../brand.ts';
import { FILMS } from '../films.ts';
import { CINEMA_PATH } from '../router.ts';

/**
 * The landing page as HTML, from one source: Vite writes it into index.html at build time (so `/`
 * has its content and links before, or without, JavaScript), and the app renders the same markup
 * when it comes back to `/` from the auditorium. Everything here is static text; nothing comes from
 * the URL or the user.
 *
 * Three parts, "a door into the cinema": the room full width with a few words over it; one space,
 * three ways to use it (one picture, three choices; landing.ts turns the list into tabs); the
 * invitation in. Every picture is a render of this auditorium (scripts/capture-brand-assets.mjs),
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
  finale: { widths: [960, 1440, 2048], width: 2048, height: 857 },
  finalePortrait: { widths: [720, 1080], width: 1080, height: 1350 },
} as const;

/** The three ways to use the room ("Trải nghiệm"), each with its own picture. */
export const WAYS = [
  {
    id: 'kham-pha',
    name: 'exp-explore',
    title: 'Khám phá',
    text: 'Đi giữa các lối đi và tìm góc nhìn bạn thích.',
    alt: 'Bậc lối đi bên phải nhìn lên cuối phòng: đèn chân bậc, tay vịn và các hàng ghế đỏ.',
  },
  {
    id: 'chon-ghe',
    name: 'exp-seats',
    title: 'Chọn ghế',
    text: 'Chọn trực tiếp trong không gian 3D hoặc trên sơ đồ.',
    alt: 'Mười hàng ghế đỏ nhìn từ trên cao ở góc trước phòng, lối đi hai bên.',
  },
  {
    id: 'xem-phim',
    name: 'exp-watch',
    title: 'Xem phim',
    text: 'Ngồi vào vị trí đã chọn và bắt đầu buổi chiếu.',
    alt: 'Màn chiếu và rèm đỏ nhìn từ ghế F06, giữa phòng, qua lưng các hàng ghế phía trước.',
  },
] as const;

/** Each film the auditorium can show, with the attribution its licence asks for. */
const FILM_CREDITS = FILMS.map(
  (film) =>
    `<li><em>${film.title}</em> — <a href="${film.creditUrl}" rel="noopener noreferrer">${film.credit}</a> · <a href="${film.licenseUrl}" rel="noopener noreferrer">${film.license}</a></li>`,
).join('');

const srcset = (name: string, widths: readonly number[], ext = 'webp') => widths.map((w) => `${IMG}/${name}-${w}.${ext} ${w}w`).join(', ');

export function wordmarkHtml(className = 'wordmark'): string {
  return `<a class="${className}" href="/" aria-label="${BRAND.name}, trang chủ">${markImg()}<span class="wordmark__text" aria-hidden="true"><span class="wordmark__name">${BRAND.wordmark.name}</span><span class="wordmark__suffix">${BRAND.wordmark.suffix}</span></span></a>`;
}

export function landingHtml(): string {
  const { hero, heroPortrait, way, finale, finalePortrait } = LANDING_IMAGES;
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
<img class="hero__image" src="${IMG}/portal-hero-1920.jpg" width="${hero.width}" height="${hero.height}" alt="Khán phòng nhìn dọc lối đi bên trái: các hàng ghế đỏ dẫn tới màn chiếu đang sáng dịu." fetchpriority="high" decoding="async">
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
</div>
<div class="experience__stage" data-reveal>
<figure class="experience__media" id="trai-nghiem-anh">
${WAYS.map((w, i) => {
  // Only the first picture is shown before a choice (and without the script): the other two carry
  // their sources as data until the part comes near or a way is chosen (ways.ts).
  const src = i === 0 ? '' : 'data-';
  return `<picture class="experience__shot" data-way="${w.id}"${i === 0 ? ' data-active' : ''}>
<source type="image/webp" ${src}srcset="${srcset(w.name, way.widths)}" sizes="(min-width: 960px) 64vw, 100vw">
<img ${src}src="${IMG}/${w.name}-1080.jpg" width="${way.width}" height="${way.height}" alt="${w.alt}" loading="lazy" decoding="async">
</picture>`;
}).join('\n')}
</figure>
<ol class="experience__ways">
${WAYS.map(
  (w, i) => `<li class="way" data-way="${w.id}"${i === 0 ? ' data-active' : ''}>
<h3 class="way__title" id="cach-${w.id}"><span class="way__number" aria-hidden="true">0${i + 1}</span>${w.title}</h3>
<p class="way__text">${w.text}</p>
</li>`,
).join('\n')}
</ol>
</div>
</section>
<section class="finale" aria-labelledby="finale-title">
<div class="finale__media">
<picture>
<source media="(max-aspect-ratio: 4/5)" type="image/webp" srcset="${srcset('portal-finale-portrait', finalePortrait.widths)}" sizes="100vw">
<source media="(max-aspect-ratio: 4/5)" type="image/jpeg" srcset="${IMG}/portal-finale-portrait-1080.jpg 1080w" sizes="100vw">
<source type="image/webp" srcset="${srcset('portal-finale', finale.widths)}" sizes="100vw">
<img class="finale__image" src="${IMG}/portal-finale-1440.jpg" width="${finale.width}" height="${finale.height}" alt="Khán phòng nhìn thẳng từ cuối lối giữa: các hàng ghế đỏ và màn chiếu sáng dịu giữa hai rèm." loading="lazy" decoding="async">
</picture>
</div>
<div class="finale__content" data-reveal>
<h2 id="finale-title">Đèn đã dịu. Mời bạn vào rạp.</h2>
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
