import { env } from './env.ts'
import { randomUUID } from 'node:crypto'
import type Anthropic from '@anthropic-ai/sdk'
import {
  IMAGE_NOTE,
  ModelUnavailableError,
  flattenToolResult,
  imagePart,
  isModelUnavailable,
  responseError,
} from './openaiAgent.ts'
import type { StopReason, TurnBlock, TurnRequest, TurnResult } from './openaiAgent.ts'

/**
 * Runs one Doop Agent turn against an OpenAI-compatible Chat Completions
 * endpoint, speaking the Anthropic message shape the agent loop is written
 * in. This is the transport behind the wide-roster providers:
 *
 *  - OpenRouter (a user's `sk-or-` key) — one key, many vendors' models;
 *  - Google Gemini (a user's AI Studio key), through Google's own
 *    OpenAI-compatibility endpoint.
 *
 * Both URLs are fixed constants. Like the Azure transport, this module never
 * takes a user-supplied endpoint: a configurable base URL would be a
 * server-side fetch target, i.e. an SSRF into whatever network Doop runs on.
 *
 * Chat Completions shares the Responses API's one real impedance mismatch:
 * `role: 'tool'` messages are text-only, so images inside tool results are
 * re-attached as a following user message (openaiAgent's flattenToolResult).
 * On top of that this transport carries the roster's second mismatch: some
 * models cannot see images at all. With `vision: false` every image — tool
 * result or user block — is replaced by a text note here, at the one choke
 * point all seven image-producing tools pass through, so no request can 400
 * on a modality the model lacks.
 */

export const OPENROUTER_URL = env.OPENROUTER_CHAT_URL
export const GEMINI_OPENAI_URL = env.GEMINI_OPENAI_CHAT_URL

/**
 * An operator-configured OpenAI-compatible endpoint (self-hosted gateway,
 * LiteLLM, vLLM, a proxy in front of several vendors, ...).
 *
 * This is the one non-constant URL the module will talk to, and it is read
 * from the environment at call time rather than from a request body. The
 * distinction is the whole safety argument for it existing: the operator of
 * this Doop instance chooses the target, so the server is not turned into a
 * fetch primitive for whoever can open the Settings page. Value changes are
 * picked up by reloadEnv, so the Settings panel can switch endpoints without
 * a restart.
 */
export function customChatConfig(): ChatCompletionsConfig | null {
  const url = env.DOOP_CUSTOM_CHAT_URL
  const model = env.DOOP_CUSTOM_CHAT_MODEL
  if (!url || !model) return null
  const key = env.DOOP_CUSTOM_CHAT_KEY
  return {
    url,
    headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    model,
    label: env.DOOP_CUSTOM_CHAT_LABEL || 'Custom endpoint',
    vision: env.DOOP_CUSTOM_CHAT_VISION,
  }
}

export const IMAGE_OMITTED_NOTE = '[image omitted — the selected model cannot view images]'

const APP_ORIGIN = env.BETTER_AUTH_URL

export interface ChatCompletionsConfig {
  /** one of the fixed URL constants above — never user input */
  url: string
  headers: Record<string, string>
  model: string
  /** for error messages, e.g. "OpenRouter" */
  label: string
  /** false = strip every image into a text note before sending */
  vision: boolean
}

export function openrouterConfig(apiKey: string, model: string, vision: boolean): ChatCompletionsConfig {
  return {
    url: OPENROUTER_URL,
    /* the attribution headers are how OpenRouter credits the calling app */
    headers: { Authorization: `Bearer ${apiKey}`, 'HTTP-Referer': APP_ORIGIN, 'X-Title': 'Doop' },
    model,
    label: 'OpenRouter',
    vision,
  }
}

export function geminiConfig(apiKey: string, model: string, vision: boolean): ChatCompletionsConfig {
  return {
    url: GEMINI_OPENAI_URL,
    headers: { Authorization: `Bearer ${apiKey}` },
    model,
    label: 'Gemini',
    vision,
  }
}

/* ---------------------------------------------------------------- */
/* Anthropic messages -> Chat Completions messages                  */
/* ---------------------------------------------------------------- */

type ChatPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }

type ChatMessage =
  | { role: 'system' | 'user'; content: string | ChatPart[] }
  | { role: 'assistant'; content: string | null; tool_calls?: ChatToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

interface ChatToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

function toMessages(system: string, messages: Anthropic.MessageParam[], vision: boolean): ChatMessage[] {
  const out: ChatMessage[] = [{ role: 'system', content: system }]
  for (const message of messages) {
    if (typeof message.content === 'string') {
      out.push(
        message.role === 'assistant'
          ? { role: 'assistant', content: message.content }
          : { role: 'user', content: message.content },
      )
      continue
    }
    if (message.role === 'assistant') {
      const texts: string[] = []
      const calls: ChatToolCall[] = []
      for (const block of message.content) {
        if (block.type === 'text') texts.push(block.text)
        else if (block.type === 'tool_use') {
          calls.push({
            id: block.id,
            type: 'function',
            function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
          })
        }
      }
      out.push({
        role: 'assistant',
        content: texts.length > 0 ? texts.join('\n') : null,
        ...(calls.length > 0 ? { tool_calls: calls } : {}),
      })
      continue
    }
    /* a user message: tool results first (they must directly follow the
       assistant's tool_calls), then any remaining text/images, then the
       images the text-only tool messages had to leave behind */
    const userParts: ChatPart[] = []
    const trailingImages: ChatPart[] = []
    for (const block of message.content) {
      switch (block.type) {
        case 'tool_result': {
          const { text, images } = flattenToolResult(block)
          out.push({
            role: 'tool',
            tool_call_id: block.tool_use_id,
            content: vision
              ? text
              : text.replaceAll('[image returned — see the attached image below]', IMAGE_OMITTED_NOTE),
          })
          if (vision) {
            for (const image of images) {
              if (image.type === 'input_image')
                trailingImages.push({ type: 'image_url', image_url: { url: image.image_url } })
            }
          }
          break
        }
        case 'text':
          userParts.push({ type: 'text', text: block.text })
          break
        case 'image': {
          if (!vision) {
            userParts.push({ type: 'text', text: IMAGE_OMITTED_NOTE })
            break
          }
          const image = imagePart(block.source as never)
          if (image && image.type === 'input_image') {
            userParts.push({ type: 'image_url', image_url: { url: image.image_url } })
          }
          break
        }
        default:
          break
      }
    }
    if (userParts.length > 0) out.push({ role: 'user', content: userParts })
    if (trailingImages.length > 0) {
      out.push({ role: 'user', content: [...trailingImages, { type: 'text', text: IMAGE_NOTE }] })
    }
  }
  return out
}

function toTools(tools: Anthropic.Tool[]): unknown[] {
  return tools.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description ?? '', parameters: tool.input_schema },
  }))
}

/* ---------------------------------------------------------------- */
/* Chat Completions output -> Anthropic blocks                      */
/* ---------------------------------------------------------------- */

interface CompletionBody {
  /* OpenRouter reports some failures as an error object on a 200 */
  error?: { message?: string } | null
  choices?: {
    finish_reason?: string
    message?: {
      role?: string
      content?: string | null
      refusal?: string | null
      tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[]
    }
  }[]
}

/** A tool call as it arrives mid-stream: same shape, plus its slot index. */
interface StreamingToolCall {
  index?: number
  id?: string
  type?: 'function'
  function?: { name?: string; arguments?: string }
}

function fromCompletion(body: CompletionBody, label: string): TurnResult {
  if (body.error?.message) {
    throw isModelUnavailable(body.error.message)
      ? new ModelUnavailableError(`${label}: ${body.error.message}`)
      : new Error(`${label}: ${body.error.message}`)
  }
  const choice = body.choices?.[0]
  if (!choice?.message) throw new Error(`${label} returned an empty response`)
  const content: TurnBlock[] = []
  if (choice.message.content) content.push({ type: 'text', text: choice.message.content })
  const refused = Boolean(choice.message.refusal)
  let toolCalls = 0
  for (const call of choice.message.tool_calls ?? []) {
    toolCalls++
    let input: unknown
    try {
      input = call.function?.arguments ? JSON.parse(call.function.arguments) : {}
    } catch {
      /* a malformed argument blob becomes an empty call; the tool's own
         validation then returns a usable error to the model */
      input = {}
    }
    content.push({
      type: 'tool_use',
      id: call.id || `call_${randomUUID()}`,
      name: call.function?.name || 'unknown',
      input: input as Record<string, unknown>,
    })
  }
  const truncated = choice.finish_reason === 'length'
  const stop: StopReason = refused ? 'refusal' : toolCalls > 0 ? 'tool_use' : truncated ? 'max_tokens' : 'end_turn'
  /* a response with nothing in it would end the loop silently; make it a
     visible failure instead */
  if (content.length === 0 && !refused) throw new Error(`${label} returned an empty response`)
  return { content, stop_reason: stop }
}

/* ---------------------------------------------------------------- */
/* transport                                                        */
/* ---------------------------------------------------------------- */

export async function runChatCompletionsTurn(config: ChatCompletionsConfig, req: TurnRequest): Promise<TurnResult> {
  const body = {
    model: config.model,
    messages: toMessages(req.system, req.messages, config.vision),
    tools: toTools(req.tools),
    tool_choice: 'auto',
  }

  /* `max_tokens` is deprecated and newer models reject it outright; the
     replacement is `max_completion_tokens`. Sending only the new name breaks
     older OpenAI-compatible servers, sending only the old name breaks current
     OpenAI models and anything strict about it (vLLM in newer configs, some
     Azure deployments). So send both, and if a strict endpoint rejects the
     pair, retry once with only the field it complained about — that way one
     configuration works across the whole roster instead of pinning the
     operator to whichever dialect their gateway happens to speak. */
  const withBoth = { ...body, max_tokens: req.maxTokens, max_completion_tokens: req.maxTokens }
  let res = await fetch(config.url, {
    method: 'POST',
    headers: { ...config.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(withBoth),
  })

  if (!res.ok && res.status === 400) {
    const complaint = await res.text()
    /* providers phrase this several ways: "unsupported parameter:
       max_completion_tokens", "provide only one output token limit",
       "Unknown parameter: 'max_tokens'". Map each to the single field that
       will satisfy it; anything else is a real 400 and gets rethrown. */
    const wantsNewOnly = /max_completion_tokens/i.test(complaint) || /only one output token limit/i.test(complaint)
    const wantsOldOnly = /max_tokens/i.test(complaint) && !wantsNewOnly
    const retryBody = wantsNewOnly
      ? { ...body, max_completion_tokens: req.maxTokens }
      : wantsOldOnly
        ? { ...body, max_tokens: req.maxTokens }
        : null
    if (retryBody) {
      res = await fetch(config.url, {
        method: 'POST',
        headers: { ...config.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(retryBody),
      })
    } else {
      throw await responseError(new Response(complaint, { status: res.status }), config.label)
    }
  }

  if (!res.ok) throw await responseError(res, config.label)
  return fromCompletion(parseCompletionBody(await res.text(), config.label), config.label)
}

/**
 * Parse a Chat Completions response body that may carry SSE framing even
 * though we asked for a single JSON object.
 *
 * Gateways in front of the real API (9Router, and by extension anything
 * OpenAI-compatible that proxies upstream) can answer `text/event-stream`
 * regardless of the request, and some append a bare `data: [DONE]` line with
 * no newline between it and the JSON: `{...}data: [DONE]`. `res.json()` then
 * dies on "Unexpected non-whitespace character after JSON".
 *
 * So: take the text, drop any trailing `data:` sentinel, and when the body is
 * genuinely a stream (multiple `data:` events) collect the deltas into one
 * message instead of hoping a single chunk holds everything.
 */
function parseCompletionBody(raw: string, label: string): CompletionBody {
  const text = raw.trim()
  if (!text) throw new Error(`${label} returned an empty response body`)

  /* the common shapes first: plain JSON, possibly with a sentinel glued on */
  const sentinel = text.search(/data:\s*\[DONE\]/)
  if (sentinel !== -1) {
    const head = text.slice(0, sentinel).trim()
    if (head.startsWith('{')) return JSON.parse(head) as CompletionBody
    /* nothing but the sentinel — fall through to the SSE collector */
  } else if (text.startsWith('{')) {
    try {
      return JSON.parse(text) as CompletionBody
    } catch (err) {
      /* a stream whose first event is a JSON object: fall through */
      if (!text.includes('\ndata:')) throw err
    }
  }

  /* SSE: concatenate every `data:` payload into one completion */
  const events = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter((payload) => payload && payload !== '[DONE]')
  if (!events.length) {
    throw new Error(`${label} returned a response that is neither JSON nor SSE`)
  }

  const merged: CompletionBody = { choices: [{ message: { role: 'assistant', content: '' } }] }
  const choice = merged.choices![0]!
  const message = choice.message!
  for (const event of events) {
    const chunk = JSON.parse(event) as CompletionBody & {
      choices?: { delta?: { content?: string | null; tool_calls?: StreamingToolCall[] } }[]
    }
    const first = chunk.choices?.[0]
    if (!first) continue
    /* non-streamed chunks carry `message`, streamed ones carry `delta` */
    const delta = (first.message ?? first.delta) as
      { content?: string | null; tool_calls?: StreamingToolCall[] } | undefined
    if (!delta) continue
    if (delta.content) message.content = (message.content ?? '') + delta.content
    if (delta.tool_calls?.length) {
      /* tool calls stream by index; merge arguments onto the matching entry */
      message.tool_calls ??= []
      for (const call of delta.tool_calls) {
        const at = call.index ?? message.tool_calls.length
        const existing = message.tool_calls[at]
        if (existing)
          existing.function!.arguments = (existing.function!.arguments ?? '') + (call.function?.arguments ?? '')
        else message.tool_calls[at] = call
      }
    }
    if (first.finish_reason) choice.finish_reason = first.finish_reason
  }
  return merged
}

/**
 * A plain text completion — no tools, no message history, one prompt in and
 * the text out.
 *
 * This exists so callers that are NOT the agent loop (the memory distiller)
 * still go through the transport that negotiates the output-token field. Doing
 * their own `fetch` is how the distiller ended up sending both `max_tokens`
 * and `max_completion_tokens` and getting a hard 400 from a gateway that
 * refuses the pair — the failure the agent path had already solved.
 */
export async function runTextCompletion(
  config: ChatCompletionsConfig,
  prompt: string,
  maxTokens: number,
): Promise<string> {
  const body = { model: config.model, messages: [{ role: 'user', content: prompt }] }
  let res = await fetch(config.url, {
    method: 'POST',
    headers: { ...config.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, max_tokens: maxTokens, max_completion_tokens: maxTokens }),
  })
  if (!res.ok && res.status === 400) {
    const complaint = await res.text()
    const wantsNewOnly = /max_completion_tokens/i.test(complaint) || /only one output token limit/i.test(complaint)
    const wantsOldOnly = /max_tokens/i.test(complaint) && !wantsNewOnly
    const retryBody = wantsNewOnly
      ? { ...body, max_completion_tokens: maxTokens }
      : wantsOldOnly
        ? { ...body, max_tokens: maxTokens }
        : null
    if (retryBody) {
      res = await fetch(config.url, {
        method: 'POST',
        headers: { ...config.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(retryBody),
      })
    } else {
      throw await responseError(new Response(complaint, { status: res.status }), config.label)
    }
  }
  if (!res.ok) throw await responseError(res, config.label)
  const parsed = parseCompletionBody(await res.text(), config.label)
  return (parsed.choices?.[0]?.message?.content ?? '').trim()
}

/* exported for tests */
export const _internal = { toMessages, toTools, fromCompletion }
