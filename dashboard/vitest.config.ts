import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify('test'),
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['src/__tests__/setup.ts'],
    // 5s default flakes on the TanStack Query hook tests: they pass in
    // isolation but a jsdom worker can lose enough CPU to the rest of the
    // parallel suite that a mutation's onSuccess misses the deadline. Same
    // reason api/vitest.config.ts uses 15s.
    testTimeout: 15_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
