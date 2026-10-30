import { describe, expect, it, vi } from 'vitest';
import { BRAND, markImg, PAGE_TITLES } from '../brand.ts';
import { FILMS } from '../films.ts';
import { isPlainClick, matchRoute } from '../router.ts';
import { landingHtml, LANDING_IMAGES, WAYS } from './content.ts';
import { createLoader, savesData } from './loader.ts';

describe('routes', () => {
  it('maps paths to pages', () => {
    expect(matchRoute('/', '')).toBe('landing');
    expect(matchRoute('', '')).toBe('landing');
    expect(matchRoute('/cinema', '')).toBe('cinema');
    expect(matchRoute('/cinema/', '?film=x.mp4')).toBe('cinema');
    expect(matchRoute('/cinema', '?inspect=seat')).toBe('inspector');
    expect(matchRoute('/cinema', '?inspect=other')).toBe('cinema');
    expect(matchRoute('/cinema/seats', '')).toBe('not-found');
    expect(matchRoute('/index.html', '')).toBe('not-found');
  });

  it('takes over only plain clicks; modified and middle clicks open tabs as usual', () => {
    const click = { button: 0, defaultPrevented: false, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
    expect(isPlainClick(click)).toBe(true);
    expect(isPlainClick({ ...click, ctrlKey: true })).toBe(false);
    expect(isPlainClick({ ...click, metaKey: true })).toBe(false);
    expect(isPlainClick({ ...click, shiftKey: true })).toBe(false);
    expect(isPlainClick({ ...click, altKey: true })).toBe(false);
    expect(isPlainClick({ ...click, button: 1 })).toBe(false);
    expect(isPlainClick({ ...click, defaultPrevented: true })).toBe(false);
    expect(isPlainClick(click, '_blank')).toBe(false);
  });
});

describe('loader', () => {
  it('shares one request between callers and keeps the result', async () => {
    const load = vi.fn(async () => 'module');
    const loader = createLoader(load);
    expect(loader.state).toBe('idle');
    loader.preload();
    loader.preload();
    const [a, b] = await Promise.all([loader.get(), loader.get()]);
    expect(a).toBe('module');
    expect(b).toBe('module');
    expect(load).toHaveBeenCalledTimes(1);
    expect(loader.state).toBe('loaded');
  });

  it('forgets a failure: an early start fails quietly, the next call tries again', async () => {
    let attempt = 0;
    const loader = createLoader(async () => {
      attempt++;
      if (attempt === 1) throw new Error('offline');
      return 'module';
    });
    // An unhandled rejection would fail this run (Vitest reports them as errors).
    loader.preload();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loader.state).toBe('idle');
    await expect(loader.get()).resolves.toBe('module');
    expect(attempt).toBe(2);
  });

  it('reads Save-Data when the browser exposes it', () => {
    expect(savesData({ connection: { saveData: true } } as unknown as Navigator)).toBe(true);
    expect(savesData({ connection: { saveData: false } } as unknown as Navigator)).toBe(false);
    expect(savesData({} as Navigator)).toBe(false);
  });
});

describe('landing content', () => {
  const html = landingHtml();

  it('has the agreed copy, one h1, and real links into the auditorium', () => {
    expect(html).toContain('<span class="hero__line">Một chỗ ngồi.</span> <span class="hero__line">Một góc nhìn riêng.</span>');
    expect(html).toContain('Khám phá khán phòng 3D, chọn ghế và thưởng thức bộ phim.');
    expect(html).toContain('Khám phá không gian <span aria-hidden="true">↓</span>');
    expect(html).toContain('Đèn đã dịu. Mời bạn vào rạp.');
    expect(html).toContain(BRAND.demoNote);
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    // The header's "Vào rạp", the hero's "Vào rạp" and the invitation's "Bước vào rạp".
    expect(html.match(/href="\/cinema" data-cta="cinema">(Vào rạp|Bước vào rạp)</g)).toHaveLength(3);
    expect(html.match(/href="#trai-nghiem"/g)).toHaveLength(2);
    expect(html).toContain('id="trai-nghiem"');
    expect(html).toContain('class="skip-link" href="#noi-dung"');
  });

  it('has three parts and no film strip; the logo once, in the header', () => {
    expect(html.match(/<section class="(hero|experience|finale)"/g)).toEqual(['<section class="hero"', '<section class="experience"', '<section class="finale"']);
    expect(html).not.toMatch(/filmstrip|class="frame|reel__/);
    expect(html.match(/class="brand-mark"/g)).toHaveLength(1);
  });

  it('offers three things the auditorium does, each with its own picture, sentence and sketch, readable without the script', () => {
    expect(WAYS.map((w) => w.title)).toEqual(['Tham quan tự động', 'Đi bộ trong rạp', 'Xem từ ghế này']);
    // The sketches are drawings: hidden from assistive technology.
    expect(html.match(/<div class="sketch sketch--[a-z-]+" aria-hidden="true">/g)).toHaveLength(3);
    expect(new Set(WAYS.map((w) => w.name)).size).toBe(3);
    for (const way of WAYS) {
      expect(html).toContain(`<p class="way__text">${way.text}</p>`);
      expect(html).toContain(`data-way="${way.id}"`);
      expect(html).toContain(`/brand/${way.name}-1080.jpg`);
    }
    // One picture shown before any choice: the first.
    expect(html.match(/class="experience__shot" data-way="[^"]+" data-active/g)).toHaveLength(1);
  });

  it('loads the hero at once and the pictures below lazily, all with their size reserved', () => {
    const hero = /<img class="hero__image"[^>]*>/.exec(html)![0];
    expect(hero).toContain('fetchpriority="high"');
    expect(hero).not.toContain('loading="lazy"');
    expect(hero).toContain(`width="${LANDING_IMAGES.hero.width}" height="${LANDING_IMAGES.hero.height}"`);
    const below = html.match(/<img (?!class="hero__image")[^>]*>/g)!.filter((img) => !img.includes('brand-mark'));
    // Three ways, the room at the end, three films.
    expect(below).toHaveLength(7);
    expect(below.every((img) => img.includes('loading="lazy"') && /width="\d+" height="\d+"/.test(img) && /alt="[^"]{12,}"/.test(img))).toBe(true);
    expect(html).not.toMatch(/data:image|base64/);
  });

  it('shows the three films on the screen in a strip, each with its length, studio and licence', () => {
    const films = [...html.matchAll(/<li class="film"[\s\S]*?<\/li>/g)].map((m) => m[0]);
    expect(films).toHaveLength(FILMS.length);
    FILMS.forEach((film, i) => {
      expect(films[i]).toContain(`<h3 class="film__title">${film.title}</h3>`);
      expect(films[i]).toContain(`${film.length} · ${film.studio} · ${film.license}`);
      // Its still comes from the landing page's pictures, never from the films' own files.
      expect(films[i]).toMatch(/src="\/brand\/film-[a-z0-9-]+-800\.webp"/);
      expect(films[i]).not.toContain('/media/');
    });
    expect(html.indexOf('class="films__strip"')).toBeLessThan(html.indexOf('Bước vào rạp'));
  });

  it('makes no claims a demo cannot back (prices, showtimes, reviews, user counts)', () => {
    expect(html).not.toMatch(/giá vé|lịch chiếu|suất chiếu|đánh giá|khách hàng|lượt|VNĐ|đ\/vé/i);
    expect(html).toContain('Không bán vé');
  });

  it('credits the film used inside the auditorium', () => {
    expect(html).toContain('(c) copyright 2008, Blender Foundation / www.bigbuckbunny.org');
    expect(html).toContain('© 2017 Blender Animation Studio, Amsterdam / dailydweebs.com');
    expect(html).toContain('© Blender Foundation / Blender Institute, caminandes.com');
    expect(html).toContain('CC BY 3.0');
  });

  it('keeps names and titles in one place', () => {
    expect(PAGE_TITLES.cinema).toContain(BRAND.name);
    // The mark is the logo image, decorative, the same file at every size.
    expect(markImg()).toContain('alt=""');
    expect(markImg(40)).toContain('src="/brand/logo-128.webp"');
    expect(html).toContain('/brand/logo-64.webp 64w');
    expect(html).toContain(`${BRAND.name}, trang chủ`);
  });
});
