import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 1_500_000, // pipeline tests need long hooks (scan wait)
    fileParallelism: false,
  },
});
