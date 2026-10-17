/**
 * Render backtest outputs to PNG so a human (or a vision pass) can actually
 * judge them. Completeness metrics prove the model returned a document; only
 * looking at the picture says whether the document is any good.
 *
 *   npx tsx --env-file-if-exists=.env scripts/backtest-render.ts [runs]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { customChatConfig, runChatCompletionsTurn } from '../server/chatCompletionsAgent.ts'
import { renderFrame } from '../server/screenshot.ts'

const RUNS = Number(process.argv[2] ?? 5)
const OUT = join(process.cwd(), 'backtest', new Date().toISOString().replace(/[:.]/g, '-'))
mkdirSync(OUT, { recursive: true })

const config = customChatConfig()
if (!config) {
  console.log('NO_ENDPOINT')
  process.exit(1)
}

const PROMPTS = [
  [
    'finance-mobile',
    'Buat panel admin keuangan yang responsive, mobile-first: header saldo, baris pemasukan/pengeluaran, bar chart kecil. Dark theme.',
  ],
  ['pricing-saas', 'SaaS pricing page, three tiers, feature comparison row. Light, editorial.'],
  ['resto-hero', 'Restaurant landing hero: headline besar, CTA reservasi, tiga kartu menu.'],
  ['kpi-card', 'Analytics dashboard card: satu angka KPI, sparkline, delta badge.'],
  ['portfolio', 'Personal portfolio header: nama dalam display type, label peran, dua tautan.'],
]

const summary: { name: string; chars: number; png: string | null; ms: number; error?: string }[] = []

for (let i = 0; i < RUNS; i++) {
  const [name, prompt] = PROMPTS[i % PROMPTS.length]
  const started = Date.now()
  process.stdout.write(`[${i + 1}/${RUNS}] ${name} … `)
  try {
    const turn = await runChatCompletionsTurn(config, {
      system:
        'You are a senior product designer. Reply with ONE complete, self-contained HTML document (inline CSS, no external assets) and nothing else.',
      tools: [],
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 16000,
    })
    const html = turn.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { text: string }).text)
      .join('')
    writeFileSync(join(OUT, `${String(i).padStart(3, '0')}-${name}.html`), html, 'utf8')

    /* the same renderer the agent's own review step uses, so what we judge is
       what a watching human would see */
    const png = await renderFrame(
      {
        id: `bt-${i}`,
        canvasId: 'backtest',
        name,
        x: 0,
        y: 0,
        width: 390,
        height: 844,
        html,
        createdBy: 'backtest',
      } as unknown as Parameters<typeof renderFrame>[0],
      1,
    )
    const pngPath = join(OUT, `${String(i).padStart(3, '0')}-${name}.png`)
    writeFileSync(pngPath, png)
    summary.push({ name, chars: html.length, png: pngPath, ms: Date.now() - started })
    console.log(`chars=${html.length} png=${png.length}b ${Date.now() - started}ms`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    summary.push({ name, chars: 0, png: null, ms: Date.now() - started, error: message })
    console.log(`ERROR ${message}`)
  }
}

console.log(`\n=== OUT ===\n${OUT}`)
console.log(`ok=${summary.filter((s) => s.png).length}/${summary.length}`)
console.log(JSON.stringify(summary, null, 1))
