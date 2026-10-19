/**
 * Render both backtest runs into one side-by-side gallery.
 *
 * The question is "is it still slop, and did the doctrine change anything", so
 * the page puts the two runs in columns against the same prompts: before (the
 * harness that never sent the design doctrine) and after (the doctrine Doop
 * actually runs). Sorted low-to-high by a11y score, so the range is visible
 * rather than a highlight reel.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { renderFrame } from '../server/screenshot.ts'
import { emojiAudit } from '../server/emojiIcons.ts'

const W = 420
const H = 1400
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

function rows(dir: string): Row[] {
  const p = join(dir, 'results.jsonl')
  if (!existsSync(p)) return []
  const all = readFileSync(p, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Row & { ok?: boolean })
    .filter((r) => r.ok !== false)
  /* the BEFORE file accumulated two runs; keep the first 100 so the two
     columns compare the same number of designs */
  return all.slice(0, 100)
}

/* same cleanup the server's write path applies, so a ```html fence does not
   render as the first line of the picture */
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

const runs = [
  { key: 'before', label: 'Before — no doctrine', dir: join(process.cwd(), 'backtest-100-BEFORE'), rows: rows(join(process.cwd(), 'backtest-100-BEFORE')) },
  { key: 'after', label: 'After — Doop doctrine', dir: join(process.cwd(), 'backtest-100'), rows: rows(join(process.cwd(), 'backtest-100')) },
]

for (const r of runs) console.log(`${r.key}: ${r.rows.length} designs`)

/* render the same 24 prompts from each run: evenly spaced across the score
   range, so the page shows the spread and not just the successes */
const PER_RUN = Number(process.argv[2] ?? 24)
const shots: { run: string; row: Row; file: string; w: number; h: number }[] = []

for (const run of runs) {
  const sorted = [...run.rows].sort((a, b) => a.a11yScore - b.a11yScore)
  const picks = Array.from({ length: Math.min(PER_RUN, sorted.length) }, (_, k) =>
    sorted[Math.round((k * (sorted.length - 1)) / (Math.min(PER_RUN, sorted.length) - 1))],
  )
  for (const [k, row] of picks.entries()) {
    const src = join(run.dir, `${String(row.i).padStart(3, '0')}.html`)
    if (!existsSync(src)) continue
    const html = clean(readFileSync(src, 'utf8'))
    process.stdout.write(`[${run.key} ${k + 1}/${picks.length}] #${row.i} a11y=${row.a11yScore}${row.a11yGrade} … `)
    try {
      const png = await renderFrame(
        { id: `bt-${run.key}-${row.i}`, canvasId: 'backtest', name: row.prompt, x: 0, y: 0, width: W, height: H, html, createdBy: 'backtest' } as unknown as Parameters<typeof renderFrame>[0],
        1,
      )
      const file = `${run.key}-${String(row.i).padStart(3, '0')}.png`
      writeFileSync(join(OUT, file), png)
      shots.push({ run: run.key, row, file, w: W, h: H })
      const e = emojiAudit(html)
      console.log(`${Math.round(png.length / 1024)}KB${e.count ? ` emoji=${e.count}` : ''}`)
    } catch (err) {
      console.log(`ERROR ${err instanceof Error ? err.message : err}`)
    }
  }
}

function summary(rs: Row[]) {
  if (!rs.length) return ''
  const a = [...rs].map((r) => r.a11yScore).sort((x, y) => x - y)
  const gA = Math.round((rs.filter((r) => r.a11yGrade === 'A').length / rs.length) * 100)
  const slop = (rs.reduce((s, r) => s + r.slopPassed, 0) / rs.length).toFixed(1)
  return `median a11y ${a[Math.floor(a.length / 2)]} · grade A ${gA}% · slop ${slop}/35`
}

const byRun = (k: string) => shots.filter((s) => s.run === k)

const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Doop backtest — before / after</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  html{overflow-x:clip;background:#0a0a0b;color:#e9e9ec;font:15px/1.55 system-ui,-apple-system,sans-serif}
  body{margin:0;padding:28px 20px 60px}
  h1{font-size:23px;margin:0 0 8px;letter-spacing:-.01em}
  p.lede{color:#9c9ca6;margin:0 0 26px;max-width:76ch}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px;margin-bottom:34px}
  .stat{background:#151518;border:1px solid #26262c;border-radius:11px;padding:14px 16px}
  .stat b{display:block;font-size:13px;color:#9c9ca6;font-weight:500;margin-bottom:5px}
  .stat span{font-size:15px}
  .run{margin-bottom:44px}
  h2{font-size:16px;margin:0 0 4px}
  .runnote{color:#9c9ca6;font-size:13px;margin:0 0 16px}
  .grid{display:grid;gap:20px;grid-template-columns:repeat(auto-fill,minmax(258px,1fr))}
  figure{margin:0;background:#151518;border:1px solid #26262c;border-radius:12px;overflow:hidden;display:flex;flex-direction:column}
  figure img{display:block;width:100%;height:auto;background:#fff}
  figcaption{padding:9px 11px;font-size:12.5px;display:flex;justify-content:space-between;gap:8px;align-items:baseline}
  .meta{color:#9c9ca6;font-size:11.5px;white-space:nowrap}
  .low .meta{color:#ff8b7a}
</style></head><body>
<h1>Doop backtest — before and after the design doctrine</h1>
<p class="lede">Same 100 prompts per column, same model, phone width (${W}px), sorted worst to best by accessibility score. "Before" is the harness that never sent the design doctrine — those numbers described the bare model. "After" is the doctrine Doop actually puts in the agent's prompt. Tap an image to open it full size.</p>
<div class="stats">
  <div class="stat"><b>Before</b><span>${summary(runs[0].rows)}</span></div>
  <div class="stat"><b>After</b><span>${summary(runs[1].rows)}</span></div>
</div>
${runs
  .map(
    (run) => `<section class="run">
<h2>${run.label}</h2>
<p class="runnote">${run.rows.length} designs · showing ${byRun(run.key).length} across the score range</p>
<div class="grid">
${byRun(run.key)
  .map(
    (s) => `<figure class="${s.row.a11yScore < 70 ? 'low' : ''}"><a href="/backtest-shots/${s.file}" target="_blank"><img loading="lazy" src="/backtest-shots/${s.file}" alt="${s.row.prompt}"></a>
<figcaption><span>${s.row.prompt}</span><span class="meta">${s.row.a11yScore}${s.row.a11yGrade}</span></figcaption></figure>`,
  )
  .join('\n')}
</div></section>`,
  )
  .join('\n')}
</body></html>`

writeFileSync(join(OUT, 'index.html'), page, 'utf8')
console.log(`\nshots: ${shots.length} (${byRun('before').length} before, ${byRun('after').length} after)`)
console.log(`gallery: ${join(OUT, 'index.html')}`)
