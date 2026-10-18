/**
 * Smoke-test designer-mcp's audit functions against a REAL bad Doop output —
 * the artifact whose prologue leaked into the frame. If the tool flags that,
 * it is worth wiring into the pipeline; if it only scores pretty HTML, it is
 * not.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const anti = require('D:/tools/designer-mcp/dist/anti-patterns.js')
const a11y = require('D:/tools/designer-mcp/dist/a11y-audit.js')

console.log('anti-patterns exports:', Object.keys(anti).slice(0, 12))
console.log('a11y exports:', Object.keys(a11y).slice(0, 12))

const file = process.argv[2] ?? 'D:/tools/doop/backtest/2026-10-17T19-17-32-016Z/000-finance-mobile.html'
const html = readFileSync(file, 'utf8')
console.log(`\nartifact: ${file}  (${html.length} chars)`)
console.log(`starts with doctype: ${/^\s*<!doctype/i.test(html)}`)
console.log(`has prologue: ${html.slice(0, html.search(/<!doctype/i)).trim().length > 0}`)

/* call whichever export looks like the checker */
for (const [name, fn] of Object.entries(anti)) {
  if (typeof fn !== 'function') continue
  if (!/check|audit|scan|analyze|analyz|evaluate|test/i.test(name)) continue
  try {
    const out = fn(html)
    console.log(`\nanti.${name}() ->`)
    console.log(JSON.stringify(out, null, 1).slice(0, 1200))
    break
  } catch (e) {
    console.log(`anti.${name}() threw: ${e.message}`)
  }
}

for (const [name, fn] of Object.entries(a11y)) {
  if (typeof fn !== 'function') continue
  if (!/audit|check|scan|analyze/i.test(name)) continue
  try {
    const out = fn(html)
    console.log(`\na11y.${name}() ->`)
    console.log(JSON.stringify(out, null, 1).slice(0, 1200))
    break
  } catch (e) {
    console.log(`a11y.${name}() threw: ${e.message}`)
  }
}
