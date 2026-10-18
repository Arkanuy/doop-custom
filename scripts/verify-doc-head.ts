/**
 * ensureDocumentHead: fill in the head a frame needs, without overwriting
 * choices the model made.
 */
import { ensureDocumentHead } from '../server/escapedHtml.ts'

const cases: [string, string, string, (o: string) => boolean][] = [
  [
    'no head at all',
    '<!doctype html><html><body><h1>x</h1></body></html>',
    'Keuangan',
    (o) => /<head><title>Keuangan<\/title><\/head>/i.test(o) && /lang="en"/.test(o),
  ],
  [
    'head without title',
    '<!doctype html><html><head><meta charset="utf-8"></head><body>x</body></html>',
    'Pricing',
    (o) => /<title>Pricing<\/title>/i.test(o) && o.indexOf('<title>') > o.indexOf('<head'),
  ],
  [
    'empty title gets filled',
    '<!doctype html><html lang="id"><head><title>  </title></head><body>x</body></html>',
    'Dashboard',
    (o) => /<title>Dashboard<\/title>/i.test(o),
  ],
  [
    'real title is left alone',
    '<!doctype html><html><head><title>My Own Words</title></head><body>x</body></html>',
    'Keuangan',
    (o) => /<title>My Own Words<\/title>/i.test(o) && !o.includes('Keuangan'),
  ],
  [
    'existing lang is not overwritten',
    '<!doctype html><html lang="id"><head></head><body>x</body></html>',
    'X',
    (o) => /lang="id"/.test(o) && !/lang="en"/.test(o),
  ],
  [
    'frame name with markup cannot inject',
    '<!doctype html><html><head></head><body>x</body></html>',
    '<script>alert(1)</script>Frame',
    (o) => !o.includes('<script>') && /<title>scriptalert\(1\)\/scriptFrame<\/title>/.test(o),
  ],
]

let pass = 0
for (const [name, input, fallback, check] of cases) {
  const out = ensureDocumentHead(input, fallback)
  const ok = check(out)
  if (ok) pass++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) console.log(`      got: ${out.slice(0, 160)}`)
}
console.log(`\n${pass}/${cases.length} passed`)
process.exit(pass === cases.length ? 0 : 1)
