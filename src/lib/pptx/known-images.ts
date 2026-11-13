// Naming the pictures in a .pptx after the images a teacher supplied (the
// IMAGES folder of an assessment). A picture is an exact copy when its bytes
// hash the same. Otherwise it is compared by a perceptual fingerprint, which
// survives what PowerPoint and pupils do to a picture: Compress Pictures,
// re-saving as JPEG at a lower resolution, png ↔ jpg, cropping, and pasting
// a screenshot of the picture with a plain border round it.
//
// The fingerprint is a 48 × 48 colour thumbnail of the image (with its
// transparency) and the image's aspect ratio. A picture is compared with a
// supplied image by laying windows of the picture's shape over the supplied
// image (the whole of it down to SMALLEST_WINDOW of its width, at several
// positions) and correlating 16 × 16 samples of each: the brightness
// gradients, which carry the shapes, and (lightly) the colour. The best
// window's correlation, less a penalty for features that disagree outright,
// is the similarity. Brightness itself is left out and the penalty is there
// because supplied images can share one backdrop (sea, sky): a bare backdrop
// correlates well with another picture drawn on it, and only the missing
// subject (the turtle) tells them apart.

import { createHash } from "node:crypto"

import sharp from "sharp"

import type { CropPercent } from "./types"

export type KnownImage = {
  name: string
  sha256: string
  // fingerprintImage's fingerprint; without it only exact copies are named.
  fingerprint?: string
}

export type ImageFingerprint = { sha256: string; fingerprint: string; width: number; height: number }


// The similarity (0–100) a picture needs with a supplied image to be named
// after it. Calibrated on the 8 supplied images of the 6.2 assessment and
// pupils' re-encoded copies and screenshots of them; tests/pptx/inspect.check.ts
// prints the margin.
export const MATCH_THRESHOLD_PERCENT = 72

// The smallest part of a supplied image a picture may show and still be
// named after it, as a share of the image's width or height.
const SMALLEST_WINDOW = 0.6

// Pictures larger than this are not decoded (a crafted file can declare a
// huge size); they can still be named as exact copies by their hash.
const MAX_PIXELS = 50_000_000

const GRID = 48
const SAMPLES = 16
const VERSION = "c1"

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp)$/i

type Thumb = {
  aspect: number
  // GRID × GRID × 3, row by row.
  rgb: Uint8Array
  // Opacity 0–255 per pixel; null when the image is opaque.
  alpha: Uint8Array | null
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex")
}

function encode(t: Thumb) {
  const alpha = t.alpha ? Buffer.from(t.alpha).toString("base64") : ""
  return `${VERSION};${t.aspect.toFixed(4)};${Buffer.from(t.rgb).toString("base64")};${alpha}`
}

function decode(fingerprint: string): Thumb | null {
  const [version, aspect, rgb, alpha] = fingerprint.split(";")
  if (version !== VERSION || rgb === undefined) return null
  const c = Buffer.from(rgb, "base64")
  const a = alpha ? Buffer.from(alpha, "base64") : null
  if (c.length !== GRID * GRID * 3 || (a && a.length !== GRID * GRID) || !(Number(aspect) > 0)) return null
  return { aspect: Number(aspect), rgb: new Uint8Array(c), alpha: a ? new Uint8Array(a) : null }
}

function cropBox(width: number, height: number, crop: CropPercent | null) {
  if (!crop) return null
  const c = (v: number) => Math.max(0, v) / 100
  const left = Math.round(width * c(crop.left))
  const top = Math.round(height * c(crop.top))
  const w = Math.round(width * (1 - c(crop.left) - c(crop.right)))
  const h = Math.round(height * (1 - c(crop.top) - c(crop.bottom)))
  if (w < 8 || h < 8 || left + w > width || top + h > height) return null
  return { left, top, width: w, height: h }
}

// The thumbnail of an image, or of the part a crop leaves showing (a:srcRect
// percentages; negative values, which pad the picture, count as 0).
// `flatten` puts transparent parts on white, for a picture being identified;
// a supplied image keeps its transparency. `trim` removes a plain border, as
// round a screenshot, and gives null when there is none.
async function thumbnail(bytes: Uint8Array, options: { crop?: CropPercent | null; flatten?: boolean; trim?: boolean } = {}) {
  const input = sharp(bytes, { failOn: "none", limitInputPixels: MAX_PIXELS, animated: false })
  const meta = await input.metadata()
  let width = meta.width ?? 0
  let height = meta.height ?? 0
  if (width === 0 || height === 0) throw new Error("image has no size")

  let image = input
  const box = cropBox(width, height, options.crop ?? null)
  if (box) {
    image = sharp(await image.extract(box).png().toBuffer())
    width = box.width
    height = box.height
  }
  if (options.flatten) image = image.flatten({ background: "#ffffff" })
  if (options.trim) {
    const trimmed = await sharp(await image.png().toBuffer())
      .trim({ threshold: 24 })
      .png()
      .toBuffer({ resolveWithObject: true })
      .catch(() => null)
    if (!trimmed) return null
    const { data, info } = trimmed
    if (info.width < 8 || info.height < 8) return null
    if (info.width >= width - 2 && info.height >= height - 2) return null
    image = sharp(data)
    width = info.width
    height = info.height
  }
  const { data } = await image.ensureAlpha().resize(GRID, GRID, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true })
  const rgb = new Uint8Array(GRID * GRID * 3)
  const alpha = new Uint8Array(GRID * GRID)
  let transparent = false
  for (let i = 0; i < GRID * GRID; i += 1) {
    rgb[i * 3] = data[i * 4]
    rgb[i * 3 + 1] = data[i * 4 + 1]
    rgb[i * 3 + 2] = data[i * 4 + 2]
    alpha[i] = data[i * 4 + 3]
    if (alpha[i] < 250) transparent = true
  }
  return { thumb: { aspect: width / height, rgb, alpha: transparent ? alpha : null } satisfies Thumb, width, height }
}

export async function fingerprintImage(bytes: Uint8Array): Promise<ImageFingerprint> {
  const result = await thumbnail(bytes)
  if (!result) throw new Error("image could not be read")
  return { sha256: sha256(bytes), fingerprint: encode(result.thumb), width: result.width, height: result.height }
}

// Known images from files, each named after its file without the extension
// ("TURTLE.jpg" → "TURTLE"). Files that are not png/jpg/gif/webp are skipped.
export async function knownImagesFromFiles(files: { name: string; bytes: Buffer }[]): Promise<KnownImage[]> {
  const out: KnownImage[] = []
  for (const file of files) {
    const base = file.name.split(/[\\/]/).pop() ?? file.name
    if (!IMAGE_EXTENSIONS.test(base)) continue
    const { sha256: hash, fingerprint } = await fingerprintImage(file.bytes)
    out.push({ name: base.replace(IMAGE_EXTENSIONS, ""), sha256: hash, fingerprint })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

// ---------------------------------------------------------------- comparing

// Brightness and two colour-difference channels, each GRID × GRID.
type Planes = [Float64Array, Float64Array, Float64Array]

function planes(rgb: Uint8Array | Float64Array): Planes {
  const y = new Float64Array(GRID * GRID)
  const cb = new Float64Array(GRID * GRID)
  const cr = new Float64Array(GRID * GRID)
  for (let i = 0; i < GRID * GRID; i += 1) {
    const r = rgb[i * 3]
    const g = rgb[i * 3 + 1]
    const b = rgb[i * 3 + 2]
    y[i] = 0.299 * r + 0.587 * g + 0.114 * b
    cb[i] = b - y[i]
    cr[i] = r - y[i]
  }
  return [y, cb, cr]
}

// A supplied image as it would look on `background`, softened by a 3 × 3 box
// so that a point sample stands for a cell's average.
function knownPlanes(known: Thumb, background: number[]): Planes {
  const rgb = new Float64Array(GRID * GRID * 3)
  for (let i = 0; i < GRID * GRID; i += 1) {
    const a = known.alpha ? known.alpha[i] / 255 : 1
    for (let c = 0; c < 3; c += 1) rgb[i * 3 + c] = known.rgb[i * 3 + c] * a + background[c] * (1 - a)
  }
  return planes(rgb).map((plane) => {
    const out = new Float64Array(GRID * GRID)
    for (let y = 0; y < GRID; y += 1) {
      for (let x = 0; x < GRID; x += 1) {
        let sum = 0
        let n = 0
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const xx = x + dx
            const yy = y + dy
            if (xx < 0 || yy < 0 || xx >= GRID || yy >= GRID) continue
            sum += plane[yy * GRID + xx]
            n += 1
          }
        }
        out[y * GRID + x] = sum / n
      }
    }
    return out
  }) as Planes
}

// A picture's planes as SAMPLES × SAMPLES cell averages.
function pictureSamples(t: Thumb): Planes {
  const step = GRID / SAMPLES
  return planes(t.rgb).map((plane) => {
    const out = new Float64Array(SAMPLES * SAMPLES)
    for (let y = 0; y < SAMPLES; y += 1) {
      for (let x = 0; x < SAMPLES; x += 1) {
        let sum = 0
        for (let dy = 0; dy < step; dy += 1) {
          for (let dx = 0; dx < step; dx += 1) sum += plane[(y * step + dy) * GRID + x * step + dx]
        }
        out[y * SAMPLES + x] = sum / (step * step)
      }
    }
    return out
  }) as Planes
}

function bilinear(values: Float64Array, x: number, y: number) {
  const fx = Math.min(Math.max(x * GRID - 0.5, 0), GRID - 1)
  const fy = Math.min(Math.max(y * GRID - 0.5, 0), GRID - 1)
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const x1 = Math.min(x0 + 1, GRID - 1)
  const y1 = Math.min(y0 + 1, GRID - 1)
  const ax = fx - x0
  const ay = fy - y0
  const top = values[y0 * GRID + x0] * (1 - ax) + values[y0 * GRID + x1] * ax
  const bottom = values[y1 * GRID + x0] * (1 - ax) + values[y1 * GRID + x1] * ax
  return top * (1 - ay) + bottom * ay
}

// Gradients of brightness, then the two colour channels: the features
// correlated. Colour counts for less than shape.
const COLOUR_WEIGHT = 0.25

// Features that disagree by more than OUTLIER_SD standard deviations mark
// something one picture has and the other lacks (a turtle on a shared
// backdrop); each 1% of them takes OUTLIER_PENALTY points off the score.
const OUTLIER_SD = 1
const OUTLIER_PENALTY = 3

function features(s: Planes) {
  const [y, cb, cr] = s
  const out: number[] = []
  for (let r = 0; r < SAMPLES; r += 1) {
    for (let c = 0; c < SAMPLES - 1; c += 1) out.push(y[r * SAMPLES + c + 1] - y[r * SAMPLES + c])
  }
  for (let r = 0; r < SAMPLES - 1; r += 1) {
    for (let c = 0; c < SAMPLES; c += 1) out.push(y[(r + 1) * SAMPLES + c] - y[r * SAMPLES + c])
  }
  for (const plane of [cb, cr]) {
    for (let i = 0; i < SAMPLES * SAMPLES; i += 1) out.push(plane[i] * COLOUR_WEIGHT)
  }
  return Float64Array.from(out)
}

function correlation(a: Float64Array, b: Float64Array) {
  let ma = 0
  let mb = 0
  for (let i = 0; i < a.length; i += 1) {
    ma += a[i]
    mb += b[i]
  }
  ma /= a.length
  mb /= b.length
  let cov = 0
  let va = 0
  let vb = 0
  for (let i = 0; i < a.length; i += 1) {
    const da = a[i] - ma
    const db = b[i] - mb
    cov += da * db
    va += da * da
    vb += db * db
  }
  // A featureless window (plain sky, a blank border) says nothing.
  if (va / a.length < 1 || vb / b.length < 1) return 0
  const sa = Math.sqrt(va / a.length)
  const sb = Math.sqrt(vb / b.length)
  let outliers = 0
  for (let i = 0; i < a.length; i += 1) {
    if (Math.abs((a[i] - ma) / sa - (b[i] - mb) / sb) > OUTLIER_SD) outliers += 1
  }
  return cov / Math.sqrt(va * vb) - OUTLIER_PENALTY * (outliers / a.length)
}

function windowSamples(known: Planes, wx: number, wy: number, ww: number, wh: number): Planes {
  return known.map((plane) => {
    const out = new Float64Array(SAMPLES * SAMPLES)
    for (let y = 0; y < SAMPLES; y += 1) {
      for (let x = 0; x < SAMPLES; x += 1) {
        out[y * SAMPLES + x] = bilinear(plane, wx + ((x + 0.5) / SAMPLES) * ww, wy + ((y + 0.5) / SAMPLES) * wh)
      }
    }
    return out
  }) as Planes
}

export type Comparison = {
  // Correlation 0–100 of the best window.
  similarityPercent: number
  // How much of the supplied image's area that window covers, 0–100.
  shownPercent: number
}

function compareThumbs(picture: Thumb, known: Thumb): Comparison {
  // A transparent supplied image is tried on white and on black: a slide,
  // or the dark window of a screenshot.
  const backgrounds = known.alpha ? [[255, 255, 255], [0, 0, 0]] : [[255, 255, 255]]
  let result: Comparison = { similarityPercent: 0, shownPercent: 0 }
  for (const background of backgrounds) {
    const r = searchWindows(picture, known, background)
    if (r.similarityPercent > result.similarityPercent) result = r
  }
  return result
}

function searchWindows(picture: Thumb, known: Thumb, background: number[]): Comparison {
  const pf = features(pictureSamples(picture))
  const kp = knownPlanes(known, background)
  let best = { score: -1, wx: 0, wy: 0, ww: 1, wh: 1 }
  const consider = (wx: number, wy: number, ww: number, wh: number) => {
    const score = correlation(pf, features(windowSamples(kp, wx, wy, ww, wh)))
    if (score > best.score) best = { score, wx, wy, ww, wh }
  }
  // Coarse: window shapes near the picture's, sizes from the whole supplied
  // image down to SMALLEST_WINDOW, 5 × 5 positions each.
  for (const stretch of [0.94, 1, 1.06]) {
    const ratio = (picture.aspect * stretch) / known.aspect
    const fullW = ratio >= 1 ? 1 : ratio
    const fullH = ratio >= 1 ? 1 / ratio : 1
    for (let scale = 1; scale >= SMALLEST_WINDOW - 1e-9; scale -= 0.1) {
      const ww = fullW * scale
      const wh = fullH * scale
      if (ww < SMALLEST_WINDOW - 1e-9 && wh < SMALLEST_WINDOW - 1e-9) continue
      for (let i = 0; i < 5; i += 1) {
        for (let j = 0; j < 5; j += 1) consider(((1 - ww) * i) / 4, ((1 - wh) * j) / 4, ww, wh)
      }
    }
  }
  // Fine: nudge the best window's position and size.
  for (let step = 0.04; step > 0.004; step /= 2) {
    const start = { ...best }
    for (const dx of [-step, 0, step]) {
      for (const dy of [-step, 0, step]) {
        for (const ds of [1 - step, 1, 1 + step]) {
          const ww = Math.min(start.ww * ds, 1)
          const wh = Math.min(start.wh * ds, 1)
          if (ww < SMALLEST_WINDOW - 1e-9 && wh < SMALLEST_WINDOW - 1e-9) continue
          consider(Math.min(Math.max(start.wx + dx, 0), 1 - ww), Math.min(Math.max(start.wy + dy, 0), 1 - wh), ww, wh)
        }
      }
    }
  }
  return {
    similarityPercent: Math.max(0, Math.round(best.score * 1000) / 10),
    shownPercent: Math.round(best.ww * best.wh * 100),
  }
}

function flattenThumb(t: Thumb): Thumb {
  if (!t.alpha) return t
  const rgb = new Uint8Array(t.rgb.length)
  for (let i = 0; i < GRID * GRID; i += 1) {
    const a = t.alpha[i] / 255
    for (let c = 0; c < 3; c += 1) rgb[i * 3 + c] = Math.round(t.rgb[i * 3 + c] * a + 255 * (1 - a))
  }
  return { ...t, rgb, alpha: null }
}

// How alike two fingerprints are: the picture `picture` against windows of
// the supplied image `known`. Null when either fingerprint is unreadable.
export function compareFingerprints(picture: string, known: string): Comparison | null {
  const p = decode(picture)
  const k = decode(known)
  if (!p || !k) return null
  return compareThumbs(flattenThumb(p), k)
}

export type ImageMatch = {
  kind: "exact" | "similar" | "none" | "unreadable"
  // The supplied image's name, for an exact or similar match.
  name: string | null
  similarityPercent: number | null
  // How much of the supplied image's area the picture shows (100 = all).
  shownPercent: number | null
  // For no match: the nearest supplied image, so the margin is visible.
  nearest: { name: string; similarityPercent: number } | null
  // For a match: the next nearest supplied image.
  runnerUp: { name: string; similarityPercent: number } | null
  cropped: boolean
  // What was compared, for a cropped picture.
  comparedOn: "cropped region" | "whole image" | null
}

function isCropped(crop: CropPercent | null) {
  return !!crop && (crop.left > 0 || crop.top > 0 || crop.right > 0 || crop.bottom > 0)
}

// Which supplied image, if any, a picture is. A cropped picture is compared
// on the region it shows, then on the whole image (a pupil who cropped a
// supplied picture still used it). Each is also compared with any plain
// border trimmed off.
export async function matchImage(
  bytes: Uint8Array | null,
  hash: string | null,
  crop: CropPercent | null,
  known: KnownImage[],
): Promise<ImageMatch> {
  const cropped = isCropped(crop)
  const base: ImageMatch = { kind: "none", name: null, similarityPercent: null, shownPercent: null, nearest: null, runnerUp: null, cropped, comparedOn: null }
  const exact = hash ? known.find((k) => k.sha256 === hash) : undefined
  if (exact) return { ...base, kind: "exact", name: exact.name, similarityPercent: 100, shownPercent: 100 }
  if (!bytes) return { ...base, kind: "unreadable" }
  const thumbs = known
    .map((k) => ({ name: k.name, thumb: k.fingerprint ? decode(k.fingerprint) : null }))
    .filter((k): k is { name: string; thumb: Thumb } => k.thumb !== null)
  if (thumbs.length === 0) return base

  const attempts: { on: ImageMatch["comparedOn"]; crop: CropPercent | null }[] = cropped
    ? [{ on: "cropped region", crop }, { on: "whole image", crop: null }]
    : [{ on: null, crop: null }]
  // Best similarity per supplied image, over every way of looking.
  const scores = new Map<string, { comparison: Comparison; on: ImageMatch["comparedOn"] }>()
  try {
    for (const attempt of attempts) {
      for (const trim of [false, true]) {
        const picture = await thumbnail(bytes, { crop: attempt.crop, flatten: true, trim })
        if (!picture) continue
        for (const k of thumbs) {
          const comparison = compareThumbs(picture.thumb, k.thumb)
          const previous = scores.get(k.name)
          if (!previous || comparison.similarityPercent > previous.comparison.similarityPercent) scores.set(k.name, { comparison, on: attempt.on })
        }
      }
      if ([...scores.values()].some((s) => s.comparison.similarityPercent >= MATCH_THRESHOLD_PERCENT)) break
    }
  } catch {
    return { ...base, kind: "unreadable" }
  }
  const ranked = [...scores.entries()].sort((a, b) => b[1].comparison.similarityPercent - a[1].comparison.similarityPercent)
  if (ranked.length === 0) return base
  const [name, top] = ranked[0]
  const second = ranked[1] ? { name: ranked[1][0], similarityPercent: ranked[1][1].comparison.similarityPercent } : null
  if (top.comparison.similarityPercent >= MATCH_THRESHOLD_PERCENT) {
    return { ...base, kind: "similar", name, ...top.comparison, runnerUp: second, comparedOn: top.on }
  }
  return { ...base, nearest: { name, similarityPercent: top.comparison.similarityPercent }, comparedOn: top.on }
}

export function describeMatch(m: ImageMatch) {
  const crop = !m.cropped
    ? ""
    : m.kind === "exact"
      ? " (cropped on the slide)"
      : m.kind === "none"
        ? " (cropped; compared on the region shown and on the whole image)"
        : m.comparedOn === "cropped region"
          ? " (cropped; compared on the region shown)"
          : " (cropped; compared on the whole image)"
  switch (m.kind) {
    case "exact":
      return `${m.name} (exact copy)${crop}`
    case "similar": {
      const part = m.shownPercent !== null && m.shownPercent < 80 ? `, showing about ${m.shownPercent}% of it` : ""
      return `looks like ${m.name} (similarity ${m.similarityPercent}%${part})${crop}`
    }
    case "unreadable":
      return "could not be compared with the supplied images (the picture could not be read)"
    default:
      return `not one of the supplied images${m.nearest ? ` (nearest ${m.nearest.name}, similarity ${m.nearest.similarityPercent}%)` : ""}${crop}`
  }
}
