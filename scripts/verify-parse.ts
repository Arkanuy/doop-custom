/**
 * Prove the transport tolerates what 9Router actually sends. Run:
 *   npx tsx --env-file-if-exists=.env scripts/verify-parse.ts
 *
 * The failure the resident agent hit was a body shaped like:
 *   {"id":...}data: [DONE]     <- sentinel glued on, no newline
 * which made res.json() throw "Unexpected non-whitespace character after JSON".
 */
import { customChatConfig, runChatCompletionsTurn } from '../server/chatCompletionsAgent.ts'

const config = customChatConfig()
if (!config) {
  console.log('NO_ENDPOINT — set DOOP_CUSTOM_CHAT_URL and DOOP_CUSTOM_CHAT_MODEL')
  process.exit(1)
}
console.log(`endpoint: ${config.url}  model: ${config.model}`)

/* case 1: a real round trip through the production transport */
const turn = await runChatCompletionsTurn(config, {
  system: 'You are terse.',
  tools: [],
  messages: [{ role: 'user', content: 'Reply with exactly: PARSE-OK' }],
  maxTokens: 20,
})
const text = turn.content
  .filter((b) => b.type === 'text')
  .map((b) => (b as { text: string }).text)
  .join('')
console.log(`case1 production transport: stop_reason=${turn.stop_reason} text=${JSON.stringify(text.trim())}`)

/* case 2: show what the endpoint returns when streaming is asked for, so the
   framing the tolerant parser has to survive is recorded as evidence */
const streamed = await fetch(config.url, {
  method: 'POST',
  headers: { ...config.headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: config.model,
    messages: [{ role: 'user', content: 'Reply with exactly: GLUED-OK' }],
    max_tokens: 20,
    stream: true,
  }),
})
const raw = await streamed.text()
console.log(`case2 content-type: ${streamed.headers.get('content-type')}`)
console.log(`case2 raw tail: ${JSON.stringify(raw.slice(-48))}`)
console.log(`case2 carries the [DONE] sentinel: ${/data:\s*\[DONE\]/.test(raw)}`)
