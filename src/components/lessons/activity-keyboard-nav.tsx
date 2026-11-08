"use client"

import { useEffect } from "react"

/**
 * ArrowDown / ArrowUp move between the activities on a pupil lesson page, in
 * either layout: the next activity scrolls to the top and its first text box
 * takes focus (or the activity itself, when it has none).
 *
 * Activities are the elements marked `data-activity-nav`, each wrapping exactly
 * one activity. Elements marked `data-sticky-header` (the top bar, the slides'
 * section heading, the page's mobile contents bar) are measured so the activity
 * does not land under them. Anything marked `data-activity-nav-skip` keeps its
 * arrow keys, as do controls that use them (selects, radios, menus, dialogs).
 */

export type NavDirection = "next" | "previous"

/** What the focused element is, as far as the arrow keys are concerned. */
export type FocusKind =
  | { kind: "other" }
  | { kind: "text-input" }
  | { kind: "textarea"; selectionStart: number; selectionEnd: number; length: number }
  | { kind: "blocked" }

const TEXT_INPUT_TYPES = new Set(["", "text", "search", "email", "url", "tel"])

const ARROW_KEY_ROLES = new Set([
  "radio",
  "radiogroup",
  "listbox",
  "option",
  "menu",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "combobox",
  "slider",
  "spinbutton",
  "tab",
  "tablist",
  "tree",
  "treeitem",
  "grid",
  "gridcell",
])

const BLOCKING_ANCESTORS = [
  "[contenteditable]:not([contenteditable='false'])",
  "[data-activity-nav-skip]",
  "[role=dialog]",
  "[role=alertdialog]",
  "[data-radix-popper-content-wrapper]",
  ".monaco-editor",
  ".cm-editor",
  ...[...ARROW_KEY_ROLES].map((role) => `[role=${role}]`),
].join(",")

/** `type` as written, so a missing or empty type counts as text. */
export function isTextInputType(type: string | null): boolean {
  return TEXT_INPUT_TYPES.has((type ?? "").trim().toLowerCase())
}

export function shouldMove(
  key: string,
  focus: FocusKind,
  event: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; defaultPrevented: boolean; isComposing: boolean },
): NavDirection | null {
  const direction = key === "ArrowDown" ? "next" : key === "ArrowUp" ? "previous" : null
  if (!direction) return null
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null
  if (event.defaultPrevented || event.isComposing) return null
  if (focus.kind === "blocked") return null
  if (focus.kind === "textarea") {
    // Only once the caret has nowhere further to go in that direction.
    if (focus.selectionStart !== focus.selectionEnd) return null
    if (direction === "next" && focus.selectionEnd !== focus.length) return null
    if (direction === "previous" && focus.selectionStart !== 0) return null
  }
  return direction
}

/**
 * The activity being read when focus is outside every activity: the last one
 * whose top has reached the reading line. -1 when the pupil is still above the
 * first.
 */
export function readingIndex(tops: number[], line: number, tolerance = 8): number {
  let index = -1
  tops.forEach((top, i) => {
    if (top <= line + tolerance) index = i
  })
  return index
}

/** The activity to move to, or null to leave the key alone. */
export function targetIndex(current: number, count: number, direction: NavDirection): number | null {
  const target = direction === "next" ? current + 1 : current - 1
  if (current < 0 && direction === "previous") return null
  return target >= 0 && target < count ? target : null
}

/** How far down the viewport a top-aligned activity must sit to clear the pinned headers. */
export function stickyOffset(headers: { top: number; height: number }[]): number {
  return headers.reduce((max, header) => Math.max(max, header.top + header.height), 0)
}

function describeFocus(element: Element | null): FocusKind {
  if (!element || element === document.body) return { kind: "other" }
  if (element.closest(BLOCKING_ANCESTORS)) return { kind: "blocked" }
  if (element instanceof HTMLSelectElement) return { kind: "blocked" }
  if (element instanceof HTMLInputElement) {
    return isTextInputType(element.getAttribute("type")) ? { kind: "text-input" } : { kind: "blocked" }
  }
  if (element instanceof HTMLTextAreaElement) {
    return {
      kind: "textarea",
      selectionStart: element.selectionStart,
      selectionEnd: element.selectionEnd,
      length: element.value.length,
    }
  }
  return { kind: "other" }
}

function isVisible(element: HTMLElement) {
  return element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden"
}

function firstTextBox(activity: HTMLElement): HTMLElement | null {
  for (const field of activity.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("textarea, input")) {
    if (field instanceof HTMLInputElement && !isTextInputType(field.getAttribute("type"))) continue
    if (field.disabled || field.readOnly || field.closest("[data-activity-nav-skip]")) continue
    if (isVisible(field)) return field
  }
  return null
}

function currentOffset() {
  const headers = [...document.querySelectorAll<HTMLElement>("[data-sticky-header]")]
    .filter(isVisible)
    .map((header) => ({ top: Number.parseFloat(getComputedStyle(header).top) || 0, height: header.offsetHeight }))
  return stickyOffset(headers)
}

export function ActivityKeyboardNav() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const active = document.activeElement
      const direction = shouldMove(event.key, describeFocus(active), event)
      if (!direction) return

      const activities = [...document.querySelectorAll<HTMLElement>("[data-activity-nav]")]
      if (activities.length === 0) return
      const gap = 16
      const offset = currentOffset()
      const holder = active ? activities.findIndex((activity) => activity.contains(active)) : -1
      const current =
        holder >= 0 ? holder : readingIndex(activities.map((activity) => activity.getBoundingClientRect().top), offset + gap)
      const index = targetIndex(current, activities.length, direction)
      if (index === null) return

      event.preventDefault()
      const activity = activities[index]
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      window.scrollTo({
        top: activity.getBoundingClientRect().top + window.scrollY - offset - gap,
        behavior: reduce ? "auto" : "smooth",
      })
      // Each wrapper has tabIndex -1, so an activity without a text box still
      // holds focus and the next arrow press carries on from it.
      const focusTarget = firstTextBox(activity) ?? activity
      focusTarget.focus({ preventScroll: true })
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [])

  return null
}
