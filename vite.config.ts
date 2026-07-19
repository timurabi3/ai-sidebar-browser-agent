import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import { resolve } from 'node:path';
import manifest from './src/manifest.config';

// crxjs wires up the MV3 manifest, content-script HMR and the side-panel HTML
// entry into a single Vite build. See src/manifest.config.ts for entry points.
export default defineConfig({
  plugins: [react(), crx({ manifest })],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    // crxjs needs a stable HMR port for the content-script client.
    port: 5173,
    strictPort: true,
    hmr: { port: 5173 },
  },
  build: {
    target: 'esnext',
    sourcemap: true,
    rollupOptions: {
      // The side panel is the only HTML entry; background + content scripts
      // are declared in the manifest and picked up by crxjs automatically.
      input: {
        sidepanel: resolve(__dirname, 'index.html'),
      },
    },
  },
});
