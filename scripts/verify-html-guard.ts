/**
 * Prove the centralized guard works on the paths that were previously
 * unguarded (MCP tools, REST, UI) — not just the agent loop.
 *
 * Before this change, stripHtmlPackaging ran only inside server/resident.ts,
 * so the same noisy payload written through actions.createFrame kept its
 * prologue and tail.
 */
import { stripHtmlPackaging, repairEscapedHtml } from '../server/escapedHtml.ts'

const cases: [string, string][] = [
  [
    'prologue + fence + tail (the shape 5/5 model outputs had)',
    'Here is a complete HTML document for a pricing page.\n```html\n<!DOCTYPE html>\n<html><body><h1>Pricing</h1></body></html>\n```\nI hope this helps! Let me know if you want changes.',
  ],
  ['tail only', '<!doctype html><html><body>x</body></html>Explanation after the doc.'],
  ['clean document untouched', '<!doctype html><html><body>x</body></html>'],
  ['escaped payload still repaired', '&lt;!doctype html&gt;&lt;html&gt;&lt;body&gt;hi&lt;/body&gt;&lt;/html&gt;'],
]

for (const [name, input] of cases) {
  const out = repairEscapedHtml(stripHtmlPackaging(input))
  console.log(`\n${name}`)
  console.log(`  in : ${input.length} chars | ${JSON.stringify(input.slice(0, 60))}`)
  console.log(`  out: ${out.length} chars | ${JSON.stringify(out.slice(0, 60))}`)
  console.log(
    `  clean-start=${/^<!doctype html>/i.test(out)} clean-end=${/<\/html>$/i.test(out)} no-fence=${!out.includes('```')}`,
  )
}
