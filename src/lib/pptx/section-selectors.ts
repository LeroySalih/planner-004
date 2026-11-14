// The parts of a presentation report an evidence source can ask for. Shared by
// describe.ts and the evidence spec; no imports, so the lesson editor can load
// it in the browser.

// "master" is every slide master, "slides" every slide, "notes" the notes and
// handout masters. "slides:3,6" names some slides only.
export const PRESENTATION_SECTION_KEYS = Object.freeze([
  "presentation",
  "master",
  "layouts",
  "slides",
  "action-buttons",
  "notes",
  "supplied-images",
  "media",
  "warnings",
] as const)

export type PresentationSectionKey = (typeof PRESENTATION_SECTION_KEYS)[number]

/** What a source with no sections gets: everything but media. */
export const DEFAULT_PRESENTATION_SECTIONS: readonly PresentationSectionKey[] = Object.freeze(
  PRESENTATION_SECTION_KEYS.filter((key) => key !== "media"),
)

export function isPresentationSectionSelector(selector: string): boolean {
  return (PRESENTATION_SECTION_KEYS as readonly string[]).includes(selector) || /^slides:\d+(,\d+)*$/.test(selector)
}
