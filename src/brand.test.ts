import { describe, expect, it } from 'vitest';
import { BRAND, webAppManifest } from './brand.ts';
import { matchRoute } from './router.ts';

/** The install icons in public/, as data URLs (`/brand/icon-192.png` → its bytes). */
const files = import.meta.glob<string>('/public/brand/icon-*.png', { query: '?inline', import: 'default', eager: true });
const icon = (src: string) => files[`/public${src}`];

/** A PNG's signature and size, from its header. */
function pngHeader(dataUrl: string) {
  const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), (c) => c.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  return { signature: [...bytes.subarray(1, 4)].map((b) => String.fromCharCode(b)).join(''), width: view.getUint32(16), height: view.getUint32(20) };
}

describe('web app manifest', () => {
  const manifest = webAppManifest();

  it('opens the auditorium as a standalone app named for the Home Screen', () => {
    expect(manifest).toMatchObject({ name: 'Tân Phong Cinema', short_name: 'TP Cinema', start_url: '/cinema', scope: '/', display: 'standalone', lang: 'vi' });
    expect(manifest.id).toBe('/cinema');
    expect(matchRoute(manifest.start_url, '')).toBe('cinema');
    expect(manifest.start_url.startsWith(manifest.scope)).toBe(true);
  });

  it('takes its colours from the auditorium page (that page is this colour: yarn capture)', () => {
    expect(manifest.theme_color).toBe(BRAND.colors.room);
    expect(manifest.background_color).toBe(BRAND.colors.room);
  });

  it('lists 192 and 512 px icons that exist at those sizes, and one maskable icon', () => {
    for (const { src, sizes, type } of manifest.icons) {
      const file = icon(src);
      expect(file, src).toBeDefined();
      const header = pngHeader(file);
      expect(type).toBe('image/png');
      expect(header.signature).toBe('PNG');
      expect(`${header.width}x${header.height}`).toBe(sizes);
    }
    const any = manifest.icons.filter((i) => i.purpose === 'any').map((i) => i.sizes);
    expect(any).toEqual(['192x192', '512x512']);
    expect(manifest.icons.filter((i) => i.purpose === 'maskable').map((i) => i.sizes)).toEqual(['512x512']);
  });
});
