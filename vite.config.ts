import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const web = fileURLToPath(new URL('./src/web', import.meta.url));
// `npm run dev` serves the API here; Vite proxies to it so the app and the API
// share an origin, as they do behind Tailscale Serve.
const api = `http://127.0.0.1:${process.env.PORT ?? 3000}`;

export default defineConfig({
  root: web,
  publicDir: 'public',
  resolve: { alias: { '@': web } },
  // Shown under More, to tell which build a phone is running.
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'script-defer',
      manifest: {
        name: 'Fermentation Log',
        short_name: 'Ferment',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#fafaf9',
        theme_color: '#7f1d1d',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The app shell (SPEC §8.5). API reads are kept by the app itself
        // (src/web/lib/query.ts); photos never change, so they are cached here.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/media\//, /^\/healthz/],
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/media/'),
            handler: 'CacheFirst',
            options: { cacheName: 'media', expiration: { maxEntries: 500 }, cacheableResponse: { statuses: [200] } },
          },
        ],
      },
    }),
  ],
  build: { outDir: '../../dist/web', emptyOutDir: true },
  server: {
    proxy: { '/api': api, '/media': api },
  },
});
