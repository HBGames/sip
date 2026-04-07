import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/node/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000, // 30s for image processing tests
  },
});
