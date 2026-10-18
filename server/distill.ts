import { env } from './env.ts'
import Anthropic from '@anthropic-ai/sdk'
import { store } from './store.ts'
import * as actions from './actions.ts'
import { customChatConfig } from './chatCompletionsAgent.ts'
import type { ChatCompletionsConfig } from './chatCompletionsAgent.ts'

/**
 * The Memory distiller: when enough undistilled design decisions pile up on a
 * canvas, a small model reads them and — if a durable preference shows through
 * — proposes ONE rule to add to a style guide. The proposal is only ever
 * pending: a human accepts it into the guide (versioned like any edit) or
 * dismisses it. Auto-committed memory goes noisy; curated memory stays trusted.
 *
 * Event-driven, not scheduled: captureDecision pokes maybeDistill, so quiet
 * canvases cost nothing. Enabled when ANTHROPIC_API_KEY is set; silently
 * disabled otherwise, like the resident agents.
 */

const MODEL = env.DOOP_DISTILL_MODEL
/** most recent unconsumed decisions the judge sees per run */
const MAX_WINDOW = 15

let client: Anthropic | null = null

/**
 * The model that reads decisions and writes preferences.
 *
 * Two transports, because a self-hosted Doop may legitimately have neither an
 * Anthropic key nor a desire for one:
 *
 *  - a custom OpenAI-compatible endpoint (DOOP_AGENT_PROVIDER=custom), which is
 *    what a self-hoster runs the whole agent on, and therefore what this should
 *    use — the distiller used to require ANTHROPIC_API_KEY specifically, so on
 *    a custom-endpoint instance memory silently never learned anything;
 *  - Anthropic, for the hosted setup.
 *
 * Returns null when neither is configured: memory then stays a plain record of
 * what humans asked for, without inferred rules. That is a degradation, not an
 * error, so nothing logs on every decision.
 */
function distillTarget(): { kind: 'chat'; config: ChatCompletionsConfig } | { kind: 'anthropic'; client: Anthropic } | null {
  const custom = customChatConfig()
  if (custom) return { kind: 'chat', config: custom }
  if (env.ANTHROPIC_API_KEY) {
    if (!client) client = new Anthropic()
    return { kind: 'anthropic', client }
  }
  return null
}

/** True when memory inference can run at all — the UI reports this. */
export function distillerEnabled(): boolean {
  return distillTarget() !== null
}

/** One-shot completion through whichever transport is configured. */
async function complete(prompt: string, maxTokens: number): Promise<string> {
  const target = distillTarget()
  if (!target) return ''
  if (target.kind === 'anthropic') {
    const res = await target.client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    })
    return res.content
      .filter((b): b is (typeof res.content)[number] & { type: 'text' } => b.type === 'text')
      .map((b) => b.text)
      .join('')
  }
  /* the custom endpoint speaks Chat Completions; a plain request, no tools,
     because this is a text-in text-out rewrite.
     The output-token field is negotiated rather than guessed: max_tokens is
     deprecated, max_completion_tokens is refused by older servers, and some
     gateways reject both at once ("provide only one output token limit") — the
     same three-way split the agent transport handles, so this reuses the same
     helper instead of re-deriving it and drifting. */
  const { runTextCompletion } = await import('./chatCompletionsAgent.ts')
  return runTextCompletion(target.config, prompt, maxTokens)
}

const running = new Set<string>()

/** A decision was captured: generalize its raw words into a short preference
 *  ("more white and blue, not so claude-esque" → "Prefer white and blue…"),
 *  then check whether enough decisions accumulated to propose a rule. */
export function onDecision(canvasId: string, decisionId: string) {
  if (!distillTarget()) return
  summarizeDecision(canvasId, decisionId)
    .catch((err) => console.error('[distill] summarize failed', err))
    .finally(() => maybeDistill(canvasId))
}

async function summarizeDecision(canvasId: string, decisionId: string) {
  const decision = actions.getDecisions(canvasId).find((d) => d.id === decisionId)
  if (!distillTarget() || !decision || decision.summary) return
  const summary = (
    await complete(
      `Raw design feedback a human gave an agent on a shared canvas (the agent carried it out):
"${decision.text}"

Rewrite it as ONE short, general style preference for this project's design memory. Generalize from the specific instance to the underlying taste — e.g. "make this button blue like the others" becomes "Prefer blue accent buttons". Imperative, under 90 characters, no quotes, no trailing period. Reply with the preference only.`,
      100,
    )
  )
    .trim()
    .replace(/^["“]+|["”.]+$/g, '')
    .slice(0, 120)
  if (summary) {
    actions.setDecisionSummary(canvasId, decisionId, summary)
    console.log(`[distill] summarized canvas=${canvasId} "${decision.text.slice(0, 40)}…" -> "${summary}"`)
  }
}

/* Every captured decision gets judged — no "wait for N" gate. Whether one
   decision warrants a rule is a semantic question ("never use italics" is a
   standing rule on its own; "nudge this button left" is not), so the bar
   lives in the judge prompt, not in a counter. Decisions are only consumed
   when a rule IS proposed, so slow-building patterns keep their evidence. */
export function maybeDistill(canvasId: string) {
  if (!distillTarget() || running.has(canvasId)) return
  if (actions.undistilledDecisions(canvasId).length === 0) return
  /* one open proposal at a time — a stack of pending cards reads as spam */
  if (actions.getProposals(canvasId).some((p) => p.status === 'pending')) return
  running.add(canvasId)
  distill(canvasId)
    .catch((err) => console.error('[distill] run failed', err))
    .finally(() => running.delete(canvasId))
}

/**
 * Pull the first balanced JSON object out of a model reply.
 *
 * We ask for bare JSON, but a chat model may still wrap it in a sentence or a
 * code fence — and on the custom transport there is no `tool_choice` to force
 * a schema, so the reply is text. Scanning for the first `{` and matching
 * braces (ignoring those inside strings) keeps the whole thing from failing
 * over a chatty preamble.
 */
function extractJsonObject(text: string): unknown {
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

async function distill(canvasId: string) {
  if (!distillTarget()) return
  const decisions = actions.undistilledDecisions(canvasId).slice(0, MAX_WINDOW)
  if (decisions.length === 0) return
  const guides = store.getGuidelines(canvasId)

  const guideList = guides.length
    ? guides.map((g) => `- ${g.name} ("${actions.guidelineTitle(g)}"): ${actions.guidelineSummary(g)}`).join('\n')
    : '(none yet)'
  const decisionList = decisions
    .map((d) =>
      d.summary
        ? `- [${d.id}] ${d.summary} (${d.from}'s words: "${d.text}")`
        : `- [${d.id}] ${d.from} asked${d.agentName ? ` ${d.agentName}` : ''}: "${d.text}"`,
    )
    .join('\n')
  /* what was already pitched: never re-propose a dismissed rule, don't repeat
     an accepted one (it lives in a guide now anyway) */
  const priorProposals = actions
    .getProposals(canvasId)
    .filter((p) => p.status !== 'pending')
    .slice(0, 5)
  const proposalList = priorProposals.length
    ? priorProposals.map((p) => `- [${p.status}] ${p.rule}`).join('\n')
    : '(none)'

  const prompt = `You maintain the design memory of a shared canvas. Humans gave agents the following feedback, and each item below was carried out — they are settled decisions, newest first:

${decisionList}

Style guides already on this canvas:
${guideList}

Rules previously suggested from this memory (dismissed = the human rejected it; never re-propose it or a trivial variant):
${proposalList}

If these decisions reveal a durable style preference, distill it into ONE markdown bullet for the most fitting guide. Judge by substance, not count:
- ONE decision is enough when it is stated as a standing preference — "never/always …", "keep that as our signature style", "prefer X over Y", or a general taste like "less claude-esque, more white and blue".
- Several decisions correcting in the same direction are enough even if each was phrased as a one-off.
- A single tweak scoped to one design ("nudge this button left", "fix this heading") is NOT a rule — report has_rule: false and wait for more evidence.
Do not restate anything a guide already covers. Prefer an existing guide's slug; invent a new slug only when nothing fits.

Reply with ONLY a JSON object, no prose and no code fence:
{"has_rule": boolean, "guide_name": "slug-or-omit", "guide_title": "Title Case or omit", "rule": "the markdown bullet, or omit when has_rule is false", "rationale": "one short sentence, or omit"}`

  console.log(`[distill] run canvas=${canvasId} decisions=${decisions.length}`)
  const raw = await complete(prompt, 1000)

  /* whichever transport answered, we asked for a JSON object — take the first
     balanced {...} so a chatty model that adds a sentence still parses */
  const parsed = extractJsonObject(raw)
  const input = (parsed ?? {}) as {
    has_rule?: boolean
    guide_name?: string
    guide_title?: string
    rule?: string
    rationale?: string
  }
  if (!input.has_rule || !input.rule?.trim()) {
    console.log(`[distill] no rule canvas=${canvasId}`)
    return
  }
  const slug = (input.guide_name ?? 'style-notes')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  const proposal = actions.addProposal(canvasId, {
    guideName: actions.GUIDELINE_NAME_RE.test(slug) ? slug : 'style-notes',
    guideTitle: input.guide_title?.trim().slice(0, 80) || undefined,
    rule: input.rule.trim(),
    rationale: input.rationale?.trim() || 'Distilled from recent feedback.',
    basedOn: decisions.map((d) => d.id),
  })
  /* evidence is consumed only when it turns into a proposal — a "no rule yet"
     verdict leaves the decisions in the window so a slow-building pattern is
     never buried. Re-runs only happen on NEW captures, so this cannot loop. */
  actions.markDecisionsDistilled(
    canvasId,
    decisions.map((d) => d.id),
  )
  console.log(`[distill] proposed canvas=${canvasId} guide=${proposal.guideName} rule=${proposal.rule.slice(0, 80)}`)
}
