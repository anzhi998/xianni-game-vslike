import { defineConfig } from 'vite';
import path from 'path';
import { offlinePlugin } from './scripts/vite-plugin-offline.mjs';

export default defineConfig({
  base: './',
  plugins: [offlinePlugin(path.resolve(__dirname, 'public'))],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
    sourcemap: false,
  },
  server: {
    port: 5173,
    open: false,
  },
});
