/**
 * Proof the wiring reaches the endpoint: read the configured endpoint through
 * the same config builder the agent uses, then POST a minimal completion and
 * report what came back. Uses whatever DOOP_CUSTOM_CHAT_* is in .env.
 */
import { customChatConfig } from '../server/chatCompletionsAgent.ts'

const config = customChatConfig()
if (!config) {
  console.log('NO_ENDPOINT: customChatConfig() is null — set DOOP_CUSTOM_CHAT_URL and DOOP_CUSTOM_CHAT_MODEL first')
  process.exit(0)
}
console.log(`config: ${config.label} @ ${config.url} (model=${config.model})`)

const res = await fetch(config.url, {
  method: 'POST',
  headers: { ...config.headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: config.model,
    messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
    max_tokens: 20,
  }),
})
console.log(`endpoint replied HTTP ${res.status}`)
const body = await res.text()
console.log(body.slice(0, 400))
