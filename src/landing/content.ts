import { BRAND, markImg } from '../brand.ts';
import { FILMS } from '../films.ts';
import { CINEMA_PATH } from '../router.ts';

/**
 * The landing page as HTML, from one source: Vite writes it into index.html at build time (so `/`
 * has its content and links before, or without, JavaScript), and the app renders the same markup
 * when it comes back to `/` from the auditorium. Everything here is static text; nothing comes from
 * the URL or the user.
 *
 * Images are renders of this auditorium (scripts/capture-brand-assets.mjs), with a neutral slate on
 * the screen instead of a film frame.
 */

const IMG = '/brand';

/** Rendered sizes, so the page reserves the right space before the images arrive (no layout shift). */
export const LANDING_IMAGES = {
  hero: { widths: [960, 1440, 1920, 2560], width: 1920, height: 1080 },
  heroPortrait: { widths: [720, 1080, 1440], width: 1080, height: 1620 },
  steps: { widths: [640, 960], width: 960, height: 640 },
} as const;

/** Each film the auditorium can show, with the attribution its licence asks for. */
const FILM_CREDITS = FILMS.map(
  (film) =>
    `<li><em>${film.title}</em> — <a href="${film.creditUrl}" rel="noopener noreferrer">${film.credit}</a> · <a href="${film.licenseUrl}" rel="noopener noreferrer">${film.license}</a></li>`,
).join('');

const srcset = (name: string, widths: readonly number[], ext: string) => widths.map((w) => `${IMG}/${name}-${w}.${ext} ${w}w`).join(', ');

const STEPS = [
  {
    title: 'Khám phá khán phòng',
    text: 'Ở “Khám phá”, chọn một góc nhìn có sẵn, để chuyến tham quan đưa bạn đi một vòng, hoặc tự đi bộ giữa các lối đi bằng phím W A S D hay cần điều khiển trên màn hình cảm ứng.',
    alt: 'Lối đi bên phải của khán phòng, nhìn từ tầm mắt người đứng.',
  },
  {
    title: 'Chọn ghế và xem góc nhìn',
    text: 'Ở “Chọn ghế”, chạm một ghế trong phòng hoặc trên sơ đồ, rồi bấm “Xem từ ghế này” để thấy màn chiếu từ đúng chỗ ngồi đó.',
    alt: 'Sơ đồ ghế trong bảng kính bên phải khán phòng, hai ghế đang được chọn.',
  },
  {
    title: 'Phát video trên màn chiếu',
    text: 'Chọn “Xem phim” ở thanh tác vụ phía dưới (trên điện thoại: trong nút tròn) rồi bấm Phát. Video không tự chạy; bạn tạm dừng, tua và tắt tiếng lúc nào cũng được.',
    alt: 'Màn chiếu nhìn từ một ghế giữa phòng, trình phát phim nằm trên thanh kính ở phía dưới.',
  },
];

export function wordmarkHtml(className = 'wordmark'): string {
  return `<a class="${className}" href="/" aria-label="${BRAND.name}, trang chủ">${markImg()}<span class="wordmark__text" aria-hidden="true"><span class="wordmark__name">${BRAND.wordmark.name}</span><span class="wordmark__suffix">${BRAND.wordmark.suffix}</span></span></a>`;
}

export function landingHtml(): string {
  const { hero, heroPortrait, steps } = LANDING_IMAGES;
  const cta = (label: string, extra = '') => `<a class="button button--primary${extra}" href="${CINEMA_PATH}" data-cta="cinema">${label}</a>`;
  return `<div class="landing" data-landing>
<a class="skip-link" href="#noi-dung">Bỏ qua, tới nội dung chính</a>
<header class="site-header">
${wordmarkHtml()}
<nav class="site-nav" aria-label="Các phần của trang">
<a href="#trai-nghiem">Trải nghiệm</a>
<a href="#cach-su-dung">Cách sử dụng</a>
</nav>
<a class="button button--small" href="${CINEMA_PATH}" data-cta="cinema">Vào rạp</a>
</header>
<main id="noi-dung" tabindex="-1">
<section class="hero" aria-labelledby="hero-title">
<div class="hero__media">
<picture>
<source media="(max-aspect-ratio: 4/5)" type="image/webp" srcset="${srcset('hero-portrait', heroPortrait.widths, 'webp')}" sizes="100vw">
<source media="(max-aspect-ratio: 4/5)" type="image/jpeg" srcset="${IMG}/hero-portrait-1080.jpg 1080w" sizes="100vw">
<source type="image/webp" srcset="${srcset('hero', hero.widths, 'webp')}" sizes="100vw">
<img class="hero__image" src="${IMG}/hero-1920.jpg" width="${hero.width}" height="${hero.height}" alt="Khán phòng 3D: các hàng ghế đỏ dốc dần về phía màn chiếu." fetchpriority="high" decoding="async">
</picture>
</div>
<div class="hero__shade" aria-hidden="true"></div>
<div class="hero__content">
<p class="eyebrow">Trải nghiệm cinema 3D</p>
<h1 id="hero-title">Bước vào rạp. Chọn góc nhìn của bạn.</h1>
<p class="hero__lead">Khám phá khán phòng, chọn một chỗ ngồi và xem màn chiếu từ chính vị trí đó.</p>
<div class="hero__actions">
${cta('Bước vào rạp')}
<a class="button button--ghost" href="#cach-su-dung">Cách trải nghiệm</a>
</div>
<p class="hero__note">${BRAND.demoNote}</p>
</div>
</section>
<section class="section experience" id="trai-nghiem" aria-labelledby="experience-title" tabindex="-1">
<div class="section__inner">
<h2 id="experience-title">Một khán phòng bạn có thể bước vào</h2>
<p class="section__lead">Phòng chiếu được dựng bằng 3D ngay trong trình duyệt: bậc ghế, lối đi, vách cách âm, ánh sáng và màn chiếu. Bạn tự chọn chỗ đứng, chỗ ngồi và lúc bắt đầu phim.</p>
<ul class="facts">
<li><strong>110 ghế</strong><span>10 hàng từ A đến J, 11 ghế mỗi hàng</span></li>
<li><strong>Màn chiếu 16:9</strong><span>rộng 8,5 m, nhìn được từ từng ghế</span></li>
<li><strong>Ngay trên trình duyệt</strong><span>không cần cài đặt; cần WebGL</span></li>
</ul>
</div>
</section>
<section class="section steps" id="cach-su-dung" aria-labelledby="steps-title" tabindex="-1">
<div class="section__inner">
<h2 id="steps-title">Cách sử dụng</h2>
<ol class="steps__list">
${STEPS.map(
  (step, i) => `<li class="step">
<img class="step__image" src="${IMG}/step-${i + 1}-960.jpg" srcset="${srcset(`step-${i + 1}`, steps.widths, 'webp')}" sizes="(min-width: 960px) 30vw, (min-width: 640px) 45vw, 92vw" width="${steps.width}" height="${steps.height}" alt="${step.alt}" loading="lazy" decoding="async">
<h3><span class="step__number" aria-hidden="true">${i + 1}</span>${step.title}</h3>
<p>${step.text}</p>
</li>`,
).join('\n')}
</ol>
</div>
</section>
<section class="section closing" aria-labelledby="closing-title">
<div class="section__inner">
<h2 id="closing-title">Sẵn sàng vào rạp?</h2>
<p class="section__lead">Thử vài góc nhìn, ngồi vào những chỗ khác nhau và chọn chỗ bạn thích nhất.</p>
${cta('Bước vào rạp')}
<p class="closing__note">Bản demo tương tác: ghế, sơ đồ và trạng thái “đã đặt” là dữ liệu minh họa. Không bán vé, không giữ chỗ.</p>
</div>
</section>
</main>
<footer class="site-footer">
<div class="section__inner">
<p class="site-footer__brand">${BRAND.name} · ${BRAND.demoNote}</p>
<p>Phim trong phòng chiếu:</p>
<ul class="site-footer__films">${FILM_CREDITS}</ul>
<p>Hình ảnh trên trang được kết xuất từ chính khán phòng 3D này.</p>
</div>
</footer>
</div>`;
}
