import { defineConfig } from 'vite';

// Single-page app: the dev server and `vite preview` fall back to index.html for /cinema.
export default defineConfig({
  appType: 'spa',
});
