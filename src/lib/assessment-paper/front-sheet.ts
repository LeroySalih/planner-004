import "server-only"

import sharp from "sharp"

// The page-1 check, on the server, with no model. Every paper starts with a
// front sheet, the only place a pupil writes their name, and page 1 of a
// script is never sent to a model. So before pages 2..n are used, the script
// must show it is in order: page 1 looks like the blank front sheet (page 1 of
// the question paper), and it has as many pages as the paper. A scan out of
// order, a double-sided scan that flipped pages, or an extra or missing sheet
// fails, and the script is held.
//
// The comparison: both pages are shrunk to a small greyscale thumbnail
// (SIGNATURE_WIDTH x SIGNATURE_HEIGHT, stretched to fill, so a scan's slightly
// different page size does not matter), blurred a little so a small shift of
// the scan does not count, contrast-stretched (a grey scanner background
// reads like white paper), and compared by mean absolute difference, 0..1.
//
// FRONT_SHEET_MAX_DIFFERENCE was calibrated on dev, 02-11-2026, with
// tests/assessment-paper/front-sheet-calibrate.ts (which prints the figures).
// The dev question papers are re-typeset copies, not what pupils sat, so real
// scans were compared with each other: the same printed page in two pupils'
// scans (pages 2-4 of the Materials and Systems scripts, never page 1).
//   * a front sheet against itself: 0
//   * a front sheet with name, class and teacher written in: 0.009
//   * the same, "scanned" (0.8 degree skew, grey paper, noise): 0.101
//   * the same printed page, two pupils' real scans, each page full of
//     handwritten answers: 0.010-0.125 (90 pairs)
//   * different printed pages, two pupils' real scans: 0.158-0.238 (180 pairs)
//   * a front sheet against four papers' page 1: 0.213-0.267
// 0.14 passes every same-page pair, though those carry far more writing than
// a front sheet ever does, and fails every different-page pair. The margin on
// the wrong-page side (0.158) is the narrower one; a script wrongly held is
// fixed by re-uploading, a wrong page passed would be sent to the marker.

export const SIGNATURE_WIDTH = 64
export const SIGNATURE_HEIGHT = 90
export const FRONT_SHEET_MAX_DIFFERENCE = 0.14

export const NO_FRONT_SHEET_MESSAGE =
  "Upload the question paper with its front sheet first: a script's page 1 is checked against it."

/** A page as a SIGNATURE_WIDTH x SIGNATURE_HEIGHT greyscale thumbnail, one byte per pixel. */
export async function pageSignature(page: Buffer): Promise<Buffer> {
  return sharp(page)
    .rotate()
    .flatten({ background: "#ffffff" })
    .greyscale()
    .resize(SIGNATURE_WIDTH, SIGNATURE_HEIGHT, { fit: "fill" })
    .blur(1)
    .normalise()
    .raw()
    .toBuffer()
}

/** Mean absolute difference of two signatures, 0 (identical) .. 1. */
export function signatureDifference(a: Buffer, b: Buffer): number {
  if (a.length !== b.length || a.length === 0) throw new Error("Page signatures differ in size.")
  let total = 0
  for (let i = 0; i < a.length; i += 1) total += Math.abs(a[i] - b[i])
  return total / (a.length * 255)
}

/**
 * 'passed', or the reason the script is held. The page count is checked
 * first: it is the clearer message when a sheet is missing or extra.
 */
export async function checkFrontSheet(input: {
  scriptFirstPage: Buffer
  scriptPageCount: number
  paperFirstPage: Buffer
  paperPageCount: number
}): Promise<{ result: string; difference: number | null }> {
  const { scriptPageCount, paperPageCount } = input
  if (scriptPageCount !== paperPageCount) {
    return {
      result: `Held: the script has ${scriptPageCount} page${scriptPageCount === 1 ? "" : "s"} but the question paper has ${paperPageCount}. Check for missing or extra sheets and upload it again.`,
      difference: null,
    }
  }
  const difference = signatureDifference(
    await pageSignature(input.scriptFirstPage),
    await pageSignature(input.paperFirstPage),
  )
  if (difference > FRONT_SHEET_MAX_DIFFERENCE) {
    return {
      result: "Held: page 1 of the script is not the front sheet. Check the page order (and that a double-sided scan has not flipped pages), then upload it again.",
      difference,
    }
  }
  return { result: "passed", difference }
}
