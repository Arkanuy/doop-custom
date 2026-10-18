/**
 * The streaming path (MCP append_frame_html) writes HTML in fragments, so it
 * cannot use stripHtmlPackaging — it needs the whole document. This pins the
 * boundary rule the code actually applies: trim the lead-in on the opening
 * chunk and the commentary on the final one, leave the middle alone.
 */
function trimOpening(piece: string): string {
  const doctypeAt = piece.search(/<!doctype\s+html/i)
  const htmlTagAt = piece.search(/<html(?:\s|>)/i)
  const startAt = doctypeAt !== -1 ? doctypeAt : htmlTagAt
  return startAt > 0 ? piece.slice(startAt) : piece
}

function trimClosing(piece: string): string {
  const tail = piece.search(/<\/html>/i)
  return tail !== -1 ? piece.slice(0, tail + '</html>'.length) : piece
}

/* a realistic streamed design: noisy opening chunk, quiet middle, noisy end */
const chunks = [
  'Here is the design you asked for.\n```html\n<!doctype html>\n<html><head><style>body{background:#111;color:#eee}',
  '</style></head><body><h1>Keuangan</h1><section class="kpi">Rp 82.450.000</section>',
  '</body></html>\n```\nLet me know if you want the mobile version!',
]

let html = ''
chunks.forEach((chunk, i) => {
  let piece = chunk
  if (i === 0) piece = trimOpening(piece)
  if (i === chunks.length - 1) piece = trimClosing(piece)
  html = i === 0 ? piece : html + piece
})

console.log('streamed result:')
console.log(`  starts with doctype: ${/^<!doctype html>/i.test(html)}`)
console.log(`  ends with </html>:   ${/<\/html>$/i.test(html)}`)
console.log(`  contains fence:      ${html.includes('```')}`)
console.log(`  contains lead-in:    ${/Here is the design/i.test(html)}`)
console.log(`  contains commentary: ${/Let me know if you want/i.test(html)}`)
console.log(`  keeps the design:    ${html.includes('Keuangan') && html.includes('82.450.000')}`)
console.log(`  length: ${html.length}`)

const ok =
  /^<!doctype html>/i.test(html) &&
  /<\/html>$/i.test(html) &&
  !html.includes('```') &&
  !/Here is the design/i.test(html) &&
  !/Let me know if you want/i.test(html) &&
  html.includes('Keuangan')
console.log(ok ? '\nPASS' : '\nFAIL')
process.exit(ok ? 0 : 1)
