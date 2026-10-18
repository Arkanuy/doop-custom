/**
 * Render the backtest designs to PNG so they can actually be looked at.
 * Output goes to a folder served over HTTP, so the URLs open from a phone.
 *
 *   npx tsx scripts/backtest-shots.ts [count] [startIndex]
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { renderFrame } from '../server/screenshot.ts'

const COUNT = Number(process.argv[2] ?? 12)
const START = Number(process.argv[3] ?? 0)
const SRC = join(process.cwd(), 'backtest-100')
const OUT = join(process.cwd(), 'public', 'backtest-shots')
mkdirSync(OUT, { recursive: true })

interface Row {
  i: number
  prompt: string
  a11yScore: number
  a11yGrade: string
  slopPassed: number
  slopTotal: number
  chars: number
}
const rows: Row[] = existsSync(join(SRC, 'results.jsonl'))
  ? readFileSync(join(SRC, 'results.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
  : []

/* Between the runner's own salvage and storage, a document is already clean;
   the file on disk is the raw model reply, so apply the same cleanup the
   server's write path does before rendering — otherwise a ```html fence shows
   up as the first line of the picture. */
function clean(raw: string): string {
  let h = raw.trim()
  const f = h.match(/^```(?:html|HTML)?\s*\n([\s\S]*?)\n?```\s*$/)
  if (f?.[1]) h = f[1].trim()
  const di = h.toLowerCase().indexOf('<!doctype html')
  const ht = h.search(/<html(?:\s|>)/i)
  const s = di !== -1 ? di : ht
  if (s > 0) h = h.slice(s)
  const c = h.toLowerCase().indexOf('</html>')
  if (c !== -1) h = h.slice(0, c + 7)
  return h.trim()
}

/* pick a spread: the best, the worst, and everything in between, so the
   montage shows the range rather than ten good ones */
const ordered = [...rows].sort((a, b) => a.a11yScore - b.a11yScore)
const picks =
  rows.length > COUNT
    ? Array.from({ length: COUNT }, (_, k) => ordered[Math.round((k * (ordered.length - 1)) / (COUNT - 1))])
    : ordered

const manifest: { file: string; prompt: string; a11y: string; slop: string; w: number; h: number }[] = []

for (const [k, row] of picks.entries()) {
  const src = join(SRC, `${String(row.i).padStart(3, '0')}.html`)
  if (!existsSync(src)) continue
  const html = clean(readFileSync(src, 'utf8'))
  /* a phone-width capture, because that is where the complaint was */
  const width = 420
  const height = 1500
  process.stdout.write(`[${k + 1}/${picks.length}] #${row.i} a11y=${row.a11yScore}${row.a11yGrade} ${row.prompt.slice(0, 28)} … `)
  try {
    const png = await renderFrame(
      { id: `bt-${row.i}`, canvasId: 'backtest', name: row.prompt, x: 0, y: 0, width, height, html, createdBy: 'backtest' } as unknown as Parameters<typeof renderFrame>[0],
      1,
    )
    const name = `${String(row.i).padStart(3, '0')}-${row.prompt.replace(/[^a-z0-9]+/gi, '-').slice(0, 30)}.png`
    writeFileSync(join(OUT, name), png)
    manifest.push({ file: name, prompt: row.prompt, a11y: `${row.a11yScore}${row.a11yGrade}`, slop: `${row.slopPassed}/${row.slopTotal}`, w: width, h: height })
    console.log(`${Math.round(png.length / 1024)}KB`)
  } catch (err) {
    console.log(`ERROR ${err instanceof Error ? err.message : err}`)
  }
}

/* one page to scroll through all of them */
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Doop backtest — 100 designs</title>
<style>
  html{overflow-x:clip;background:#0b0b0c;color:#e8e8ea;font:15px/1.5 system-ui,sans-serif}
  body{margin:0;padding:32px}
  h1{font-size:22px;margin:0 0 6px}
  p.lede{color:#9a9aa2;margin:0 0 28px;max-width:70ch}
  .grid{display:grid;gap:24px;grid-template-columns:repeat(auto-fill,minmax(300px,1fr))}
  figure{margin:0;background:#141416;border:1px solid #232326;border-radius:12px;overflow:hidden}
  figcaption{padding:10px 12px;font-size:13px}
  .meta{color:#9a9aa2;font-size:12px;margin-top:3px}
  img{display:block;width:100%;height:auto;background:#fff}
</style></head><body>
<h1>Doop backtest — design quality across the run</h1>
<p class="lede">Sorted worst to best by accessibility score, so the range is visible rather than a highlight reel. Render width 420px (phone). a11y = WCAG audit score and grade; slop = anti-slop gates passed of ${rows[0]?.slopTotal ?? 35}.</p>
<div class="grid">
${manifest
  .map(
    (m) => `<figure><img src="/backtest-shots/${encodeURIComponent(m.file)}" alt="${m.prompt}">
<figcaption>${m.prompt}<div class="meta">a11y ${m.a11y} · slop ${m.slop}</div></figcaption></figure>`,
  )
  .join('\n')}
</div></body></html>`
writeFileSync(join(OUT, 'index.html'), html, 'utf8')

console.log(`\nshots: ${manifest.length}`)
console.log(`gallery: ${join(OUT, 'index.html')}`)
