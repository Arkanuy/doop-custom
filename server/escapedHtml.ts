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
