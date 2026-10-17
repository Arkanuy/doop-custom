import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Read and rewrite individual keys in the instance's `.env` file.
 *
 * This exists for the one class of setting an operator must be able to change
 * without shell access to the server: the custom OpenAI-compatible endpoint.
 * Rewriting `.env` rather than mutating `process.env` is deliberate — it
 * survives a restart, so what the Settings panel shows is what the next boot
 * reads. `reloadEnv()` in `server/env.ts` then makes the change live for the
 * running process.
 *
 * Two rules the writer enforces, because getting them wrong corrupts config:
 *
 *  - a key is either replaced in place (keeping its position and any comment
 *    above it) or appended if absent — never duplicated, so the last
 *    assignment cannot silently win;
 *  - the write is atomic (temp file + rename), so a crash mid-write cannot
 *    leave a half-written `.env` behind.
 */

const HERE = dirname(fileURLToPath(import.meta.url))

/** The `.env` this process was started with, resolved relative to server/. */
export function envFilePath(): string {
  const candidate = join(HERE, '..', '.env')
  return existsSync(candidate) ? candidate : join(HERE, '.env')
}

function escapeValue(value: string): string {
  /* a value with whitespace, `#` or quotes has to survive dotenv's parser;
     single quotes inside a double-quoted value are fine either way */
  if (value === '' || /[\s#"']/.test(value)) return JSON.stringify(value)
  return value
}

/**
 * Set (or clear, with an empty value) one key. Returns true when the file's
 * bytes actually changed, so a caller can skip a pointless reload.
 *
 * The value is also mirrored into `process.env`. Writing the file alone is not
 * enough to make a change live: Node reads `--env-file` once at boot, and
 * `reloadEnv()` re-parses `process.env`, not the file. Without this mirror the
 * API would report success, persist the value, and still serve the old one
 * until a restart — which is exactly the bug this line exists to prevent.
 */
export function writeEnvKey(key: string, value: string): boolean {
  const path = envFilePath()
  const original = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const eol = original.includes('\r\n') ? '\r\n' : '\n'
  const lines = original.length ? original.split(/\r?\n/) : []

  const assignment = `${key}=${escapeValue(value)}`
  const pattern = new RegExp(`^\\s*${key}\\s*=`)
  let replaced = false

  const next = lines.map((line) => {
    if (!replaced && pattern.test(line)) {
      replaced = true
      return assignment
    }
    return line
  })

  if (!replaced) {
    /* keep a single trailing newline rather than growing a blank tail */
    while (next.length && next[next.length - 1] === '') next.pop()
    next.push(assignment, '')
  }

  const text = next.join(eol)
  /* an empty value counts as unset in server/env.ts, so mirror that too.
     This is the one sanctioned direct write to process.env in the server:
     the lint rule exists to stop scattered *reads* bypassing the validated
     snapshot, and a runtime .env rewrite has no other way to reach it. */
  /* eslint-disable no-restricted-syntax */
  if (value === '') delete process.env[key]
  else process.env[key] = value
  /* eslint-enable no-restricted-syntax */

  if (text === original) return false

  const tmp = `${path}.tmp-${process.pid}`
  writeFileSync(tmp, text, 'utf8')
  renameSync(tmp, path)
  return true
}

/** Set several keys at once; one reload can follow. */
export function writeEnvKeys(entries: Record<string, string>): boolean {
  let changed = false
  for (const [key, value] of Object.entries(entries)) {
    if (writeEnvKey(key, value)) changed = true
  }
  return changed
}

/** Clear keys by setting them empty, which `server/env.ts` reads as unset. */
export function clearEnvKeys(keys: string[]): boolean {
  return writeEnvKeys(Object.fromEntries(keys.map((key) => [key, ''])))
}
