/**
 * Backtest 100 designs — quality, not just completeness.
 *
 * The earlier harness answered "did the model return a whole HTML document".
 * It does (100/100), which is why it missed the real complaint: the designs
 * were ugly. This one renders each result and runs the external anti-slop and
 * accessibility checkers over it, so the output is a score per design and a
 * distribution across 100, not a pass/fail.
 *
 *   npx tsx --env-file-if-exists=.env scripts/backtest-100.ts [runs]
 *
 * Writes one JSON line per design to backtest-100/results.jsonl as it goes, so
 * a crash or a timeout keeps the runs already done.
 */
import { mkdirSync, writeFileSync, appendFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { customChatConfig, runTextCompletion } from '../server/chatCompletionsAgent.ts'

const require = createRequire(import.meta.url)
const anti = require('D:/tools/designer-mcp/dist/anti-patterns.js')
const a11y = require('D:/tools/designer-mcp/dist/a11y-audit.js')

const RUNS = Number(process.argv[2] ?? 100)
const OUT = join(process.cwd(), 'backtest-100')
mkdirSync(OUT, { recursive: true })
const JSONL = join(OUT, 'results.jsonl')
if (!existsSync(JSONL)) writeFileSync(JSONL, '')

const config = customChatConfig()
if (!config) {
  console.log('NO_ENDPOINT')
  process.exit(1)
}

/**
 * The archetypes a real user would ask for, each phrased the way a person
 * types it — short, no design vocabulary. The previous run's prompts already
 * named a mood and a layout; that measures the model's compliance, not its
 * taste, and taste is what the complaint was about.
 */
const PROMPTS = [
  'landing page kopi',
  'dashboard keuangan mobile',
  'halaman harga SaaS tiga paket',
  'portfolio fotografer',
  'halaman login aplikasi kasir',
  'landing page jasa cuci sepatu',
  'katalog produk skincare',
  'halaman profil pengguna aplikasi',
  'dashboard admin penjualan',
  'landing page kursus online',
  'halaman konfirmasi pembayaran',
  'halaman detail resep masakan',
  'landing page bengkel motor',
  'halaman daftar anggota komunitas',
  'halaman pengaturan notifikasi',
  'landing page aplikasi ojek online',
  'dashboard stok gudang',
  'halaman pemesanan tiket konser',
  'landing page klinik gigi',
  'halaman riwayat transaksi',
]

interface Row {
  i: number
  prompt: string
  ok: boolean
  chars: number
  ms: number
  slopPassed?: number
  slopTotal?: number
  slopFailed?: number[]
  a11yScore?: number
  a11yGrade?: string
  a11yIssues?: number
  a11ySerious?: number
  hasTitle?: boolean
  hasLang?: boolean
  error?: string
}

const results: Row[] = []

for (let i = 0; i < RUNS; i++) {
  const prompt = PROMPTS[i % PROMPTS.length]
  const started = Date.now()
  process.stdout.write(`[${String(i + 1).padStart(3)}/${RUNS}] ${prompt.slice(0, 32).padEnd(34)} `)
  try {
    const html = await runTextCompletion(
      config,
      `You are a senior product designer. The person asked in casual Indonesian: "${prompt}"\n\n` +
        'Reply with ONE complete, self-contained HTML document (inline CSS, no external assets) and nothing else. ' +
        'Realistic content, a deliberate palette, strong typographic hierarchy, and a non-empty <title> with lang on <html>.',
      16000,
    )
    const wrap = /<!doctype html/i.test(html) ? html : `<!doctype html><html><body>${html}</body></html>`
    const slop = anti.runSlopTest(wrap) as { total: number; passed: number; gates: { id: number; pass: boolean }[] }
    const ax = a11y.auditA11y(wrap) as {
      score: number
      grade: string
      issue_count: { total: number; serious: number }
    }
    const row: Row = {
      i,
      prompt,
      ok: true,
      chars: html.length,
      ms: Date.now() - started,
      slopPassed: slop.passed,
      slopTotal: slop.total,
      slopFailed: slop.gates.filter((g) => !g.pass).map((g) => g.id),
      a11yScore: ax.score,
      a11yGrade: ax.grade,
      a11yIssues: ax.issue_count.total,
      a11ySerious: ax.issue_count.serious,
      hasTitle: /<title[^>]*>[^<\s]/i.test(wrap),
      hasLang: /<html[^>]*\slang=/i.test(wrap),
    }
    results.push(row)
    appendFileSync(JSONL, JSON.stringify(row) + '\n')
    writeFileSync(join(OUT, `${String(i).padStart(3, '0')}.html`), html, 'utf8')
    console.log(`slop=${slop.passed}/${slop.total} a11y=${ax.score}${ax.grade} title=${row.hasTitle} ${Math.round(row.ms / 1000)}s`)
  } catch (err) {
    const row: Row = {
      i,
      prompt,
      ok: false,
      chars: 0,
      ms: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    }
    results.push(row)
    appendFileSync(JSONL, JSON.stringify(row) + '\n')
    console.log(`ERROR ${String(row.error).slice(0, 80)}`)
  }
}

const ok = results.filter((r) => r.ok)
const nums = (pick: (r: Row) => number) => ok.map(pick).sort((a, b) => a - b)
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0)
const median = (xs: number[]) => (xs.length ? xs[Math.floor(xs.length / 2)] : 0)
const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0)

console.log('\n=== SUMMARY ===')
console.log(`runs=${results.length} ok=${ok.length} errored=${results.length - ok.length}`)
console.log(`slop  mean=${mean(nums((r) => r.slopPassed!))}/${ok[0]?.slopTotal ?? 35}  median=${median(nums((r) => r.slopPassed!))}`)
console.log(`a11y  mean=${mean(nums((r) => r.a11yScore!))}  median=${median(nums((r) => r.a11yScore!))}  min=${nums((r) => r.a11yScore!)[0]}`)
console.log(`grade A=${pct(ok.filter((r) => r.a11yGrade === 'A').length, ok.length)}%  B=${pct(ok.filter((r) => r.a11yGrade === 'B').length, ok.length)}%  C+=${pct(ok.filter((r) => /[C-F]/.test(r.a11yGrade ?? '')).length, ok.length)}%`)
console.log(`serious issues: ${ok.filter((r) => (r.a11ySerious ?? 0) > 0).length}/${ok.length} designs have at least one`)
console.log(`title present=${pct(ok.filter((r) => r.hasTitle).length, ok.length)}%  lang present=${pct(ok.filter((r) => r.hasLang).length, ok.length)}%`)
console.log(`avg seconds=${Math.round(mean(nums((r) => r.ms)) / 1000)}`)

/* which gates fail most often — the actionable part */
const tally = new Map<number, number>()
for (const r of ok) for (const id of r.slopFailed ?? []) tally.set(id, (tally.get(id) ?? 0) + 1)
const worst = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
console.log('\ngates that fail most:')
for (const [id, n] of worst) console.log(`   gate ${id}: ${n}/${ok.length}`)
console.log(`\nresults: ${JSONL}`)
