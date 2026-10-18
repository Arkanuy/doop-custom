/**
 * Prove the memory distiller now runs on a custom endpoint.
 *
 * It used to return early unless ANTHROPIC_API_KEY was set, so on a
 * custom-endpoint instance (DOOP_AGENT_PROVIDER=custom) design memory silently
 * never learned anything: decisions were recorded, and no rule was ever
 * inferred from them.
 *
 * This asks the same two questions the real pipeline asks — can it reach a
 * model, and does a decision turn into a usable preference — without touching
 * any canvas.
 */
import { customChatConfig, runTextCompletion } from '../server/chatCompletionsAgent.ts'

const config = customChatConfig()
if (!config) {
  console.log('NO_ENDPOINT — customChatConfig() is null')
  process.exit(1)
}
console.log(`transport: custom endpoint ${config.label} @ ${config.url} (${config.model})`)

/* exercise the production transport, so what passes here is what the server
   will run — not a re-implementation that can drift from it */
const complete = (prompt: string, maxTokens: number) => runTextCompletion(config, prompt, maxTokens)

/* step 1 — the summarize pass: raw feedback becomes one imperative preference */
const raw = 'stop using that italic serif for headings, it reads like a wedding invite'
const summary = (
  await complete(
    `Raw design feedback a human gave an agent on a shared canvas (the agent carried it out):
"${raw}"

Rewrite it as ONE short, general style preference for this project's design memory. Generalize from the specific instance to the underlying taste. Imperative, under 90 characters, no quotes, no trailing period. Reply with the preference only.`,
    100,
  )
)
  .trim()
  .replace(/^["“]+|["”.]+$/g, '')
  .slice(0, 120)
console.log(`\n1) summarize  -> "${summary}"`)
console.log(`   usable: ${summary.length > 0 && summary.length <= 120 && !summary.includes('\n')}`)

/* step 2 — the judge pass: a standing preference must yield a rule, and a
   one-off tweak must NOT. That distinction is the whole point of the feature. */
function extractJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}

async function judge(decisionText: string): Promise<Record<string, unknown> | null> {
  const out = await complete(
    `You maintain the design memory of a shared canvas. Decisions carried out, newest first:
- [d1] Arkan asked: "${decisionText}"

Style guides already on this canvas:
(none yet)

Rules previously suggested from this memory:
(none)

If these decisions reveal a durable style preference, distill it into ONE markdown bullet. A single tweak scoped to one design ("nudge this button left") is NOT a rule — report has_rule: false.

Reply with ONLY a JSON object, no prose and no code fence:
{"has_rule": boolean, "guide_name": "slug-or-omit", "guide_title": "Title Case or omit", "rule": "the markdown bullet, or omit when has_rule is false", "rationale": "one short sentence, or omit"}`,
    1000,
  )
  return extractJsonObject(out)
}

const standing = await judge('never use italic serif headings again — keep that as our signature style')
console.log(`\n2) standing preference -> has_rule=${standing?.has_rule} rule=${JSON.stringify(standing?.rule ?? null)}`)

const oneOff = await judge('nudge this button two pixels to the left')
console.log(`   one-off tweak      -> has_rule=${oneOff?.has_rule} (should be false)`)

const ok =
  summary.length > 0 &&
  standing?.has_rule === true &&
  typeof standing.rule === 'string' &&
  standing.rule.length > 0 &&
  oneOff?.has_rule === false
console.log(ok ? '\nPASS — distiller works on the custom endpoint' : '\nCHECK — see values above')
process.exit(ok ? 0 : 1)
