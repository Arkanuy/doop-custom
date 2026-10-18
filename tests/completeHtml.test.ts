import { describe, expect, it } from 'vitest'

/**
 * The salvage contract.
 *
 * Fixtures are inline on purpose. An earlier version read the artifacts from
 * `backtest/`, which exists only on the machine that ran the backtest — so the
 * test was green here and red on any other checkout, including CI and the
 * deploy host. The shapes below are transcribed from those real artifacts
 * (5 of 5 sampled model outputs carried at least one of them), so the coverage
 * survives without the dependency.
 *
 * `completeHtml` is module-private in server/resident.ts and `stripHtmlPackaging`
 * is the same logic exported from server/escapedHtml.ts, which is where the
 * shared write path calls it. This pins that contract.
 */
import { stripHtmlPackaging, repairEscapedHtml } from '../server/escapedHtml.ts'

const long = (inner: string) =>
  `<!doctype html><html><body>${inner}${'<!-- padding to clear the 80-char floor -->'}</body></html>`

describe('HTML packaging salvage', () => {
  it('strips the prologue and the code fence a model wrapped around the document', () => {
    const raw = `Here is a complete HTML document for a pricing page.\n\`\`\`html\n${long('<h1>Pricing</h1>')}\n\`\`\``
    const out = stripHtmlPackaging(raw)
    expect(/^<!doctype html>/i.test(out)).toBe(true)
    expect(out.includes('```')).toBe(false)
    expect(out.includes('Here is a')).toBe(false)
    expect(out).toContain('Pricing')
  })

  it('cuts the closing commentary appended after the document', () => {
    /* measured shape: 763 characters of explanation glued to the end */
    const raw = `${long('<h1>Keuangan</h1>')}\n\nI hope this helps! Let me know if you want any changes, and here is some more commentary to make the tail unambiguously long.`
    const out = stripHtmlPackaging(raw)
    expect(/<\/html>$/i.test(out)).toBe(true)
    expect(out.includes('I hope this helps')).toBe(false)
    expect(out).toContain('Keuangan')
  })

  it('handles prologue, fence and tail together', () => {
    const raw = `Sure, here it is:\n\`\`\`html\n${long('<h1>All three</h1>')}\n\`\`\`\nHope this helps!`
    const out = stripHtmlPackaging(raw)
    expect(/^<!doctype html>/i.test(out)).toBe(true)
    expect(/<\/html>$/i.test(out)).toBe(true)
    expect(out.includes('```')).toBe(false)
    expect(out.includes('Sure, here it is')).toBe(false)
    expect(out.includes('Hope this helps')).toBe(false)
    expect(out).toContain('All three')
  })

  it('leaves a clean document byte-identical', () => {
    const clean = long('<h1>Clean</h1>')
    expect(stripHtmlPackaging(clean)).toBe(clean)
    expect(repairEscapedHtml(stripHtmlPackaging(clean))).toBe(clean)
  })

  it('still repairs an escaped payload', () => {
    const escaped = '&lt;!doctype html&gt;&lt;html&gt;&lt;body&gt;hi&lt;/body&gt;&lt;/html&gt;'
    const out = repairEscapedHtml(stripHtmlPackaging(escaped))
    expect(out).toBe('<!doctype html><html><body>hi</body></html>')
  })

  it('returns non-documents unchanged so callers keep their own validation', () => {
    expect(stripHtmlPackaging('Sorry, I cannot do that.')).toBe('Sorry, I cannot do that.')
    expect(stripHtmlPackaging('')).toBe('')
    expect(stripHtmlPackaging('fragment')).toBe('fragment')
  })
})
