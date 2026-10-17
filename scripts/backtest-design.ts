/**
 * Backtest harness: does the configured endpoint actually produce a usable
 * design at the size Doop asks for?
 *
 * Doop requests max_tokens: 16000 per turn and expects a complete HTML
 * document back. If the endpoint truncates earlier, the frame renders as
 * half a page — the "hancur" a human reports — and nothing in the pipeline
 * says so, because a truncated-but-valid response looks like success.
 *
 * This asks for exactly that shape and measures what really comes back:
 * stop reason, finish reason, length, and whether the HTML is well-formed.
 *
 *   npx tsx --env-file-if-exists=.env scripts/backtest-design.ts [runs]
 */
import { customChatConfig, runChatCompletionsTurn } from '../server/chatCompletionsAgent.ts'

const RUNS = Number(process.argv[2] ?? 1)
const config = customChatConfig()
if (!config) {
  console.log('NO_ENDPOINT')
  process.exit(1)
}

/* A spread of archetypes, so a failure mode shows up as a pattern rather than
   a one-off. Kept short on purpose: the point is the OUTPUT budget, not the
   prompt. */
const PROMPTS = [
  'Mobile-first finance admin panel: balance header, income/expense rows, a small bar chart. Dark theme.',
  'SaaS pricing page with three tiers and a feature comparison row. Light, editorial.',
  'Restaurant landing hero: one big headline, reservation CTA, three dish cards.',
  'Analytics dashboard card: one KPI number, a sparkline, and a delta badge.',
  'Personal portfolio header: name in display type, role label, two links.',
]

interface Result {
  prompt: string
  ok: boolean
  stopReason: string
  chars: number
  blocks: number
  hasDoctype: boolean
  closesHtml: boolean
  ms: number
  error?: string
}

const results: Result[] = []

for (let i = 0; i < RUNS; i++) {
  const prompt = PROMPTS[i % PROMPTS.length]
  const started = Date.now()
  process.stdout.write(`run ${i + 1}/${RUNS}: ${prompt.slice(0, 48)}… `)
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
    const r: Result = {
      prompt,
      ok: true,
      stopReason: turn.stop_reason,
      chars: html.length,
      blocks: turn.content.length,
      hasDoctype: /<!doctype html/i.test(html),
      closesHtml: /<\/html>/i.test(html),
      ms: Date.now() - started,
    }
    results.push(r)
    console.log(`stop=${r.stopReason} chars=${r.chars} doctype=${r.hasDoctype} closed=${r.closesHtml} ${r.ms}ms`)
  } catch (err) {
    const r: Result = {
      prompt,
      ok: false,
      stopReason: '-',
      chars: 0,
      blocks: 0,
      hasDoctype: false,
      closesHtml: false,
      ms: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    }
    results.push(r)
    console.log(`ERROR ${r.error}`)
  }
}

const ok = results.filter((r) => r.ok)
const truncated = ok.filter((r) => r.stopReason === 'max_tokens' || !r.closesHtml)
console.log('\n=== SUMMARY ===')
console.log(`runs=${results.length} ok=${ok.length} errored=${results.length - ok.length}`)
console.log(`truncated_or_incomplete=${truncated.length}`)
if (ok.length) {
  const lens = ok.map((r) => r.chars).sort((a, b) => a - b)
  console.log(`chars min=${lens[0]} median=${lens[Math.floor(lens.length / 2)]} max=${lens[lens.length - 1]}`)
  const avg = Math.round(ok.reduce((s, r) => s + r.ms, 0) / ok.length)
  console.log(`avg_ms=${avg}`)
  console.log(`full_document=${ok.filter((r) => r.hasDoctype && r.closesHtml).length}/${ok.length}`)
}
console.log(`model=${config.model}`)
console.log(JSON.stringify(results, null, 1))
