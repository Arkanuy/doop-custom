import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The salvage contract, proven against real model output rather than
 * hand-written strings: every artifact in the last backtest run came back with
 * a prologue, a markdown fence, a trailing commentary — or all three — so the
 * fixtures ARE the failure case.
 *
 * `completeHtml` is module-private in server/resident.ts (it belongs to the
 * tool layer). Rather than widen its export purely for a test, this pins the
 * same contract, and scripts/verify-complete-html.ts exercises the operator
 * path against the same artifacts.
 */
function completeHtml(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  let html = value.trim()
  if (!html) return undefined
  const fence = html.match(/^```(?:html)?\s*\n([\s\S]*?)\n?```\s*$/i)
  if (fence?.[1]) html = fence[1].trim()
  const doctypeAt = html.search(/<!doctype\s+html/i)
  const htmlTagAt = html.search(/<html(?:\s|>)/i)
  const startAt = doctypeAt !== -1 ? doctypeAt : htmlTagAt
  if (startAt === -1) return undefined
  html = html.slice(startAt)
  const closeAt = html.search(/<\/html>/i)
  if (closeAt !== -1) html = html.slice(0, closeAt + '</html>'.length)
  html = html.trim()
  if (html.length < 80 || !/<html(?:\s|>)/i.test(html) || !/<\/html>$/i.test(html)) return undefined
  return html
}

const ARTIFACT_DIR = 'backtest/2026-10-17T19-17-32-016Z'

describe('completeHtml salvage', () => {
  it('returns a clean document for every artifact the model produced', () => {
    let checked = 0
    for (const name of readdirSync(ARTIFACT_DIR)) {
      if (!name.endsWith('.html')) continue
      const raw = readFileSync(join(ARTIFACT_DIR, name), 'utf8')
      const out = completeHtml(raw)
      expect(out, `${name} should salvage to a document`).toBeDefined()
      expect(/^<!doctype html>/i.test(out!), `${name} starts with a doctype`).toBe(true)
      expect(out!.includes('Here is a'), `${name} has no leftover prologue`).toBe(false)
      expect(out!.endsWith('</html>'), `${name} ends with the closing tag`).toBe(true)
      expect(out!.includes('```'), `${name} has no leftover code fence`).toBe(false)
      expect(out!.length, `${name} is smaller than the noisy input`).toBeLessThan(raw.length)
      checked++
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('rejects input with no document at all', () => {
    expect(completeHtml('Sorry, I cannot do that.')).toBeUndefined()
    expect(completeHtml('<div>fragment</div>')).toBeUndefined()
    expect(completeHtml(undefined)).toBeUndefined()
  })
})
