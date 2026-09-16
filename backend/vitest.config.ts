import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    // Tests share one Postgres database, so they run one file at a time. Parallel
    // files would fight over the same rows.
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ?? 'postgresql://karga:karga_dev@localhost:5432/karga_test',
      // The suite provokes errors on purpose; logging them would bury the results.
      LOG_LEVEL: 'silent',
      CORS_ORIGINS: 'http://localhost:5175',
    },
  },
});
