import { currentFileName, pastVersionNames } from '@/lib/storage/file-versions'

// Which listed files are past versions (src/lib/storage/file-versions.ts).
// Pure: no database. Run: npx tsx tests/storage/file-versions.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

const past = (names: string[]) => [...pastVersionNames(names)].sort()

check(
  'the stamp is stripped, keeping the extension',
  currentFileName('Slides_07-11-2026_14-05-09.pptx') === 'Slides.pptx',
  currentFileName('Slides_07-11-2026_14-05-09.pptx'),
)
check('a stamped name with no extension strips to its base', currentFileName('notes_01-02-2025_00-00-00') === 'notes')
check('only the last extension follows the stamp', currentFileName('data.tar_01-02-2025_10-11-12.gz') === 'data.tar.gz')
check('a plain name is its own current name', currentFileName('Slides.pptx') === 'Slides.pptx')

check(
  'a stamped copy is past when its current copy is listed',
  JSON.stringify(past(['Slides.pptx', 'Slides_07-11-2026_14-05-09.pptx'])) ===
    JSON.stringify(['Slides_07-11-2026_14-05-09.pptx']),
)
check(
  'every older copy of one file is past',
  past(['KO.pdf', 'KO_01-09-2026_08-00-00.pdf', 'KO_02-09-2026_08-00-00.pdf']).length === 2,
)
check(
  'a stamped copy is not past when its current copy is missing',
  past(['Slides_07-11-2026_14-05-09.pptx', 'Other.pptx']).length === 0,
)
check(
  'a stamped copy of a file with a different extension is not past',
  past(['Slides.pdf', 'Slides_07-11-2026_14-05-09.pptx']).length === 0,
)
check(
  'no extension: past when the bare name is listed',
  JSON.stringify(past(['notes', 'notes_01-02-2025_00-00-00'])) === JSON.stringify(['notes_01-02-2025_00-00-00']),
)
check('plain names are never past', past(['a.pdf', 'b.pdf', 'Slides.pptx']).length === 0)

const otherDates = [
  'Report_2026-11-07.pdf',
  'Report_07-11-2026.pdf',
  'Report_07-11-2026_14-05.pdf',
  'Report_07-11-26_14-05-09.pdf',
  'Report 07-11-2026 14-05-09.pdf',
  'Report_07-11-2026_14-05-09_final.pdf',
]
check(
  'dates in other formats are not version stamps',
  otherDates.every((name) => currentFileName(name) === name),
  otherDates.filter((name) => currentFileName(name) !== name).join(', '),
)
check('…so they are never past', past(['Report.pdf', ...otherDates]).length === 0)

console.log(failed ? `${failed} FAILED` : 'ALL PASS')
process.exit(failed ? 1 : 0)
