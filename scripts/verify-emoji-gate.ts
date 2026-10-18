/**
 * Prove the emoji gate catches what the external checker misses.
 *
 * Run over the real backtest artifacts: 121 of 180 shipped emoji as icons, and
 * designer-mcp's twelve-character gate passed the worst of them (42 emoji on a
 * ride-hailing page).
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { emojiAudit } from '../server/emojiIcons.ts'

const DIR = 'backtest-100'
if (!existsSync(DIR)) {
  console.log('no backtest-100 directory — run scripts/backtest-100.ts first')
  process.exit(1)
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.html')).sort()
let flagged = 0
const worst: { file: string; count: number; distinct: string[] }[] = []

for (const f of files) {
  const html = readFileSync(join(DIR, f), 'utf8')
  const audit = emojiAudit(html)
  if (!audit.pass) {
    flagged++
    worst.push({ file: f, count: audit.count, distinct: audit.distinct.slice(0, 8) })
  }
}

worst.sort((a, b) => b.count - a.count)
console.log(`files=${files.length}  flagged=${flagged} (${Math.round((flagged / files.length) * 100)}%)`)
console.log('\nworst offenders:')
for (const w of worst.slice(0, 8)) {
  console.log(`  ${w.file}  count=${String(w.count).padStart(3)}  ${w.distinct.join(' ')}`)
}

/* the invariant that matters: a page with no emoji must NOT be flagged, and a
   code sample holding an emoji must not be either */
const clean = '<!doctype html><html><body><h1>Plain</h1><svg aria-hidden="true"><path d="M4 4h16"/></svg></body></html>'
const withCode = '<!doctype html><html><body><pre>console.log("🍜")</pre></body></html>'
const withIcon = '<!doctype html><html><body><nav>🍜 Menu</nav></body></html>'

const results: [string, boolean][] = [
  ['clean page (svg icon)', emojiAudit(clean).pass],
  ['emoji inside <pre> (user content)', emojiAudit(withCode).pass],
  ['emoji in navigation (defect)', emojiAudit(withIcon).pass],
]
console.log('\ninvariants:')
let ok = 0
for (const [name, pass] of results) {
  const expected = name.includes('defect') ? false : true
  const good = pass === expected
  if (good) ok++
  console.log(`  ${good ? 'PASS' : 'FAIL'}  ${name} -> flagged=${!pass}`)
}

console.log(`\n${ok}/${results.length} invariants hold; ${flagged} real designs flagged`)
process.exit(ok === results.length && flagged > 0 ? 0 : 1)
