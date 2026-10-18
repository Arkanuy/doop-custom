/**
 * Gate 14 after the fix: the message must agree with the verdict in all three
 * cases, including the one that used to lie (a single system font).
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const anti = require('D:/tools/designer-mcp/dist/anti-patterns.js')

function gate14(html: string) {
  const r = anti.runSlopTest(html)
  return r.gates.find((g: { id: number }) => g.id === 14)
}

const cases: [string, string][] = [
  ['zero declarations', '<html><body><h1>none</h1></body></html>'],
  ['one system font (the case that lied)', '<html><body style="font-family: system-ui"><h1>x</h1></body></html>'],
  ['two real families', '<html><body style="font-family: Georgia, serif"><h1 style="font-family: Impact, sans-serif">x</h1></body></html>'],
  ['token form, two families', '<html><body style="font-family: var(--font-body)"><h1 style="font-family: var(--font-display)">x</h1></body></html>'],
]

let consistent = 0
for (const [name, html] of cases) {
  const g = gate14(html)
  const saysFound = /found/i.test(g.detail)
  const ok = g.pass === saysFound
  if (ok) consistent++
  console.log(`${ok ? 'CONSISTENT' : 'LYING     '}  ${name.padEnd(36)} pass=${String(g.pass).padEnd(5)} detail="${g.detail}"`)
}

console.log('\n--- the real Doop artifact (1 font: system-ui) ---')
const html = readFileSync('D:/tools/doop/backtest/2026-10-17T19-17-32-016Z/000-finance-mobile.html', 'utf8')
const g = gate14(html)
console.log(`pass=${g.pass}  detail="${g.detail}"`)
console.log(g.pass === false && !/found/i.test(g.detail) ? 'FIXED: verdict and message now agree' : 'STILL INCONSISTENT')

console.log(`\n${consistent}/${cases.length} cases consistent`)
process.exit(consistent === cases.length ? 0 : 1)
