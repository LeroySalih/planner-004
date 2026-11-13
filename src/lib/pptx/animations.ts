// Animations from p:timing. Each effect is a cTn whose nodeType says how it
// starts (clickEffect / withEffect / afterEffect). Its DURATION is how long
// its behaviours run (the longest behaviour's delay + dur); its DELAY is the
// effect's own start condition. The two are kept apart because a delay of
// 2 s is not a duration of 2 s.

import { animationClass, animationEffectName } from "./effect-names"
import type { AnimationInfo } from "./types"
import { attr, child, descendants, firstDescendant, kids, numAttr, type XmlElement } from "./xml"

export type ShapeLookup = (id: string) => { name: string; paragraphs: string[] } | null

const START_NAMES: Record<string, AnimationInfo["start"]> = {
  clickEffect: "On Click",
  withEffect: "With Previous",
  afterEffect: "After Previous",
}

function conditionDelay(cTn: XmlElement): number {
  for (const cond of kids(child(cTn, "stCondLst"), "cond")) {
    const delay = attr(cond, "delay")
    if (delay !== null && delay !== "indefinite" && Number.isFinite(Number(delay))) return Number(delay)
  }
  return 0
}

function effectDuration(effect: XmlElement): number | null {
  let longest: number | null = null
  for (const bhvr of descendants(child(effect, "childTnLst"), "cBhvr")) {
    const cTn = child(bhvr, "cTn")
    const dur = numAttr(cTn, "dur")
    if (!cTn || dur === null) continue
    const end = conditionDelay(cTn) + dur
    longest = longest === null ? end : Math.max(longest, end)
  }
  // Media and some custom effects time the effect node itself.
  if (longest === null) longest = numAttr(effect, "dur")
  return longest
}

function round(seconds: number) {
  return Math.round(seconds * 100) / 100
}

export function readAnimations(slide: XmlElement, lookup: ShapeLookup): AnimationInfo[] {
  const timing = child(slide, "timing")
  if (!timing) return []
  const out: AnimationInfo[] = []
  for (const seq of descendants(timing, "seq")) {
    const seqCTn = child(seq, "cTn")
    const nodeType = attr(seqCTn, "nodeType")
    if (nodeType !== "mainSeq" && nodeType !== "interactiveSeq") continue
    const sequence = nodeType === "mainSeq" ? "main" : "interactive"
    let trigger: string | null = null
    if (sequence === "interactive") {
      const spTgt = firstDescendant(child(seqCTn, "stCondLst"), "spTgt")
      const spid = attr(spTgt, "spid")
      trigger = spid ? lookup(spid)?.name ?? `shape id ${spid}` : null
    }
    const effects = descendants(seqCTn, "cTn").filter((cTn) => {
      const type = attr(cTn, "nodeType")
      return type === "clickEffect" || type === "withEffect" || type === "afterEffect"
    })
    let order = 0
    for (const effect of effects) {
      order += 1
      const presetClass = attr(effect, "presetClass")
      const presetId = numAttr(effect, "presetID")
      const duration = effectDuration(effect)
      const tgtEl = firstDescendant(effect, "tgtEl")
      const spTgt = child(tgtEl, "spTgt")
      let target: AnimationInfo["target"] = null
      if (spTgt) {
        const shapeId = attr(spTgt, "spid") ?? ""
        const shape = lookup(shapeId)
        const pRg = firstDescendant(spTgt, "pRg")
        const st = numAttr(pRg, "st")
        const end = numAttr(pRg, "end")
        let paragraphText: string | null = null
        if (shape && st !== null) {
          paragraphText = shape.paragraphs.slice(st, (end ?? st) + 1).join(" / ")
        }
        target = {
          shapeId,
          shapeName: shape?.name ?? null,
          paragraphStart: st === null ? null : st + 1,
          paragraphEnd: st === null ? null : (end ?? st) + 1,
          paragraphText,
          background: child(spTgt, "bg") !== null,
        }
      }
      out.push({
        sequence,
        trigger,
        order,
        class: animationClass(presetClass),
        presetId,
        presetSubtype: numAttr(effect, "presetSubtype"),
        effectName: animationEffectName(presetClass, presetId),
        start: START_NAMES[attr(effect, "nodeType") ?? ""] ?? "Other",
        durationSeconds: duration === null ? null : round(duration / 1000),
        delaySeconds: round(conditionDelay(effect) / 1000),
        repeat: attr(effect, "repeatCount"),
        target,
      })
    }
  }
  return out
}
