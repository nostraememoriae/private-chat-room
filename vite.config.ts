import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig({
  plugins: [svelte(), cloudflare()],
  build: {
    rollupOptions: {
      output: {
        // Stable filenames — easier to reference from the worker if needed
        entryFileNames: 'assets/[name].[hash].js',
        chunkFileNames: 'assets/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash][extname]',
      },
    },
  },
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
});
