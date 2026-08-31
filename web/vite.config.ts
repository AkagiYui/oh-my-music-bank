import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Vite 配置（纯 SPA）。
 * - TanStack Router 文件式路由（history 模式）；`tanstackRouter` 必须排在 `react()` 之前。
 * - 开发期把 /api 与 /health 代理到本地 Go 后端（默认 :9111）。
 * - 构建产物为纯静态文件，由 Caddy 托管并做 SPA 回退。
 */
export default defineConfig({
  base: '/',
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:9111', changeOrigin: true },
      '/health': { target: 'http://localhost:9111', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
});
