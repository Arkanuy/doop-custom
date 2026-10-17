import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

/**
 * A throwaway vitest config for pure unit tests that need no integration
 * server and therefore no PGlite template.
 *
 * `tests/globalSetup.ts` builds that template by `rm`-ing a temp directory,
 * which fails with EPERM on Windows while a previous run's server still holds
 * the path — so on this machine the default config cannot start *any* test,
 * relevant or not. This config drops the global setup and the browser setup
 * file, leaving only the alias, which is what a unit test on shared/ or
 * server/ pure helpers actually needs.
 */
export default defineConfig({
  test: {
    include: ['tests/env.test.ts', 'tests/modelMenu*.test.ts'],
    globalSetup: [],
    setupFiles: [],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
