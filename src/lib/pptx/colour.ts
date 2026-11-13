// Effective colours: scheme colours go through the master's colour map to the
// theme, then lumMod/lumOff/tint/shade are applied (HSL for lum*, RGB for
// tint/shade, which is close enough to PowerPoint for describing a colour).

import { child, attr, kids, type XmlElement } from "./xml"

export type Theme = {
  colours: Record<string, string>
  majorFont: string | null
  minorFont: string | null
}

export type ColourMap = Record<string, string>

const PRESET_COLOURS: Record<string, string> = {
  black: "000000",
  white: "FFFFFF",
  red: "FF0000",
  green: "008000",
  blue: "0000FF",
  yellow: "FFFF00",
  cyan: "00FFFF",
  magenta: "FF00FF",
  gray: "808080",
  grey: "808080",
  darkBlue: "00008B",
  navy: "000080",
  orange: "FFA500",
  purple: "800080",
}

export function readTheme(root: XmlElement | null): Theme {
  const theme: Theme = { colours: {}, majorFont: null, minorFont: null }
  if (!root) return theme
  const elements = child(root, "themeElements")
  const scheme = child(elements, "clrScheme")
  for (const entry of kids(scheme)) {
    const value = child(entry, "srgbClr") ? attr(child(entry, "srgbClr"), "val") : attr(child(entry, "sysClr"), "lastClr")
    if (value) theme.colours[entry.name] = value.toUpperCase()
  }
  const fonts = child(elements, "fontScheme")
  theme.majorFont = attr(child(child(fonts, "majorFont"), "latin"), "typeface")
  theme.minorFont = attr(child(child(fonts, "minorFont"), "latin"), "typeface")
  return theme
}

export function readColourMap(el: XmlElement | null): ColourMap {
  return el ? { ...el.attrs } : {}
}

const COLOUR_ELEMENTS = new Set(["srgbClr", "schemeClr", "sysClr", "prstClr", "scrgbClr", "hslClr"])

// The colour element inside a fill such as a:solidFill.
export function colourElement(fill: XmlElement | null): XmlElement | null {
  if (!fill) return null
  return fill.children.find((c) => COLOUR_ELEMENTS.has(c.name)) ?? null
}

export function resolveColour(el: XmlElement | null, theme: Theme, colourMap: ColourMap): string | null {
  if (!el) return null
  let hex: string | null = null
  switch (el.name) {
    case "srgbClr":
      hex = attr(el, "val")
      break
    case "sysClr":
      hex = attr(el, "lastClr") ?? (attr(el, "val") === "window" ? "FFFFFF" : "000000")
      break
    case "prstClr":
      hex = PRESET_COLOURS[attr(el, "val") ?? ""] ?? null
      break
    case "scrgbClr": {
      const channel = (name: string) => Math.round(Math.max(0, Math.min(100000, Number(attr(el, name) ?? 0))) * 255 / 100000)
      hex = toHex(channel("r"), channel("g"), channel("b"))
      break
    }
    case "schemeClr": {
      const val = attr(el, "val") ?? ""
      const mapped = colourMap[val] ?? val
      hex = theme.colours[mapped] ?? theme.colours[val] ?? null
      break
    }
    default:
      return null
  }
  if (!hex || !/^[0-9a-fA-F]{6}$/.test(hex)) return null
  return applyModifiers(hex.toUpperCase(), el)
}

function toHex(r: number, g: number, b: number) {
  return [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("").toUpperCase()
}

function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0)
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  return [h * 60, s, l]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hue = (t: number) => {
    let x = t
    if (x < 0) x += 1
    if (x > 1) x -= 1
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }
  const hn = h / 360
  return [hue(hn + 1 / 3) * 255, hue(hn) * 255, hue(hn - 1 / 3) * 255]
}

function applyModifiers(hex: string, el: XmlElement) {
  let [r, g, b] = hexToRgb(hex)
  for (const mod of el.children) {
    const val = Number(attr(mod, "val") ?? NaN) / 100000
    if (!Number.isFinite(val)) continue
    if (mod.name === "tint") {
      r += (255 - r) * (1 - val)
      g += (255 - g) * (1 - val)
      b += (255 - b) * (1 - val)
    } else if (mod.name === "shade") {
      r *= val
      g *= val
      b *= val
    } else if (mod.name === "lumMod" || mod.name === "lumOff") {
      const [h, s, l] = rgbToHsl(r, g, b)
      const lum = mod.name === "lumMod" ? l * val : l + val
      ;[r, g, b] = hslToRgb(h, s, Math.max(0, Math.min(1, lum)))
    }
  }
  return toHex(r, g, b)
}

// A plain name for a colour, e.g. "dark blue", so a reader need not decode hex.
export function describeColour(hex: string | null): string | null {
  if (!hex) return null
  const [r, g, b] = hexToRgb(hex)
  const [h, s, l] = rgbToHsl(r, g, b)
  if (l < 0.08) return "black"
  if (l > 0.95) return "white"
  const shade = l < 0.3 ? "dark " : l > 0.7 ? "light " : ""
  if (s < 0.12) return `${shade}grey`
  const hue =
    h < 15 || h >= 345 ? "red" :
      h < 45 ? "orange" :
        h < 70 ? "yellow" :
          h < 160 ? "green" :
            h < 190 ? "teal" :
              h < 250 ? "blue" :
                h < 290 ? "purple" : "pink"
  return `${shade}${hue}`
}
