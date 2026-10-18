import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { TestProject } from 'vitest/node'
import { buildTemplate } from './harness.ts'

/* Runs once per vitest invocation, before any worker: the migrated PGlite
   template every integration server is copied from. Its own temp directory,
   so overlapping runs in one checkout never see each other's files. */
let dir: string

export async function setup(project: TestProject): Promise<void> {
  dir = mkdtempSync(path.join(tmpdir(), 'doop-test-template-'))
  await buildTemplate(dir)
  project.provide('templateDir', dir)
}

/**
 * Cleanup that cannot fail the run.
 *
 * `rmSync` on this directory throws EPERM on Windows whenever a lingering
 * process still holds a handle inside it — which is the normal case right
 * after a test suite, and it turned a completed run into exit code 1 with a
 * message about temp files rather than tests. The teardown contract is
 * best-effort by definition: the directory is under the OS temp dir and the
 * OS reclaims it. Retry briefly, then accept.
 */
export function teardown(): void {
  for (let i = 0; i < 5; i++) {
    try {
      rmSync(dir, { recursive: true, force: true })
      return
    } catch {
      /* brief synchronous backoff; teardown runs once, on the way out */
      const until = Date.now() + 100 * (i + 1)
      while (Date.now() < until) {
        /* spin — a sleep helper here would need async and vitest accepts a
           sync teardown; the wait is under half a second in total */
      }
    }
  }
}
