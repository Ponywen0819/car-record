import { defineConfig } from 'vitest/config';

/**
 * Integration tests: the real client data layer + sync engine (Dexie on fake-indexeddb)
 * talking to the real server app (Hono + node:sqlite) in-process via app.request().
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['integration/**/*.test.ts'],
  },
});
