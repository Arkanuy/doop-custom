# Custom OpenAI-compatible endpoint (local addition)

Not upstream Doop. Added on this machine so the agent can run on an
operator-controlled endpoint instead of Anthropic / OpenAI / OpenRouter.

## What it does

`DOOP_AGENT_PROVIDER=custom` makes the server's free-tier agent run against any
OpenAI-compatible Chat Completions API. Settings → Doop Agent → **Custom
endpoint** writes the values; no shell access needed.

## Env variables (all in the instance `.env`)

| Variable                  | Meaning                                                                        |
| ------------------------- | ------------------------------------------------------------------------------ |
| `DOOP_CUSTOM_CHAT_URL`    | Full chat-completions route, e.g. `http://localhost:20128/v1/chat/completions` |
| `DOOP_CUSTOM_CHAT_KEY`    | Bearer token; leave empty for a gateway that needs none                        |
| `DOOP_CUSTOM_CHAT_MODEL`  | Model id the endpoint expects                                                  |
| `DOOP_CUSTOM_CHAT_LABEL`  | Shown on the agent status line                                                 |
| `DOOP_CUSTOM_CHAT_VISION` | `false` for a text-only model (runs then skip visual review)                   |

URL and model must BOTH be set, otherwise `customChatConfig()` returns null and
the tier reports itself off instead of booting broken.

## Files touched

- `server/env.ts` — the five vars, plus `custom` added to `DOOP_AGENT_PROVIDER` choices
- `server/chatCompletionsAgent.ts` — `customChatConfig()`
- `server/agentModel.ts` — `custom` server tier
- `server/envFile.ts` — NEW: atomic `.env` key writer
- `server/index.ts` — `GET/PUT/DELETE /api/custom-endpoint` (admin-only)
- `src/lib/api.ts` — `customEndpoint` / `saveCustomEndpoint` / `clearCustomEndpoint`
- `src/components/CustomEndpoint.tsx` — NEW: the Settings card
- `src/pages/Settings.tsx` — renders it
- `.env.example`, `vitest.unit.config.ts`, `scripts/verify-custom-endpoint.ts`

## Why the URL is an env var and not a form field

Doop's own comment in `chatCompletionsAgent.ts` explains the upstream refusal:

> this module never takes a user-supplied endpoint: a configurable base URL
> would be a server-side fetch target, i.e. an SSRF into whatever network Doop
> runs on.

The server fetches this URL on every turn. If any visitor could type it, the
server becomes a fetch primitive pointed at `169.254.169.254`, internal
services, etc. So the write path is admin-gated and lands in the operator's
`.env`; the trust boundary stays exactly where upstream put it.

## Two traps worth remembering

1. **Writing `.env` is not enough to change a running server.** Node reads
   `--env-file` once at boot and `reloadEnv()` re-parses `process.env`, not the
   file. `writeEnvKey()` therefore mirrors the value into `process.env` as
   well. Without that mirror the API reports success, persists the value, and
   keeps serving the old one until restart. (Cost a debugging round.)
2. **`bun run test` cannot pass on Windows.** `tests/globalSetup.ts` builds a
   PGlite template by `rmSync`-ing a temp dir, which throws `EPERM` while a
   previous run's server still holds the path. This fails on a pristine
   checkout too — it is not a regression from these changes. Verify unit tests
   with:

   ```
   npx vitest run --config vitest.unit.config.ts
   ```

   (`vitest.unit.config.ts` drops globalSetup, which pure unit tests don't need.)

## Verify

```bash
npx tsx --env-file-if-exists=.env scripts/verify-custom-endpoint.ts
```

Round-trips write → reload → `customChatConfig()`, asserts the key is not
duplicated, clears, and restores `.env` afterwards.

## Running Doop here

```bash
cd D:/tools/doop
npx tsx --env-file-if-exists=.env server/index.ts   # :4400 API + MCP
npx vite                                            # :4300 web
```

Do not use `bun run dev` here: `concurrently` swallows the server's output, so
a boot failure looks like silence. `CHROME_PATH` must be set in `.env` for
`get_frame_screenshot`.
