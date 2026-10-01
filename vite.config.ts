import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { visualizer } from 'rollup-plugin-visualizer';

// https://vitejs.dev/config/
// Set by the gym-app compose stack: no browser to open, and bind mounts from Windows don't emit file events.
const inDocker = process.env.GYM_DOCKER === '1';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'script',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Daily Grind',
        short_name: 'Daily Grind',
        description: 'AI-powered workout tracker. Tell the AI your goals and get a personalised training plan.',
        theme_color: '#F2F2F7',
        background_color: '#F2F2F7',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          {
            src: 'icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
      },
    }),
    // Only active when ANALYZE=1 — run with: npm run build:analyze
    ...(process.env.ANALYZE === '1'
      ? [visualizer({ open: true, filename: 'dist/bundle-stats.html', gzipSize: true, brotliSize: true })]
      : []),
  ],
  base: '',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
    sourcemap: false,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'vendor-auth', test: /node_modules[\\/]@supabase[\\/]/ },
          ],
        },
      },
    },
  },
  server: {
    // Fixed (not auto-incremented): the API CORS allowlist and auth redirects depend on this exact origin.
    port: 5180,
    strictPort: true,
    // In the gym-app stack the API runs in its own container; same-origin /api calls are proxied to it,
    // exactly as they are served from one origin on Vercel.
    proxy: inDocker ? { '/api': 'http://api:3010' } : undefined,
    open: !inDocker,
    watch: inDocker ? { usePolling: true, interval: 300 } : undefined
  }
});
