import { describe, expect, it, vi } from 'vitest';
import { BRAND, markImg, PAGE_TITLES } from '../brand.ts';
import { isPlainClick, matchRoute } from '../router.ts';
import { landingHtml, LANDING_IMAGES } from './content.ts';
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
    expect(html).toContain('Trải nghiệm cinema 3D');
    expect(html).toContain('Bước vào rạp. Chọn góc nhìn của bạn.');
    expect(html).toContain('Khám phá khán phòng, chọn một chỗ ngồi và xem màn chiếu từ chính vị trí đó.');
    expect(html).toContain(BRAND.demoNote);
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    expect(html.match(/href="\/cinema" data-cta="cinema"/g)?.length).toBe(3);
    expect(html).toContain('href="#cach-su-dung"');
    expect(html).toContain('id="cach-su-dung"');
    expect(html).toContain('id="trai-nghiem"');
    expect(html).toContain('class="skip-link" href="#noi-dung"');
    expect(html.match(/<li class="step">/g)).toHaveLength(3);
  });

  it('loads the hero at once and the step pictures lazily, all with their size reserved', () => {
    const hero = /<img class="hero__image"[^>]*>/.exec(html)![0];
    expect(hero).toContain('fetchpriority="high"');
    expect(hero).not.toContain('loading="lazy"');
    expect(hero).toContain(`width="${LANDING_IMAGES.hero.width}" height="${LANDING_IMAGES.hero.height}"`);
    const steps = html.match(/<img class="step__image"[^>]*>/g)!;
    expect(steps).toHaveLength(3);
    expect(steps.every((img) => img.includes('loading="lazy"') && /width="\d+" height="\d+"/.test(img))).toBe(true);
    expect(html).not.toMatch(/data:image|base64/);
  });

  it('makes no claims a demo cannot back (prices, showtimes, reviews, user counts)', () => {
    expect(html).not.toMatch(/giá vé|lịch chiếu|suất chiếu|đánh giá|khách hàng|lượt|VNĐ|đ\/vé/i);
    expect(html).toContain('Không bán vé');
  });

  it('credits the film used inside the auditorium', () => {
    expect(html).toContain('(c) copyright 2008, Blender Foundation / www.bigbuckbunny.org');
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
