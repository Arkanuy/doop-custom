/**
 * Prove the HTML salvage handles what models actually return. Run:
 *   npx tsx scripts/verify-complete-html.ts
 *
 * Case 4 is the measured real-world shape: a valid document with 763
 * characters of closing commentary glued after </html>, which the old
 * "must END in </html>" contract rejected outright.
 */
import { readFileSync } from 'node:fs'

/* completeHtml is module-private, so exercise it through the same source it
   lives in by importing the module and reading the behaviour off a live call
   would need the agent loop. Instead assert on the regex contract directly,
   using the real artifact from the backtest run. */
const ARTIFACT = process.argv[2] ?? 'D:/tools/doop/backtest/2026-10-17T19-17-32-016Z/000-finance-mobile.html'

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

const long = (inner: string) =>
  `<!doctype html><html><body>${inner}${'<!-- padding to clear the 80-char floor -->'}</body></html>`

const cases: [string, string, boolean][] = [
  ['plain document', long('<h1>x</h1>'), true],
  ['markdown fenced', '```html\n' + long('<h1>y</h1>') + '\n```', true],
  ['prose before', 'Here is the page:\n\n' + long('<h1>z</h1>'), true],
  ['real artifact (763 chars of tail)', readFileSync(ARTIFACT, 'utf8'), true],
  ['no document at all', 'Sorry, I cannot do that.', false],
  ['bare fragment', '<div>hi</div>', false],
  ['too short to be a document', '<html></html>', false],
]

let pass = 0
for (const [name, input, wantOk] of cases) {
  const out = completeHtml(input)
  const ok = (out !== undefined) === wantOk
  if (ok) pass++
  const detail = out
    ? `len=${out.length} endsWithHtml=${/<\/html>$/i.test(out)} startsWithDoctype=${/^<!doctype/i.test(out)}`
    : 'rejected'
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(36)} -> ${detail}`)
}

console.log(`\n${pass}/${cases.length} passed`)
process.exit(pass === cases.length ? 0 : 1)
