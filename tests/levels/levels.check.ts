import { DEFAULT_YEAR_GROUP_LEVELS, getLevelBoundaries, getLevelForYearScore, TOP_LEVELS } from '@/lib/levels'

// The level a score earns, against the school's Grade Boundary Calculator
// (src/lib/levels). Pure: no database. Run: npx tsx tests/levels/levels.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

const ranges = DEFAULT_YEAR_GROUP_LEVELS
const level = (year: number | null, score: number | null) => getLevelForYearScore(ranges, year, score)
const bandsOf = (year: number) => getLevelBoundaries(ranges.find((r) => r.yearGroup === year))

// The calculator's boundaries as whole percentages, per year, from 1L up. Year
// 7's 1L-2L are by the formula (7, 13, 20, 27): the sheet's own cells divide
// by Year 8's step count there.
const SHEET: Record<number, number[]> = {
  7: [7, 13, 20, 27, 33, 40, 47, 53, 60, 67, 73, 80, 87, 93],
  8: [6, 11, 17, 22, 28, 33, 39, 44, 50, 56, 61, 67, 72, 78, 83, 89, 94],
  9: [5, 10, 14, 19, 24, 29, 33, 38, 43, 48, 52, 57, 62, 67, 71, 76, 81, 86, 90, 95],
  10: [4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 68, 72, 76, 80, 84, 88, 92, 96],
  11: [4, 7, 11, 14, 18, 21, 25, 29, 32, 36, 39, 43, 46, 50, 54, 57, 61, 64, 68, 71, 75, 79, 82, 86, 89, 93, 96],
}
const TOP: Record<number, string> = { 7: '5M', 8: '6M', 9: '7M', 10: '8H', 11: '9H' }

for (const year of [7, 8, 9, 10, 11]) {
  const bands = bandsOf(year)
  const sheet = SHEET[year]
  check(`Year ${year}: 1L … ${TOP[year]} (${sheet.length} levels)`,
    bands.map((b) => b.level).join() === TOP_LEVELS.slice(0, sheet.length).join() && bands.at(-1)?.level === TOP[year])
  check(`Year ${year}: 1M upwards start at the calculator's whole numbers`,
    bands.slice(1).map((b) => b.minPercent).join() === sheet.slice(1).join(), bands.map((b) => b.minPercent).join())
  check(`Year ${year}: 0% is 1L, 100% is ${TOP[year]}`, level(year, 0) === '1L' && level(year, 100) === TOP[year])
  check(`Year ${year}: below 1L's boundary (${sheet[0]}%) is still 1L`, level(year, sheet[0] - 0.5) === '1L')
  const misplaced = bands.slice(1).filter((b, i) => level(year, b.minPercent) !== b.level || level(year, b.minPercent - 0.001) !== bands[i].level)
  check(`Year ${year}: each level starts exactly at its whole-number boundary`, misplaced.length === 0, misplaced.map((b) => b.level).join())
}

check('Year 7: 82% is 4H, 71% is 4L', level(7, 82) === '4H' && level(7, 71) === '4L')
check('Year 7: 93% is 5M (whole-number boundary), 92.9% is 5L', level(7, 93) === '5M' && level(7, 92.9) === '5L')
check('Year 7: 13% is 1M, 12.9% is 1L (the rule, not the sheet\'s 11)', level(7, 13) === '1M' && level(7, 12.9) === '1L')
check('Year 10: exactly 28% is 3L, not 2H', level(10, 28) === '3L')
check('a fraction is read as a share of 100%', level(7, 0.82) === level(7, 82))
check('no score → no level', level(7, null) === null && level(7, Number.NaN) === null)
check('a year group with no top level → no level', level(12, 50) === null && level(null, 50) === null)
check('a negative score is 1L', level(7, -5) === '1L')
check('levels come from the argument, not the defaults', getLevelForYearScore([{ yearGroup: 7, topLevel: '1H' }], 7, 50) === '1M')
check('an unknown top level gives no level', getLevelForYearScore([{ yearGroup: 7, topLevel: '10L' }], 7, 50) === null)

console.log(failed ? `${failed} FAILED` : 'ALL PASS')
process.exit(failed ? 1 : 0)
