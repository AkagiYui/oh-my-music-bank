import { defineConfig, lazyPlugins } from 'vite-plus';
import { fileURLToPath } from 'node:url';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// 检查工具无需实例化开发插件；路由生成仍须先于 React 转换执行。
export default defineConfig({
  plugins: lazyPlugins(() => [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()]),
  run: {
    tasks: {
      // 两个常驻服务必须并行启动，不能等待后端退出后才启动前端。
      dev: { command: 'vp run --parallel dev:services', cache: false },
      'dev:services': {
        command: 'vp dev --strictPort',
        dependsOn: ['dev:api'],
        cache: false,
      },
      // 从仓库根读取 .env；固定 Air 版本，由 Go 下载并缓存，无需全局安装。
      'dev:api': {
        command: 'go run github.com/air-verse/air@v1.67.4 -c .air.toml.example',
        cwd: '..',
        cache: false,
      },
    },
  },
  fmt: {
    singleQuote: true,
    semi: true,
    printWidth: 120,
    sortImports: false,
    sortPackageJson: false,
    ignorePatterns: ['dist/**', 'src/routeTree.gen.ts', 'test-results/**', 'playwright-report/**', '.vite-plus/**'],
  },
  lint: {
    plugins: ['oxc', 'typescript', 'unicorn', 'react'],
    categories: { correctness: 'warn' },
    ignorePatterns: ['dist/**', 'src/routeTree.gen.ts', 'test-results/**', 'playwright-report/**', '.vite-plus/**'],
    options: { typeAware: true, typeCheck: true },
    jsPlugins: [{ name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' }],
    rules: {
      'vite-plus/prefer-vite-plus-imports': 'error',
      // 保留查询回填编辑草稿的现有语义；本轮不引入 React Compiler 的额外渲染约束。
      'react/set-state-in-effect': 'off',
    },
    overrides: [
      {
        files: ['src/**/*.{ts,tsx}'],
        rules: {
          'react/rules-of-hooks': 'error',
          'react/exhaustive-deps': 'error',
          'no-unused-vars': [
            'error',
            {
              args: 'none',
              argsIgnorePattern: '^_',
              varsIgnorePattern: '^_',
              caughtErrors: 'none',
              ignoreRestSiblings: true,
            },
          ],
        },
      },
    ],
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
  base: '/',
  resolve: { alias: { '~': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:9111', changeOrigin: true },
      '/health': { target: 'http://localhost:9111', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', target: 'es2022' },
});
