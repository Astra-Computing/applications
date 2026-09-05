import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    // Mirrors the `@/*` path mapping in tsconfig.json so tests import modules
    // by the same specifier the application uses.
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    // Two projects, because they have genuinely different needs. The pure
    // layer touches nothing and can run wide open; anything that reaches the
    // database has to run one file at a time (KTD10) - a shared database reset
    // by truncation cannot survive parallel files deleting each other's rows.
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'api',
          include: ['tests/api/**/*.test.ts'],
          environment: 'node',
          fileParallelism: false,
          // The API layer builds and starts the application once for the whole
          // project; a per-file server would dominate the runtime.
          globalSetup: ['tests/support/server.ts'],
          testTimeout: 30_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
