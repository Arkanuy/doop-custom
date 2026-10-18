import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

/**
 * Fast lane: pure unit tests that need no integration server, no PGlite
 * template, and no browser. Seconds instead of the full suite's minutes.
 *
 * This is a speed choice now, not a workaround. It used to be both: globalSetup
 * `rm`-ed a temp directory that Windows refused to release (EPERM), so the
 * default config could not start any test at all. That is fixed at the source
 * (tests/harness.ts + tests/globalSetup.ts retry, wait for the child, and
 * accept a failed cleanup), so `bun run test` runs the whole suite. Keep using
 * that for a real gate; use this for the tight loop.
 *
 *   bun run test:unit
 */
export default defineConfig({
  test: {
    include: ['tests/env.test.ts', 'tests/modelMenu*.test.ts', 'tests/completeHtml.test.ts', 'tests/cssValues.test.ts'],
    globalSetup: [],
    setupFiles: [],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
