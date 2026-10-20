/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  // Relative asset paths, so the demo also works from a sub-path such as GitHub Pages (/<repo>/).
  base: mode === 'demo' ? './' : '/',
  resolve: {
    alias: {
      // The demo build runs entirely in the browser; see src/lib/backend/demo.ts.
      '@backend': fileURLToPath(
        new URL(mode === 'demo' ? './src/lib/backend/demo.ts' : './src/lib/backend/supabase.ts', import.meta.url),
      ),
    },
  },
  // The demo is published as one self-contained page, so it is built as a single script and stylesheet.
  build:
    mode === 'demo'
      ? {
          outDir: 'dist-demo',
          cssCodeSplit: false,
          assetsInlineLimit: Number.MAX_SAFE_INTEGER,
          chunkSizeWarningLimit: 2000,
          rolldownOptions: { output: { inlineDynamicImports: true } },
        }
      : {},
  server: {
    port: 5173,
    // The API runs separately; proxy it so the browser only talks to one origin in development.
    proxy: {
      '/api': { target: process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:8787', changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
}));
