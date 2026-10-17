import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { CustomEndpointStatus } from '../lib/api'
import { posthog } from '../lib/posthog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Card, CardDescription, CardHeader, CardTitle } from './ui/card'
import { CheckIcon } from './ui/icons'

/**
 * "Run the agent on an endpoint I control."
 *
 * This card exists because `DOOP_CUSTOM_CHAT_URL` is deliberately not a
 * browser-facing field: the server fetches that URL on every turn, so a target
 * typed in by any visitor would turn Doop into an SSRF primitive. The card
 * therefore writes the *operator's* `.env` (through an admin-only route) and
 * shows the result — it never invents a runtime override.
 *
 * Two consequences worth stating in the UI rather than hiding:
 *  - only an instance admin sees it enabled; everyone else gets the 403 text;
 *  - the stored key is write-only. The form shows whether one is set
 *    (`hasKey`) and leaving the field blank keeps it, which is the only sane
 *    behaviour when the value can never be read back.
 */
export function CustomEndpointCard() {
  const [status, setStatus] = useState<CustomEndpointStatus | null>(null)
  const [url, setUrl] = useState('')
  const [model, setModel] = useState('')
  const [label, setLabel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [vision, setVision] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const apply = useCallback((next: CustomEndpointStatus) => {
    setStatus(next)
    setUrl(next.url)
    setModel(next.model)
    setLabel(next.label)
    setVision(next.vision)
    setApiKey('')
  }, [])

  const load = useCallback(() => {
    api.customEndpoint().then(apply, () => setStatus(null))
  }, [apply])
  useEffect(load, [load])

  /* no card at all for a non-admin: the route answers 403 and there is nothing
     useful for them to see or do here */
  if (!status) return null

  async function save() {
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      const next = await api.saveCustomEndpoint({
        url,
        model,
        label,
        vision,
        /* undefined keeps the stored key; '' clears it */
        ...(apiKey ? { apiKey } : {}),
      })
      apply(next)
      setSaved(true)
      posthog.capture('custom_endpoint_saved', { enabled: next.enabled })
    } catch (e) {
      const body = (e as { body?: { error?: string } })?.body
      setError(body?.error || (e instanceof Error ? e.message : 'That did not work — try again'))
    } finally {
      setBusy(false)
    }
  }

  async function clear() {
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      apply(await api.clearCustomEndpoint())
    } catch (e) {
      const body = (e as { body?: { error?: string } })?.body
      setError(body?.error || (e instanceof Error ? e.message : 'That did not work — try again'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="mt-4 max-w-[1000px] overflow-hidden sm:mt-5">
      <CardHeader>
        <CardTitle>Custom endpoint</CardTitle>
        <CardDescription>
          Point the agent at any OpenAI-compatible Chat Completions API you run or pay for — a gateway like LiteLLM,
          Ollama or vLLM, a vendor proxy, an aggregator. Saved to this instance’s <code>.env</code>, so it survives a
          restart.
        </CardDescription>
        {status.enabled && status.active && (
          <p className="mt-[11px] flex items-center gap-1.5 text-[11.5px] text-ink-faint">
            <CheckIcon width={12} height={12} strokeWidth={2.5} aria-hidden /> Configured — {status.active}
            {status.provider === 'custom'
              ? ' · serving the server tier (DOOP_AGENT_PROVIDER=custom)'
              : ' · set DOOP_AGENT_PROVIDER=custom to actually run on it'}
          </p>
        )}
      </CardHeader>

      <div className="flex flex-col gap-3 px-6 pb-6">
        <label className="flex flex-col gap-1.5 text-[12.5px]">
          <span className="font-medium text-ink">Endpoint URL</span>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http://localhost:20128/v1/chat/completions"
            spellCheck={false}
            autoComplete="off"
          />
          <span className="text-[11.5px] text-ink-faint">
            The full path to the Chat Completions route, not just the origin.
          </span>
        </label>

        <label className="flex flex-col gap-1.5 text-[12.5px]">
          <span className="font-medium text-ink">Model id</span>
          <Input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="gpt-4o-mini"
            spellCheck={false}
            autoComplete="off"
          />
          <span className="text-[11.5px] text-ink-faint">Exactly the id the endpoint expects in its request body.</span>
        </label>

        <label className="flex flex-col gap-1.5 text-[12.5px]">
          <span className="font-medium text-ink">Label</span>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Custom endpoint"
            spellCheck={false}
            autoComplete="off"
          />
          <span className="text-[11.5px] text-ink-faint">Shown on the agent status line.</span>
        </label>

        <label className="flex flex-col gap-1.5 text-[12.5px]">
          <span className="font-medium text-ink">API key</span>
          <Input
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            type="password"
            placeholder={
              status.hasKey ? '•••••••• (stored — leave blank to keep)' : 'Leave blank if the endpoint needs none'
            }
            spellCheck={false}
            autoComplete="off"
          />
        </label>

        <label className="flex items-center gap-2 text-[12.5px] text-ink">
          <input type="checkbox" checked={vision} onChange={(e) => setVision(e.target.checked)} />
          The model can see images (uncheck for a text-only model — runs then skip visual review)
        </label>

        <div className="flex items-center gap-2.5">
          <Button
            variant="primary"
            className="min-h-10 max-xs:px-3 md:min-h-0"
            onClick={save}
            disabled={busy || !url.trim() || !model.trim()}
          >
            {busy ? 'Saving…' : 'Save endpoint'}
          </Button>
          {status.enabled && (
            <Button variant="ghost" className="min-h-10 max-xs:px-3 md:min-h-0" onClick={clear} disabled={busy}>
              Remove
            </Button>
          )}
          {saved && <span className="text-[11.5px] text-ink-faint">Saved.</span>}
        </div>

        {error && <p className="text-[12.5px] text-accent-ink">{error}</p>}
      </div>
    </Card>
  )
}
