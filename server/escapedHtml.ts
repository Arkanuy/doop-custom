/**
 * Agents sometimes send HTML-escaped markup (`&lt;!doctype html&gt;…`) where raw
 * tags belong. Stored verbatim, the frame renders those entities as text and the
 * human watches the design's own source code appear on the canvas.
 *
 * A document that carries escaped tags and not one raw `<` has no elements at
 * all, so it can only be a mis-encoded write — decode it rather than render
 * source. Anything holding real markup is left untouched, which keeps escaped
 * code samples inside a genuine design safe.
 */

/* a tag opener admits no space after the `<`, which keeps prose like
   "widths under &lt; 600px" out of the match */
const ESCAPED_TAG = /&(?:lt|#0*60|#[xX]0*3[cC]);[/!a-zA-Z]/

/** True only for a payload that is markup, but entirely escaped. */
export function looksEscapedHtml(html: string): boolean {
  return !html.includes('<') && ESCAPED_TAG.test(html)
}

/** Reverse one level of HTML escaping. `&amp;` goes last so `&amp;lt;` → `&lt;`. */
export function decodeEscapedHtml(html: string): string {
  return html
    .replace(/&(?:lt|#0*60|#[xX]0*3[cC]);/g, '<')
    .replace(/&(?:gt|#0*62|#[xX]0*3[eE]);/g, '>')
    .replace(/&(?:quot|#0*34|#[xX]0*22);/g, '"')
    .replace(/&(?:apos|#0*39|#[xX]0*27);/g, "'")
    .replace(/&(?:amp|#0*38|#[xX]0*26);/g, '&')
}

export function repairEscapedHtml(html: string): string {
  return looksEscapedHtml(html) ? decodeEscapedHtml(html) : html
}

/**
 * Give a frame document the head it needs to be a document.
 *
 * WCAG 2.4.2 requires a non-empty `<title>`; measured against the external
 * audit, every frame Doop produced was missing one, so the tab is blank and a
 * screen reader names the frame nothing. `lang` on `<html>` matters for the
 * same reason (3.1.1).
 *
 * Only fills what is absent or empty: a title the model wrote is the model's
 * choice and is left alone. `fallbackTitle` is the frame's name, so the result
 * is at least as specific as the canvas UI.
 */
export function ensureDocumentHead(html: string, fallbackTitle: string): string {
  let out = html

  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(out)
  const safeFallback = fallbackTitle.replace(/[<>&]/g, '').trim() || 'Doop frame'
  if (titleMatch) {
    if (!titleMatch[1]?.trim()) {
      out = out.replace(titleMatch[0], `<title>${safeFallback}</title>`)
    }
  } else if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head([^>]*)>/i, `<head$1><title>${safeFallback}</title>`)
  } else if (/<html[^>]*>/i.test(out)) {
    out = out.replace(/<html([^>]*)>/i, `<html$1><head><title>${safeFallback}</title></head>`)
  }

  /* lang: only add when the attribute is entirely absent, never overwrite a
     language the author chose */
  if (/<html(?![^>]*\blang\b)[^>]*>/i.test(out)) {
    out = out.replace(/<html([^>]*)>/i, '<html lang="en"$1>')
  }

  return out
}

/**
 * Strip the packaging models wrap their markdown around the document:
 * a code fence, a sentence of lead-in, or a closing commentary appended after
 * `</html>`.
 *
 * Measured on this instance: 5 of 5 sampled designs came back with at least
 * one of those, and the tail leaked into the frame as visible text under the
 * design (763 characters in the worst case). The check lives here, beside the
 * escaping repair, because this module is the single place that turns "what a
 * model sent" into "what the canvas stores" — putting it in the agent loop
 * only would leave the MCP tool path, the HTTP API and the UI unguarded.
 *
 * Returns the input unchanged when there is no document to find, so callers
 * keep whatever validation they already have.
 */
export function stripHtmlPackaging(value: string): string {
  let html = value.trim()
  if (!html) return value

  /* a fence around the whole payload */
  const fenced = html.match(/^```(?:html|HTML)?\s*\n([\s\S]*?)\n?```\s*$/)
  if (fenced?.[1]) html = fenced[1].trim()

  const doctypeAt = html.search(/<!doctype\s+html/i)
  const htmlTagAt = html.search(/<html(?:\s|>)/i)
  const startAt = doctypeAt !== -1 ? doctypeAt : htmlTagAt
  if (startAt === -1) return html

  html = html.slice(startAt)
  const closeAt = html.search(/<\/html>/i)
  if (closeAt !== -1) html = html.slice(0, closeAt + '</html>'.length)
  return html.trim()
}

/** Told to the agent whenever a write was repaired, so it stops escaping. */
export const ESCAPED_HTML_NOTE =
  'That HTML arrived escaped (&lt;div&gt; where <div> belongs), which renders as visible source text on the canvas. Doop decoded it so the frame still shows a design — send raw markup from here on: these tools take HTML exactly as written, no escaping.'
