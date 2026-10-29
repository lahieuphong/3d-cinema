import { defineConfig, type HtmlTagDescriptor, type Plugin } from 'vite';
import { BRAND, markImg, PAGE_TITLES } from './src/brand.ts';
import { landingHtml } from './src/landing/content.ts';
import { cinemaPageSkeleton } from './src/skeleton.ts';

/**
 * Two HTML documents, one app: `/` is index.html (the landing page, written in at build time, so it
 * reads and links without JavaScript), `/cinema` is cinema.html (a short "opening" screen). Both load
 * src/main.ts, which routes inside the app from then on. Each document carries its own title,
 * description and share data for crawlers that do not run scripts. Hosting maps `/cinema` to
 * cinema.html (vercel.json); the dev and preview servers do it here.
 */
function sitePages(): Plugin {
  const toCinemaDocument = (req: { url?: string }) => {
    if (req.url && /^\/cinema\/?(?:[?#]|$)/.test(req.url)) req.url = req.url.replace(/^\/cinema\/?/, '/cinema.html');
  };
  return {
    name: 'site-pages',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        toCinemaDocument(req as unknown as { url?: string });
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, _res, next) => {
        toCinemaDocument(req as unknown as { url?: string });
        next();
      });
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const cinema = /cinema\.html$/.test(ctx.filename);
        const page = cinema
          ? { path: '/cinema', title: PAGE_TITLES.cinema, description: BRAND.cinemaDescription }
          : { path: '/', title: PAGE_TITLES.landing, description: BRAND.description };
        const meta = (attrs: Record<string, string>): HtmlTagDescriptor => ({ tag: 'meta', attrs, injectTo: 'head' });
        const image = `${BRAND.origin}${BRAND.shareImage}`;
        const tags: HtmlTagDescriptor[] = [
          { tag: 'title', children: page.title, injectTo: 'head' },
          meta({ name: 'description', content: page.description }),
          meta({ name: 'theme-color', content: BRAND.colors.charcoal }),
          meta({ name: 'color-scheme', content: 'dark' }),
          { tag: 'link', attrs: { rel: 'canonical', href: `${BRAND.origin}${page.path}` }, injectTo: 'head' },
          { tag: 'link', attrs: { rel: 'icon', href: '/favicon.png', type: 'image/png', sizes: '64x64' }, injectTo: 'head' },
          { tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }, injectTo: 'head' },
          meta({ property: 'og:type', content: 'website' }),
          meta({ property: 'og:site_name', content: BRAND.name }),
          meta({ property: 'og:locale', content: BRAND.locale }),
          meta({ property: 'og:title', content: page.title }),
          meta({ property: 'og:description', content: page.description }),
          meta({ property: 'og:url', content: `${BRAND.origin}${page.path}` }),
          meta({ property: 'og:image', content: image }),
          meta({ property: 'og:image:width', content: '1200' }),
          meta({ property: 'og:image:height', content: '630' }),
          meta({ property: 'og:image:alt', content: 'Khán phòng 3D với các hàng ghế đỏ hướng về màn chiếu.' }),
          meta({ name: 'twitter:card', content: 'summary_large_image' }),
        ];
        // /cinema opens on a skeleton of itself (the words on its screen; the timer in cinema.html
        // finds them by data-boot-text).
        const opening = cinemaPageSkeleton('<span class="shimmer-text" data-boot-text>Đang mở phòng chiếu…</span>');
        const body = (cinema ? html.replace('<!--cinema-skeleton-->', opening) : html.replace('<!--landing-->', landingHtml())).replaceAll('<!--mark-->', markImg(56));
        return { html: body, tags };
      },
    },
  };
}

/**
 * cinema.html (build only): declares the auditorium page's own chunks and stylesheet up front, so a
 * visit straight to /cinema fetches them alongside the entry instead of after it. index.html gets
 * nothing of the sort: the landing page loads none of the auditorium until asked.
 */
function cinemaPreload(): Plugin {
  return {
    name: 'cinema-preload',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (!/cinema\.html$/.test(ctx.filename) || !ctx.bundle) return;
        const chunks = Object.values(ctx.bundle);
        const page = chunks.find((c) => c.type === 'chunk' && /[\\/]src[\\/]cinema[\\/]page\.ts$/.test(c.facadeModuleId ?? ''));
        if (!page || page.type !== 'chunk') return;
        // The page chunk and the chunks it imports, minus the script the document already loads.
        const loaded = new Set([...html.matchAll(/<script type="module"[^>]*src="\/([^"]+)"/g)].map((m) => m[1]));
        const owned = [page, ...page.imports.map((file) => ctx.bundle![file])].filter(
          (c): c is typeof page => c?.type === 'chunk' && !loaded.has(c.fileName),
        );
        const files = owned.map((c) => c.fileName);
        const css = [...new Set(owned.flatMap((c) => [...(c.viteMetadata?.importedCss ?? [])]))];
        return [
          ...files.map((file): HtmlTagDescriptor => ({ tag: 'link', attrs: { rel: 'modulepreload', crossorigin: '', href: `/${file}` }, injectTo: 'head' })),
          ...css.map((file): HtmlTagDescriptor => ({ tag: 'link', attrs: { rel: 'stylesheet', crossorigin: '', href: `/${file}` }, injectTo: 'head' })),
        ];
      },
    },
  };
}

export default defineConfig({
  // Unknown paths fall back to index.html, whose script shows "not found".
  appType: 'spa',
  plugins: [sitePages(), cinemaPreload()],
  build: {
    rolldownOptions: {
      input: { index: 'index.html', cinema: 'cinema.html' },
    },
  },
});
