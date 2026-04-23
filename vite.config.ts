import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      // Activate new service workers immediately and claim existing clients
      // so a deploy picks up on the very next page load (not the one after).
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        // Don't cache index.html — always fetch fresh so new JS bundles load.
        navigateFallbackDenylist: [/^\/api/],
        cleanupOutdatedCaches: true
      },
      manifest: {
        name: 'HFFNY Box Office',
        short_name: 'HFFNY BO',
        description: 'HFFNY festival box office — comps, cash, reporting',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'landscape',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      }
    })
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') }
  },
  server: { host: true, port: 5173 }
});
