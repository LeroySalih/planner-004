// PowerPoint's names for animation presets (presetClass + presetID) and
// slide transitions (the child element of p:transition). Only presets whose
// names are known are listed; anything else is reported as "preset N".

const ENTRANCE: Record<number, string> = {
  1: "Appear",
  2: "Fly In",
  3: "Blinds",
  4: "Box",
  5: "Checkerboard",
  6: "Circle",
  7: "Crawl In",
  8: "Diamond",
  9: "Dissolve In",
  10: "Fade",
  11: "Flash Once",
  12: "Peek In",
  13: "Plus",
  14: "Random Bars",
  15: "Spiral In",
  16: "Split",
  17: "Stretch",
  18: "Strips",
  19: "Swivel",
  20: "Wedge",
  21: "Wheel",
  22: "Wipe",
  23: "Basic Zoom",
  24: "Random Effects",
  25: "Boomerang",
  26: "Bounce",
  27: "Color Typewriter",
  28: "Credits",
  29: "Ease In",
  30: "Float",
  31: "Grow & Turn",
  34: "Light Speed",
  35: "Pinwheel",
  37: "Rise Up",
  38: "Swish",
  39: "Thin Line",
  40: "Unfold",
  41: "Whip",
  42: "Float In",
  43: "Center Revolve",
  45: "Faded Swivel",
  47: "Descend",
  48: "Sling",
  49: "Spinner",
  50: "Compress",
  51: "Zip",
  52: "Arc Up",
  53: "Zoom",
  54: "Glide",
  55: "Expand",
  56: "Flip",
  58: "Fold",
}

const EXIT: Record<number, string> = {
  1: "Disappear",
  2: "Fly Out",
  3: "Blinds",
  4: "Box",
  5: "Checkerboard",
  6: "Circle",
  7: "Crawl Out",
  8: "Diamond",
  9: "Dissolve Out",
  10: "Fade",
  11: "Flash Once",
  12: "Peek Out",
  13: "Plus",
  14: "Random Bars",
  15: "Spiral Out",
  16: "Split",
  17: "Collapse",
  18: "Strips",
  19: "Swivel",
  20: "Wedge",
  21: "Wheel",
  22: "Wipe",
  23: "Basic Zoom",
  24: "Random Effects",
  25: "Boomerang",
  26: "Bounce",
  27: "Color Typewriter",
  28: "Credits",
  29: "Ease Out",
  30: "Float",
  31: "Shrink & Turn",
  34: "Light Speed",
  35: "Pinwheel",
  37: "Sink Down",
  38: "Swish",
  39: "Thin Line",
  40: "Fold",
  41: "Whip",
  42: "Float Out",
  43: "Center Revolve",
  45: "Faded Swivel",
  47: "Descend",
  48: "Sling",
  49: "Spinner",
  50: "Stretchy",
  51: "Zip",
  52: "Arc Up",
  53: "Zoom",
  54: "Glide",
  55: "Contract",
  56: "Flip",
}

const EMPHASIS: Record<number, string> = {
  1: "Fill Color",
  2: "Change Font",
  3: "Font Color",
  4: "Change Font Size",
  5: "Change Font Style",
  6: "Grow/Shrink",
  7: "Line Color",
  8: "Spin",
  9: "Transparency",
  10: "Bold Flash",
  14: "Blast",
  15: "Bold Reveal",
  16: "Brush on Color",
  18: "Brush on Underline",
  19: "Color Blend",
  20: "Color Pulse",
  21: "Complementary Color",
  22: "Complementary Color 2",
  23: "Contrasting Color",
  24: "Darken",
  25: "Desaturate",
  26: "Pulse",
  27: "Flicker",
  28: "Grow With Color",
  30: "Lighten",
  31: "Style Emphasis",
  32: "Teeter",
  33: "Vertical Grow",
  34: "Wave",
  35: "Blink",
  36: "Shimmer",
}

export type AnimationClass = "entrance" | "emphasis" | "exit" | "motion path" | "media" | "other"

export function animationClass(presetClass: string | null): AnimationClass {
  switch (presetClass) {
    case "entr":
      return "entrance"
    case "emph":
      return "emphasis"
    case "exit":
      return "exit"
    case "path":
      return "motion path"
    case "mediacall":
      return "media"
    default:
      return "other"
  }
}

export function animationEffectName(presetClass: string | null, presetId: number | null): string {
  if (presetId === null) return "custom effect"
  const table = presetClass === "entr" ? ENTRANCE : presetClass === "exit" ? EXIT : presetClass === "emph" ? EMPHASIS : null
  if (presetClass === "path" && presetId === 0) return "Custom Path"
  return table?.[presetId] ?? `preset ${presetId}`
}

const TRANSITIONS: Record<string, string> = {
  blinds: "Blinds",
  checker: "Checkerboard",
  circle: "Circle",
  comb: "Comb",
  cover: "Cover",
  cut: "Cut",
  diamond: "Diamond",
  dissolve: "Dissolve",
  fade: "Fade",
  newsflash: "Newsflash",
  plus: "Plus",
  pull: "Uncover",
  push: "Push",
  random: "Random",
  randomBar: "Random Bars",
  split: "Split",
  strips: "Strips",
  wedge: "Wedge",
  wheel: "Wheel",
  wipe: "Wipe",
  zoom: "Zoom",
  // PowerPoint 2010 (p14)
  conveyor: "Conveyor",
  doors: "Doors",
  ferris: "Ferris Wheel",
  flash: "Flash",
  flip: "Flip",
  flythrough: "Fly Through",
  gallery: "Gallery",
  glitter: "Glitter",
  honeycomb: "Honeycomb",
  pan: "Pan",
  prism: "Cube",
  reveal: "Reveal",
  ripple: "Ripple",
  shred: "Shred",
  switch: "Switch",
  vortex: "Vortex",
  warp: "Zoom (Warp)",
  wheelReverse: "Wheel (reverse)",
  window: "Window",
  // PowerPoint 2016+ (p159)
  morph: "Morph",
}

const PRESET_TRANSITIONS: Record<string, string> = {
  airplane: "Airplane",
  crush: "Crush",
  curtains: "Curtains",
  drape: "Drape",
  fallOver: "Fall Over",
  fracture: "Fracture",
  origami: "Origami",
  pageCurlDouble: "Page Curl",
  pageCurlSingle: "Page Curl (single)",
  peelOff: "Peel Off",
  prestige: "Prestige",
  wind: "Wind",
}

export function transitionName(element: string, attrs: Record<string, string>): string {
  if (element === "fade" && (attrs.thruBlk === "1" || attrs.thruBlk === "true")) return "Fade Through Black"
  if (element === "prstTrans") {
    const prst = attrs.prst ?? ""
    return PRESET_TRANSITIONS[prst] ?? (prst || "preset transition")
  }
  if (element === "split" && attrs.orient === "vert") return "Split (vertical)"
  return TRANSITIONS[element] ?? element
}
