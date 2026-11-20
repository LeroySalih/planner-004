// The facts read from a .pptx. Lengths are in cm (EMU / 360000, 2 dp) and
// times in seconds. Slides are numbered 1..n in presentation order.

import type { AnimationClass } from "./effect-names"
import type { ImageMatch } from "./known-images"

export type Box = { xCm: number; yCm: number; widthCm: number; heightCm: number }

export type Colour = { hex: string; name: string | null }

export type CropPercent = { left: number; top: number; right: number; bottom: number }

// A shape filled with a picture (Format Shape > Fill > Picture).
export type PictureFill = {
  mediaPart: string | null
  sha256: string | null
  cropPercent: CropPercent | null
  // Which supplied image it is; null when no supplied images were given.
  match: ImageMatch | null
}

export type HeaderFooterFlags = {
  slideNumber: boolean
  header: boolean
  footer: boolean
  date: boolean
}

export type PlaceholderRef = { type: string; idx: number | null }

// Where an effective formatting value comes from: the part the item is on
// ("slide", "layout" or "master" for the item's own part, else the part it
// inherits from), the presentation's default text style, the shape's own
// style (p:style, theme references), or PowerPoint's built-in default.
export type FormatSource = "slide" | "layout" | "master" | "presentation" | "shape style" | "default"

// An effective value and its source. A null value is one the reader could
// not resolve (e.g. a theme colour the theme lacks): reported as UNKNOWN.
export type Sourced<T> = { value: T | null; from: FormatSource }

export type EffectiveTextStyle = {
  sizePt: Sourced<number>
  // themeFont: the font is the theme's heading (+mj) or body (+mn) font.
  font: Sourced<string> & { themeFont: "heading" | "body" | null }
  colour: Sourced<Colour>
  bold: Sourced<boolean>
  italic: Sourced<boolean>
  underline: Sourced<boolean>
}

// The effective fill of a shape or placeholder. colour/stops are null where
// a theme colour could not be resolved (unresolved is then true).
export type FillInfo = {
  kind: "none" | "solid" | "gradient" | "picture" | "pattern" | "group" | "unknown"
  colour: Colour | null
  transparencyPercent: number | null
  stops: (Colour | null)[] | null
  from: FormatSource
  viaStyle: boolean
  unresolved: boolean
}

// Horizontal paragraph alignment ("left", "centre" …; "mixed" when the
// paragraphs differ) and vertical anchor ("top", "middle", "bottom") of a
// shape's text.
export type TextLayout = { align: Sourced<string>; anchor: Sourced<string> }

export type TextRunStyle = {
  bold: boolean
  italic: boolean
  underline: boolean
  sizePt: number | null
  font: string | null
  colour: Colour | null
  // Each value with its source (powerpoint-reader-2 on).
  effective?: EffectiveTextStyle
}

export type Paragraph = {
  index: number
  level: number
  text: string
  bulleted: boolean
  bulletChar: string | null
  align: string | null
  alignFrom?: FormatSource
  // The paragraph's own runs, summarised (powerpoint-reader-2 on).
  textSummary?: TextSummary | null
}

export type Field = {
  type: string
  text: string
  // The field run's language (rPr lang), e.g. "en-GB".
  lang?: string | null
  // A date/time field PowerPoint refreshes when the file is opened or shown.
  updatesAutomatically: boolean
}

export type FooterItem = {
  kind: "date" | "footer" | "slide number" | "header"
  name: string
  box: Box | null
  align: string | null
  text: string
  fields: Field[]
  // A date placeholder holding typed text rather than a date field.
  typedDate: boolean
  // A slide number placeholder holding a typed number rather than the field.
  typedNumber: boolean
  alignFrom?: FormatSource
  // The effective style of the placeholder's text (its first run, else the
  // first paragraph's level), each value with its source.
  style?: EffectiveTextStyle | null
}

export type LinkKind =
  | "slide"
  | "show jump"
  | "web"
  | "email"
  | "file"
  | "other presentation"
  | "custom show"
  | "program"
  | "macro"
  | "no action"
  | "other"

export type Link = {
  event: "click" | "mouse over"
  on: "shape" | "text"
  shapeName: string
  shapeGeometry: string | null
  text: string | null
  kind: LinkKind
  action: string | null
  target: string | null
  targetSlide: { number: number; title: string | null } | null
  jump: string | null
  // For a file link: the file's name, and whether the link holds a full
  // path on the computer it was made on (which breaks when the file moves).
  fileName: string | null
  absolutePath: boolean | null
  description: string
}

// The effective formatting of a shape's text, every run considered.
export type TextSummary = {
  // Distinct sizes as shown, after any shrink-on-overflow scale.
  sizesPt: number[]
  bold: "yes" | "no" | "mixed"
  italic: "yes" | "no" | "mixed"
  colours: Colour[]
  fonts: string[]
  // PowerPoint's "shrink text on overflow" scale, e.g. 92.5.
  autofitScalePercent: number | null
  underline?: "yes" | "no" | "mixed"
  // Properties some run's value of could not be resolved ("size", "colour", "font").
  unknown?: string[]
}

export type ShapeInfo = {
  id: string
  name: string
  kind: "shape" | "text box" | "picture" | "table" | "chart" | "diagram" | "media" | "graphic frame" | "connector" | "ole object"
  descr: string | null
  hidden: boolean
  placeholder: PlaceholderRef | null
  geometry: string | null
  box: Box | null
  // True when the position came from the layout or master placeholder.
  boxInherited: boolean
  paragraphs: Paragraph[]
  textSummary: TextSummary | null
  // Cell text by row, for a table.
  tableRows: string[][] | null
  inGroup: string | null
  pictureFill: PictureFill | null
  fill?: FillInfo | null
  // Null for a shape with no text body (pictures, tables …).
  textLayout?: TextLayout | null
  // Where on the slide the box's centre is ("bottom left" …).
  corner?: string | null
}

export type PictureInfo = {
  name: string
  descr: string | null
  hidden: boolean
  mediaPart: string | null
  linkedTarget: string | null
  sha256: string | null
  pixelWidth: number | null
  pixelHeight: number | null
  box: Box | null
  boxInherited: boolean
  placeholder: PlaceholderRef | null
  placeholderName: string | null
  cropPercent: CropPercent | null
  displayedAspect: number | null
  imageAspect: number | null
  stretched: boolean | null
  distortionPercent: number | null
  corner: string | null
  // Picture Format > Transparency (100 − alphaModFix), 0 when not set.
  transparencyPercent: number
  // How much of the slide the picture's box covers, 0–100.
  slideCoveragePercent: number | null
  // The box's size on the slide in pixels at 96 dpi (EMU / 9525).
  slidePx?: { width: number; height: number } | null
  // Which supplied image it is; null when no supplied images were given.
  match: ImageMatch | null
}

export type BackgroundInfo = {
  kind: "none" | "solid" | "picture" | "gradient" | "pattern" | "theme style"
  colour: Colour | null
  mediaPart: string | null
  sha256: string | null
  transparencyPercent: number | null
  tiled: boolean | null
  // For a picture background: which supplied image it is; null when no
  // supplied images were given.
  match: ImageMatch | null
}

export type PlaceholderInfo = {
  type: string
  idx: number | null
  name: string
  box: Box | null
  align: string | null
  text: string
  fields: Field[]
  textLayout?: TextLayout | null
  fill?: FillInfo | null
  // The effective style of level-1 text in it, with sources.
  style?: EffectiveTextStyle | null
}

export type TitleStyle = TextRunStyle & {
  // Attributes set on the slide itself rather than coming from the master.
  overridesOnSlide: string[]
  textLayout?: TextLayout | null
  fill?: FillInfo | null
}

export type MasterInfo = {
  number: number
  part: string
  name: string | null
  background: BackgroundInfo
  titleStyle: TextRunStyle
  bodyStyle: TextRunStyle
  pictures: PictureInfo[]
  shapes: ShapeInfo[]
  placeholders: PlaceholderInfo[]
  footerItems: FooterItem[]
  headerFooter: HeaderFooterFlags | null
}

export type LayoutInfo = {
  part: string
  masterNumber: number
  name: string | null
  type: string | null
  placeholders: PlaceholderInfo[]
  pictures: PictureInfo[]
  shapes: ShapeInfo[]
  showsDate: boolean
  showsFooter: boolean
  showsSlideNumber: boolean
  hasPicturePlaceholder: boolean
  footerItems: FooterItem[]
  background: BackgroundInfo | null
  showMasterShapes: boolean
  headerFooter: HeaderFooterFlags | null
  usedBySlides: number[]
}

export type TransitionInfo = {
  effect: string | null
  element: string | null
  options: Record<string, string>
  speed: string | null
  durationSeconds: number | null
  advanceOnClick: boolean
  advanceAfterSeconds: number | null
}

export type AnimationInfo = {
  sequence: "main" | "interactive"
  trigger: string | null
  order: number
  class: AnimationClass
  presetId: number | null
  presetSubtype: number | null
  effectName: string
  start: "On Click" | "With Previous" | "After Previous" | "Other"
  durationSeconds: number | null
  delaySeconds: number
  repeat: string | null
  target: {
    shapeId: string
    shapeName: string | null
    paragraphStart: number | null
    paragraphEnd: number | null
    paragraphText: string | null
    background: boolean
  } | null
}

export type Overlap = {
  a: string
  b: string
  overlapPercentOfSmaller: number
  // The one drawn on top.
  inFront: string
  // Both are footer placeholders (date, footer, slide number), whose boxes
  // touch in PowerPoint's own layouts while their text is aligned apart.
  footerPlaceholders: boolean
  // One of the two is a picture covering most of the slide, as a background.
  fullSlidePicture: string | null
}

export type OffSlide = { name: string; edges: string[] }

export type ActionButton = {
  slide: number
  name: string
  geometry: string
  box: Box | null
  links: Link[]
}

export type SlideInfo = {
  number: number
  part: string
  layoutName: string | null
  layoutPart: string | null
  hidden: boolean
  title: string | null
  titleStyle: TitleStyle | null
  shapes: ShapeInfo[]
  pictures: PictureInfo[]
  footerItems: FooterItem[]
  inheritedGraphics: string[]
  overlaps: Overlap[]
  offSlide: OffSlide[]
  duplicateShapeIds: string[]
  background: BackgroundInfo | null
  // The background the slide shows, from the slide, its layout or the master.
  effectiveBackground: { source: "slide" | "layout" | "slide master"; background: BackgroundInfo } | null
  // Pictures (the slide's own or from the layout/master) that cover most of
  // the slide, the way a background picture inserted as a picture does.
  fullSlidePictures: { name: string; source: "slide" | "layout" | "slide master"; transparencyPercent: number; coveragePercent: number }[]
  transition: TransitionInfo | null
  animations: AnimationInfo[]
  links: Link[]
  actionButtons: ActionButton[]
  notes: string | null
}

export type NotesMasterInfo = {
  kind: "notes master" | "handout master"
  part: string
  placeholders: FooterItem[]
  headerFooter: HeaderFooterFlags | null
}

export type MediaInfo = {
  part: string
  bytes: number
  sha256: string | null
  format: string | null
  pixelWidth: number | null
  pixelHeight: number | null
  usedBy: string[]
}

// Where a picture is: "slide 3", "slide master 1", 'layout "Title Only"'.
export type ImageUse = {
  where: string
  as: "picture" | "full-slide picture" | "background" | "picture fill"
  // The picture's or shape's name; null for a background.
  shapeName: string | null
  box: Box | null
  match: ImageMatch
}

export type SuppliedImageReport = {
  name: string
  // Every picture named after this image; empty when it is not used.
  uses: ImageUse[]
}

export type PresentationReport = {
  presentation: {
    application: string | null
    appVersion: string | null
    slideCount: number
    slideSize: {
      cx: number
      cy: number
      widthCm: number
      heightCm: number
      ratio: string
      nearestNamedRatio: string
      exactNamedRatio: boolean
      typeLabel: string | null
    }
    hiddenSlides: number[]
    show: {
      mode: "presented by a speaker" | "browsed by an individual" | "kiosk"
      loopUntilEsc: boolean
      useTimings: boolean
      showNarration: boolean
      showAnimation: boolean
    }
    hasMacros: boolean
  }
  masters: MasterInfo[]
  layouts: LayoutInfo[]
  slides: SlideInfo[]
  notesMaster: NotesMasterInfo | null
  handoutMaster: NotesMasterInfo | null
  notesSlideFooters: { slide: number; items: FooterItem[] }[]
  media: MediaInfo[]
  // Only when supplied images were given: each one and where it is used,
  // and the pictures that are none of them.
  suppliedImages: SuppliedImageReport[] | null
  unmatchedPictures: (ImageUse & { mediaPart: string | null; pixelWidth: number | null; pixelHeight: number | null })[] | null
  warnings: string[]
}
