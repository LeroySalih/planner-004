import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { query } from '@/lib/db'
import { syntheticFrontSheet } from './synthetic-front-sheet'
import { FRONT_SHEET_MAX_DIFFERENCE, pageSignature, signatureDifference } from '@/lib/assessment-paper/front-sheet'

// Prints the differences FRONT_SHEET_MAX_DIFFERENCE was chosen from.
// Reads only: the folded papers' question papers and scripts on dev.
// Run as the files owner in the app image (poppler, sharp):
//   npx tsx tests/assessment-paper/front-sheet-calibrate.ts

const FILES = path.join(process.cwd(), 'files', 'assessment-scripts')

function render(pdf: string, first: number, last: number): Buffer[] {
  const dir = mkdtempSync(path.join(tmpdir(), 'cal-'))
  try {
    execFileSync('pdftoppm', ['-f', String(first), '-l', String(last), '-r', '150', '-png', pdf, path.join(dir, 'p')], { stdio: 'ignore' })
    return readdirSync(dir).sort().map((f) => readFileSync(path.join(dir, f)))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function main() {
  const range = (xs: number[]) => {
    const sorted = [...xs].sort((a, b) => a - b)
    return sorted.length ? `${sorted[0].toFixed(3)}..${sorted[sorted.length - 1].toFixed(3)} (n=${sorted.length})` : 'none'
  }

  // Real scans. The dev question papers are re-typeset copies, not the paper
  // the pupils sat, so a scan cannot be compared with them. Instead the same
  // printed page is compared across two pupils' scans: two scans and two
  // pupils' handwriting, far more writing than a front sheet carries. Pages
  // 2..4 only: page 1 carries the pupil's name.
  const same: number[] = [], different: number[] = []
  for (const activityId of ['26335414-5d13-4f5e-96b9-38624faf6d18', '0acf9cb0-fafd-46e2-ac53-9be693ed33ab']) {
    const { rows: scripts } = await query<{ original_path: string }>(
      'select original_path from assessment_scripts where activity_id = $1 order by original_path limit 6',
      [activityId],
    )
    const signed: Buffer[][] = []
    for (const s of scripts) {
      signed.push(await Promise.all(render(path.join(FILES, s.original_path), 2, 4).map((page) => pageSignature(page))))
    }
    for (let i = 0; i < signed.length; i += 1) {
      for (let j = i + 1; j < signed.length; j += 1) {
        for (let p = 0; p < signed[i].length; p += 1) {
          for (let q = 0; q < signed[j].length; q += 1) {
            ;(p === q ? same : different).push(signatureDifference(signed[i][p], signed[j][q]))
          }
        }
      }
    }
  }
  console.log('same printed page, two pupils\' scans:', range(same))
  console.log('different printed pages, two pupils\' scans:', range(different))

  const { rows } = await query<{ qp: string }>(
    "select body_data->>'questionPaperPath' qp from activities where type = 'assessment-paper' and body_data ? 'questionPaperPath'",
  )
  const paperPages = rows.map((r) => render(path.join(FILES, r.qp), 1, 1)[0])

  const blank = await pageSignature(await syntheticFrontSheet(false, false))
  console.log('front sheet vs itself:', signatureDifference(blank, blank).toFixed(3))
  console.log('front sheet with name, class, teacher written in:', signatureDifference(await pageSignature(await syntheticFrontSheet(true, false)), blank).toFixed(3))
  console.log('same, scanned (skew, grey paper, noise):', signatureDifference(await pageSignature(await syntheticFrontSheet(true, true)), blank).toFixed(3))
  console.log('front sheet vs question papers\' page 1:', range(await Promise.all(paperPages.map(async (p) => signatureDifference(await pageSignature(p), blank)))))
  console.log('threshold:', FRONT_SHEET_MAX_DIFFERENCE)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
