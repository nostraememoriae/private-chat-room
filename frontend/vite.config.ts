import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [
    svelte(),
  ],
  build: {
    // Output to ../public so the Cloudflare Worker can serve it
    // via wrangler's [assets] binding, or adjust to your setup.
    outDir: '../public',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Stable filenames — easier to reference from the worker if needed
        entryFileNames: 'assets/[name].[hash].js',
        chunkFileNames: 'assets/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash][extname]',
      },
    },
  },
  // During `vite dev`, proxy API + WS calls to the local wrangler instance
  server: {
    proxy: {
      '/auth': 'http://localhost:8787',
      '/ws': {
        target: 'ws://localhost:8787',
        ws: true,
        rewriteWsOrigin: true,
      },
    },
  },
  root: './frontend',
});