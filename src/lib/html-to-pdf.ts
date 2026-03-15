// Converts an HTML string into a simple intermediate representation
// suitable for rendering with @react-pdf/renderer.
//
// Supported elements: <ol>, <ul>, <li>, <a href>, <b>, <strong>,
// <em>, <i>, <br>, <p>, <div>, <span>, <h1>-<h6>
// All inline styles are ignored.

export interface TextRun {
  text: string
  bold?: true
  italic?: true
  link?: string
}

export interface HtmlParagraph {
  type: "para"
  runs: TextRun[]
}

export interface HtmlListItem {
  runs: TextRun[]
}

export interface HtmlList {
  type: "ol" | "ul"
  items: HtmlListItem[]
}

export type HtmlNode = HtmlParagraph | HtmlList

// ---- Inline parser --------------------------------------------------------

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
}

/** Parse inline HTML into TextRun segments. */
function parseInline(
  html: string,
  bold = false,
  italic = false,
): TextRun[] {
  const runs: TextRun[] = []

  // Tokenise: alternate between text and tags
  const tokenRe = /(<[^>]+>|[^<]+)/g
  let match: RegExpExecArray | null

  let currentBold = bold
  let currentItalic = italic
  const tagStack: string[] = []

  while ((match = tokenRe.exec(html)) !== null) {
    const token = match[1]

    if (!token.startsWith("<")) {
      // Plain text node
      const text = decodeEntities(token)
      if (text) {
        const run: TextRun = { text }
        if (currentBold) run.bold = true
        if (currentItalic) run.italic = true
        runs.push(run)
      }
      continue
    }

    // Tag — strip attributes for tag name detection
    const tagName = token.replace(/<\/?/, "").split(/[\s>]/)[0].toLowerCase()
    const isClosing = token.startsWith("</")
    const isSelfClosing = token.endsWith("/>") || tagName === "br"

    if (tagName === "br") {
      runs.push({ text: "\n" })
      continue
    }

    if (tagName === "b" || tagName === "strong") {
      currentBold = !isClosing
      continue
    }

    if (tagName === "em" || tagName === "i") {
      currentItalic = !isClosing
      continue
    }

    if (tagName === "a" && !isClosing) {
      // Extract href
      const hrefMatch = token.match(/href=["']([^"']+)["']/)
      const href = hrefMatch ? hrefMatch[1] : null

      // Find closing </a> in the remaining html
      const remaining = html.slice((match.index ?? 0) + token.length)
      const closeIdx = remaining.search(/<\/a>/i)
      if (closeIdx >= 0) {
        const innerHtml = remaining.slice(0, closeIdx)
        const innerText = decodeEntities(innerHtml.replace(/<[^>]+>/g, ""))
        if (innerText) {
          const run: TextRun = { text: innerText }
          if (currentBold) run.bold = true
          if (currentItalic) run.italic = true
          if (href) run.link = href
          runs.push(run)
        }
        // Advance tokenRe past the </a>
        tokenRe.lastIndex = (match.index ?? 0) + token.length + closeIdx + 4
      }
      continue
    }

    // All other tags — ignore (span, etc.)
    void tagName
    void isClosing
    void isSelfClosing
    void tagStack
  }

  return runs
}

// ---- Block parser ---------------------------------------------------------

/** Remove the outermost HTML tag wrapping content, e.g. <li ...>inner</li> → inner */
function innerHtml(tag: string, input: string): string | null {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i")
  const m = input.match(re)
  return m ? m[1] : null
}

/** Extract all <li>…</li> content strings from a list element's innerHTML */
function extractListItems(listInner: string): string[] {
  const items: string[] = []
  const re = /<li(?:\s[^>]*)?>([\s\S]+?)<\/li>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(listInner)) !== null) {
    items.push(m[1])
  }
  return items
}

/**
 * Parse an HTML string into an array of HtmlNodes.
 * Top-level block types supported: <ol>, <ul>, <p>, <div>, <h1>-<h6>.
 * Anything else is treated as a paragraph.
 */
export function parseHtmlToNodes(html: string): HtmlNode[] {
  if (!html || !html.trim()) return []

  const nodes: HtmlNode[] = []

  // Tokenise at block level: find <ol>, <ul>, <p>, <div>, <hN> and text between them
  const blockRe =
    /(<ol(?:\s[^>]*)?>[\s\S]*?<\/ol>|<ul(?:\s[^>]*)?>[\s\S]*?<\/ul>|<p(?:\s[^>]*)?>[\s\S]*?<\/p>|<div(?:\s[^>]*)?>[\s\S]*?<\/div>|<h[1-6](?:\s[^>]*)?>[\s\S]*?<\/h[1-6]>)/gi

  let lastIndex = 0
  let blockMatch: RegExpExecArray | null

  while ((blockMatch = blockRe.exec(html)) !== null) {
    // Handle text before this block
    const before = html.slice(lastIndex, blockMatch.index).trim()
    if (before) {
      const runs = parseInline(before)
      if (runs.length > 0) nodes.push({ type: "para", runs })
    }
    lastIndex = blockMatch.index + blockMatch[0].length

    const block = blockMatch[1]
    const blockTag = block.replace(/</, "").split(/[\s>]/)[0].toLowerCase()

    if (blockTag === "ol" || blockTag === "ul") {
      const listInner = innerHtml(blockTag, block) ?? ""
      const rawItems = extractListItems(listInner)
      if (rawItems.length > 0) {
        nodes.push({
          type: blockTag as "ol" | "ul",
          items: rawItems.map((item) => ({ runs: parseInline(item) })),
        })
      }
    } else {
      // p, div, h1-h6
      const inner = block.replace(/<[^>]+>/g, match => {
        const t = match.replace(/<\/?/, "").split(/[\s>]/)[0].toLowerCase()
        return t === "br" ? "\n" : ""
      })
      const text = decodeEntities(inner).trim()
      const runs = parseInline(block)
      if (runs.length > 0) nodes.push({ type: "para", runs })
      void text
    }
  }

  // Remaining text after last block
  const tail = html.slice(lastIndex).trim()
  if (tail) {
    const runs = parseInline(tail)
    if (runs.length > 0) nodes.push({ type: "para", runs })
  }

  // If nothing was found with block parsing, treat entire html as inline
  if (nodes.length === 0) {
    const runs = parseInline(html)
    if (runs.length > 0) nodes.push({ type: "para", runs })
  }

  return nodes
}
