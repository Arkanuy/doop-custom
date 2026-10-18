/**
 * Emoji used as functional icons.
 *
 * Measured on this instance: 121 of 180 generated designs shipped emoji as
 * icons (a ride-hailing page carried 42 of them). The external anti-slop
 * checker has a gate for this, but it tests twelve specific characters, so the
 * 🛵 🍜 📦 🧼 🚚 🛡 🛵 class passed straight through it.
 *
 * This covers the full Unicode emoji ranges instead, and separates the two
 * cases that matter: emoji in the page's own chrome (an icon in a nav, button,
 * stat or feature row) is a defect, while the same character inside literal
 * user content (a chat bubble, a social preview) is fine.
 */

/* Symbol/pictograph planes plus the dingbat and misc-symbol blocks that
   emoji presentation actually draws from. Deliberately excludes the plain
   arrow and geometric ranges: '→' and '•' are legitimate typography.
   U+FE0F (the variation selector that makes a character emoji-presented) is
   matched separately rather than inside the class — a combining mark in a
   character class behaves inconsistently across engines. */
const EMOJI_BASE_RE =
  /[\u{1F000}-\u{1FAFF}\u{1F900}-\u{1F9FF}\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}]/u
const VARIATION_SELECTOR = /\uFE0F/

/* Regions whose text is content, not chrome: a message someone typed, a post
   being previewed. An emoji there is the user's, not the designer's. */
const CONTENT_REGIONS = [
  /<blockquote[\s\S]*?<\/blockquote>/gi,
  /<pre[\s\S]*?<\/pre>/gi,
  /<code[\s\S]*?<\/code>/gi,
  /<textarea[\s\S]*?<\/textarea>/gi,
  /data-content-emoji[\s\S]*?(?=<\/)/gi,
]

export interface EmojiFinding {
  char: string
  context: string
  /** true when it sits in a tag/attribute rather than between text */
  inMarkup: boolean
}

/** Every emoji the page uses outside a user-content region. */
export function findFunctionalEmoji(html: string): EmojiFinding[] {
  let scannable = html
  for (const re of CONTENT_REGIONS) scannable = scannable.replace(re, '')
  /* drop the emoji-presentation selectors before scanning, so a bare U+FE0F
     is not itself reported as a character */
  scannable = scannable.replace(new RegExp(VARIATION_SELECTOR.source, 'gu'), '')

  const findings: EmojiFinding[] = []
  for (const match of scannable.matchAll(new RegExp(EMOJI_BASE_RE.source, 'gu'))) {
    const at = match.index ?? 0
    const around = scannable.slice(Math.max(0, at - 60), at + 60).replace(/\s+/g, ' ')
    findings.push({
      char: match[0],
      context: around.trim(),
      /* a tag body means the character is an attribute value or a class name */
      inMarkup: /<[^>]*$/.test(scannable.slice(Math.max(0, at - 200), at)),
    })
  }
  return findings
}

/**
 * True when the page is free of decorative emoji.
 *
 * A design tool cannot know whether "🍜" here is cute or careless, so this
 * does not try: it reports the count and the surrounding text, and leaves the
 * judgement to whoever reads the review — the same posture the rest of the
 * slop gates take.
 */
export function emojiAudit(html: string): {
  pass: boolean
  count: number
  distinct: string[]
  sample: EmojiFinding[]
} {
  const findings = findFunctionalEmoji(html)
  return {
    pass: findings.length === 0,
    count: findings.length,
    distinct: [...new Set(findings.map((f) => f.char))],
    sample: findings.slice(0, 5),
  }
}
