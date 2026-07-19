import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Standalone Vite config for the DESIGN PREVIEW only. No crxjs — this serves
// preview/index.html as a plain SPA so the redesigned side panel can be viewed
// in an ordinary browser tab with a mocked chrome.* API. `npm run preview:ui`.
export default defineConfig({
  root: resolve(__dirname, 'preview'),
  plugins: [react()],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  server: {
    port: 5199,
    strictPort: true,
  },
});
