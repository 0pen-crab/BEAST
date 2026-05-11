import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/__tests__/setup.ts'],
    // 5s default trips on cold-import smoke tests (e.g. admin.test.ts) when the
    // suite is run in parallel — postgres-js client init contends with other
    // imports. 15s is generous enough to absorb the cold-start spike.
    testTimeout: 15_000,
  },
});
