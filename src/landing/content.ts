import { BRAND, markImg } from '../brand.ts';
import { FILMS } from '../films.ts';
import { CINEMA_PATH } from '../router.ts';

/**
 * The landing page as HTML, from one source: Vite writes it into index.html at build time (so `/`
 * has its content and links before, or without, JavaScript), and the app renders the same markup
 * when it comes back to `/` from the auditorium. Everything here is static text; nothing comes from
 * the URL or the user.
 *
 * The page is one strip of 35 mm film running down to the foot of the page (site.css draws its
 * perforated edges), its frames the sections: 01 Mở màn, 02 Góc nhìn, 03 Khám phá, 04 Vào rạp, then
 * the credits on the tail. Every picture is a render of this auditorium
 * (scripts/capture-brand-assets.mjs), a neutral slate on its screen instead of a film frame.
 */

const IMG = '/brand';

/**
 * Rendered sizes (the largest file of each), so the page reserves the right space before the
 * pictures arrive (no layout shift), and the widths each is written at.
 */
export const LANDING_IMAGES = {
  hero: { widths: [960, 1440, 1920, 2560], width: 1920, height: 1080 },
  heroPortrait: { widths: [720, 1080, 1440], width: 1080, height: 1620 },
  seat: { widths: [720, 1080, 1440], width: 1440, height: 810 },
  aisle: { widths: [600, 1000], width: 1000, height: 1250 },
  rows: { widths: [640, 960], width: 960, height: 640 },
  screen: { widths: [640, 960], width: 960, height: 640 },
  finale: { widths: [960, 1440, 2048], width: 2048, height: 857 },
  finalePortrait: { widths: [720, 1080], width: 1080, height: 1350 },
} as const;

/** Each film the auditorium can show, with the attribution its licence asks for. */
const FILM_CREDITS = FILMS.map(
  (film) =>
    `<li><em>${film.title}</em> — <a href="${film.creditUrl}" rel="noopener noreferrer">${film.credit}</a> · <a href="${film.licenseUrl}" rel="noopener noreferrer">${film.license}</a></li>`,
).join('');

const srcset = (name: string, widths: readonly number[], ext = 'webp') => widths.map((w) => `${IMG}/${name}-${w}.${ext} ${w}w`).join(', ');

/**
 * A picture of the room in a frame: WebP at its widths, the JPEG for browsers without WebP, its
 * size reserved; below the first screen, so it loads lazily. `portrait` is the cut for tall screens.
 */
function framePicture(
  name: string,
  image: { widths: readonly number[]; width: number; height: number },
  jpeg: number,
  sizes: string,
  alt: string,
  portrait?: { name: string; image: { widths: readonly number[]; width: number; height: number }; jpeg: number },
): string {
  const tall = portrait
    ? `<source media="(max-aspect-ratio: 4/5)" type="image/webp" srcset="${srcset(portrait.name, portrait.image.widths)}" sizes="${sizes}">
<source media="(max-aspect-ratio: 4/5)" type="image/jpeg" srcset="${IMG}/${portrait.name}-${portrait.jpeg}.jpg ${portrait.jpeg}w" sizes="${sizes}">\n`
    : '';
  return `<picture>
${tall}<source type="image/webp" srcset="${srcset(name, image.widths)}" sizes="${sizes}">
<img class="frame__image" src="${IMG}/${name}-${jpeg}.jpg" width="${image.width}" height="${image.height}" alt="${alt}" loading="lazy" decoding="async">
</picture>`;
}

/** The small print at the top of a frame: its number on the strip, then its name. */
const frameLabel = (number: string, name: string) => `<p class="frame__label"><span class="frame__number">${number}</span>${name}</p>`;

/** Frame 03: three corners of the room, one for each thing the auditorium lets you do. */
const SHOTS = [
  {
    name: 'frame-aisle',
    image: LANDING_IMAGES.aisle,
    jpeg: 1000,
    title: 'Khám phá',
    text: 'Đi một vòng tham quan, hoặc tự bước giữa các lối đi.',
    alt: 'Bậc lối đi bên phải nhìn lên phía cuối phòng: đèn chân bậc, tay vịn và các hàng ghế đỏ.',
  },
  {
    name: 'frame-rows',
    image: LANDING_IMAGES.rows,
    jpeg: 960,
    title: 'Chọn ghế',
    text: '110 ghế trên mười hàng, chọn ngay trong phòng hoặc trên sơ đồ.',
    alt: 'Các hàng ghế đỏ dốc lên phía cuối phòng, nhìn từ cạnh bục màn chiếu.',
  },
  {
    name: 'frame-screen',
    image: LANDING_IMAGES.screen,
    jpeg: 960,
    title: 'Xem phim',
    text: 'Phát phim trên màn chiếu khi bạn sẵn sàng; không có gì tự chạy.',
    alt: 'Màn chiếu và rèm đỏ, nhìn chéo từ lối đi bên trái qua các hàng ghế.',
  },
];

export function wordmarkHtml(className = 'wordmark'): string {
  return `<a class="${className}" href="/" aria-label="${BRAND.name}, trang chủ">${markImg()}<span class="wordmark__text" aria-hidden="true"><span class="wordmark__name">${BRAND.wordmark.name}</span><span class="wordmark__suffix">${BRAND.wordmark.suffix}</span></span></a>`;
}

export function landingHtml(): string {
  const { hero, heroPortrait } = LANDING_IMAGES;
  const cta = (label: string, extra = '') => `<a class="button button--primary${extra}" href="${CINEMA_PATH}" data-cta="cinema">${label}</a>`;
  return `<div class="landing" data-landing>
<a class="skip-link" href="#noi-dung">Bỏ qua, tới nội dung chính</a>
<header class="site-header">
${wordmarkHtml()}
<nav class="site-nav" aria-label="Các phần của trang">
<a href="#goc-nhin">Góc nhìn</a>
<a href="#kham-pha">Khám phá</a>
</nav>
<a class="button button--small" href="${CINEMA_PATH}" data-cta="cinema">Vào rạp</a>
</header>
<div class="filmstrip">
<main id="noi-dung" tabindex="-1">
<section class="frame hero" aria-labelledby="hero-title">
<div class="hero__media">
<picture>
<source media="(max-aspect-ratio: 4/5)" type="image/webp" srcset="${srcset('hero-portrait', heroPortrait.widths)}" sizes="100vw">
<source media="(max-aspect-ratio: 4/5)" type="image/jpeg" srcset="${IMG}/hero-portrait-1080.jpg 1080w" sizes="100vw">
<source type="image/webp" srcset="${srcset('hero', hero.widths)}" sizes="92vw">
<img class="hero__image" src="${IMG}/hero-1920.jpg" width="${hero.width}" height="${hero.height}" alt="Khán phòng 3D: các hàng ghế đỏ dốc dần về phía màn chiếu." fetchpriority="high" decoding="async">
</picture>
</div>
<div class="hero__shade" aria-hidden="true"></div>
<div class="hero__content">
<p class="eyebrow hero__brand">${markImg(40)}<span>${BRAND.name}</span></p>
<h1 id="hero-title">Bước vào rạp. Chọn góc nhìn của bạn.</h1>
<p class="hero__lead">Một khán phòng 3D dựng ngay trên trình duyệt.<span class="hero__tagline">Khám phá không gian. Chọn ghế. Thưởng thức bộ phim.</span></p>
<div class="hero__actions">
${cta('Vào rạp')}
<a class="button button--ghost" href="#goc-nhin">Xem trải nghiệm</a>
</div>
<p class="hero__note">${BRAND.demoNote}</p>
</div>
</section>
<section class="frame frame--seat" id="goc-nhin" aria-labelledby="seat-title" tabindex="-1">
<figure class="frame__media" data-reveal>
${framePicture('frame-seat', LANDING_IMAGES.seat, 1080, '(min-width: 960px) 56vw, 92vw', 'Màn chiếu và rèm đỏ nhìn từ ghế F06, giữa phòng, qua lưng các hàng ghế phía trước.')}
<figcaption class="frame__caption">Từ ghế F06</figcaption>
</figure>
<div class="frame__text" data-reveal>
${frameLabel('02', 'Góc nhìn')}
<h2 id="seat-title">Chọn góc nhìn của bạn</h2>
<p>Chạm một ghế trong phòng hoặc trên sơ đồ, rồi chọn “Xem từ ghế này”: màn chiếu hiện ra đúng như khi bạn ngồi ở đó.</p>
<p class="frame__aside">110 ghế, mười hàng từ A đến J · màn chiếu 16:9 rộng 8,5 m</p>
</div>
</section>
<section class="frame frame--explore" id="kham-pha" aria-labelledby="explore-title" tabindex="-1">
<div class="frame__text" data-reveal>
${frameLabel('03', 'Khám phá')}
<h2 id="explore-title">Khám phá không gian</h2>
<p>Bậc ghế, lối đi, vách cách âm và ánh sáng, dựng bằng 3D: bạn tự chọn chỗ đứng, chỗ ngồi và lúc bắt đầu phim.</p>
</div>
<ul class="reel">
${SHOTS.map(
  (shot) => `<li class="reel__shot" data-reveal>
${framePicture(shot.name, shot.image, shot.jpeg, '(min-width: 960px) 30vw, 92vw', shot.alt)}
<div class="reel__caption">
<h3>${shot.title}</h3>
<p>${shot.text}</p>
</div>
</li>`,
).join('\n')}
</ul>
</section>
<section class="frame frame--finale" aria-labelledby="finale-title">
<div class="frame__media frame__media--wide" data-reveal>
${framePicture('frame-finale', LANDING_IMAGES.finale, 1440, '92vw', 'Khán phòng nhìn thẳng từ cuối lối giữa: các hàng ghế đỏ, màn chiếu và rèm hai bên.', { name: 'frame-finale-portrait', image: LANDING_IMAGES.finalePortrait, jpeg: 1080 })}
</div>
<div class="frame__text frame__text--centred" data-reveal>
${frameLabel('04', 'Vào rạp')}
<h2 id="finale-title">Đèn đã dịu. Mời bạn vào rạp.</h2>
<p>Thử vài góc nhìn, ngồi vào những chỗ khác nhau và chọn chỗ bạn thích nhất.</p>
${cta('Bước vào rạp', ' button--large')}
<p class="frame__aside">Bản demo tương tác: ghế, sơ đồ và trạng thái “đã đặt” là dữ liệu minh họa. Không bán vé, không giữ chỗ.</p>
</div>
</section>
</main>
<footer class="site-footer">
<p class="site-footer__brand">${BRAND.name} · ${BRAND.demoNote}</p>
<p>Phim trong phòng chiếu:</p>
<ul class="site-footer__films">${FILM_CREDITS}</ul>
<p>Hình ảnh trên trang được kết xuất từ chính khán phòng 3D này.</p>
</footer>
</div>
</div>`;
}
