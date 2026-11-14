// A small element tree over fast-xml-parser's ordered output. Element names
// are matched by local name (the prefix is dropped), because producers are
// free to choose their own prefixes; attributes keep their prefix so that
// `id` and `r:id` on the same element stay apart.

import { XMLParser } from "fast-xml-parser"

import { PptxInspectError } from "./errors"

export type XmlElement = {
  name: string
  attrs: Record<string, string>
  children: XmlElement[]
  text: string
}

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
  // Only the XML builtins and character references are ever expanded: a
  // DOCTYPE is refused before parsing, so no entity can be declared.
  processEntities: true,
  htmlEntities: false,
})

type OrderedNode = Record<string, unknown>

function localName(name: string) {
  const colon = name.indexOf(":")
  return colon === -1 ? name : name.slice(colon + 1)
}

function build(nodes: OrderedNode[]): XmlElement[] {
  const out: XmlElement[] = []
  for (const node of nodes) {
    const key = Object.keys(node).find((k) => k !== ":@")
    if (!key || key === "#text") continue
    const rawAttrs = (node[":@"] ?? {}) as Record<string, unknown>
    const attrs: Record<string, string> = {}
    for (const [k, v] of Object.entries(rawAttrs)) attrs[k] = String(v)
    const rawChildren = (node[key] ?? []) as OrderedNode[]
    let text = ""
    for (const child of rawChildren) {
      if (Object.prototype.hasOwnProperty.call(child, "#text")) text += String(child["#text"])
    }
    out.push({ name: localName(key), attrs, children: build(rawChildren), text })
  }
  return out
}

const MARKUP_ESCAPES: Record<string, string> = { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }

// The parser expands the five builtin entities but not character references
// (&#x2013;), so they are turned into characters first; one that stands for
// markup becomes its builtin entity, so the document's structure is unchanged.
function decodeCharacterReferences(xml: string) {
  return xml.replace(/&#(x[0-9a-fA-F]+|[0-9]+);/g, (whole, code: string) => {
    const point = code[0] === "x" ? parseInt(code.slice(1), 16) : parseInt(code, 10)
    if (!Number.isFinite(point) || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) return whole
    const char = String.fromCodePoint(point)
    return MARKUP_ESCAPES[char] ?? char
  })
}

// What a refusal says, and the error it is raised as. PowerPoint's wording by
// default; openOfficePackage passes its own for other file kinds.
export type XmlRefusal = {
  notThisType: string
  damaged: string
  error: (message: string, detail: string) => Error
}

const PPTX_REFUSAL: XmlRefusal = {
  notThisType: "This is not a PowerPoint .pptx file.",
  damaged: "This PowerPoint file is damaged and could not be read.",
  error: (message, detail) => new PptxInspectError(message, detail),
}

export function parseXml(xml: string, part: string, refusal: XmlRefusal = PPTX_REFUSAL): XmlElement {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw refusal.error(refusal.notThisType, `DOCTYPE in ${part}`)
  }
  let root: XmlElement | undefined
  try {
    root = build(parser.parse(decodeCharacterReferences(xml)) as OrderedNode[])[0]
  } catch (error) {
    throw refusal.error(refusal.damaged, `${part}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!root) throw refusal.error(refusal.damaged, `${part} is empty`)
  return root
}

export function child(el: XmlElement | null | undefined, name: string): XmlElement | null {
  if (!el) return null
  return el.children.find((c) => c.name === name) ?? null
}

export function kids(el: XmlElement | null | undefined, name?: string): XmlElement[] {
  if (!el) return []
  return name ? el.children.filter((c) => c.name === name) : el.children
}

// Follows a path of local names, taking the first match at each step.
export function path(el: XmlElement | null | undefined, ...names: string[]): XmlElement | null {
  let current: XmlElement | null = el ?? null
  for (const name of names) {
    current = child(current, name)
    if (!current) return null
  }
  return current
}

export function descendants(el: XmlElement | null | undefined, name: string): XmlElement[] {
  const out: XmlElement[] = []
  const walk = (node: XmlElement) => {
    for (const c of node.children) {
      if (c.name === name) out.push(c)
      walk(c)
    }
  }
  if (el) walk(el)
  return out
}

export function firstDescendant(el: XmlElement | null | undefined, name: string): XmlElement | null {
  if (!el) return null
  for (const c of el.children) {
    if (c.name === name) return c
    const found = firstDescendant(c, name)
    if (found) return found
  }
  return null
}

export function attr(el: XmlElement | null | undefined, name: string): string | null {
  if (!el) return null
  return Object.prototype.hasOwnProperty.call(el.attrs, name) ? el.attrs[name] : null
}

// A prefixed attribute by local name, e.g. relAttr(el, "id") for `r:id`.
export function relAttr(el: XmlElement | null | undefined, local: string): string | null {
  if (!el) return null
  for (const [k, v] of Object.entries(el.attrs)) {
    const colon = k.indexOf(":")
    if (colon !== -1 && k.slice(colon + 1) === local && !k.startsWith("xmlns")) return v
  }
  return null
}

export function numAttr(el: XmlElement | null | undefined, name: string): number | null {
  const value = attr(el, name)
  if (value === null || value.trim() === "") return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

// OOXML booleans: "1"/"true" and "0"/"false".
export function boolAttr(el: XmlElement | null | undefined, name: string): boolean | null {
  const value = attr(el, name)
  if (value === null) return null
  return value === "1" || value === "true"
}

// Replaces mc:AlternateContent with the children of its first mc:Choice
// (or its mc:Fallback when there is no Choice), so newer markup such as a
// Morph transition is read rather than its fallback.
export function resolveAlternateContent(children: XmlElement[]): XmlElement[] {
  const out: XmlElement[] = []
  for (const c of children) {
    if (c.name === "AlternateContent") {
      const branch = child(c, "Choice") ?? child(c, "Fallback")
      if (branch) out.push(...resolveAlternateContent(branch.children))
    } else {
      out.push(c)
    }
  }
  return out
}
