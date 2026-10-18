import { DEFAULT_YEAR_GROUP_LEVELS, getLevelBoundaries, getLevelForYearScore } from '@/lib/levels'

// The level a score earns per year group (src/lib/levels). Pure: no database.
// Run: npx tsx tests/levels/levels.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

const ranges = DEFAULT_YEAR_GROUP_LEVELS
const level = (year: number | null, score: number | null) => getLevelForYearScore(ranges, year, score)

const y7 = getLevelBoundaries(ranges.find((r) => r.yearGroup === 7))
check('Year 7 runs 1L to 3H in nine bands', y7.map((b) => b.level).join() === '1L,1M,1H,2L,2M,2H,3L,3M,3H')
check('… evenly spaced from 0%', y7[0].minPercent === 0 && Math.abs(y7[1].minPercent - 100 / 9) < 1e-9)
check('Year 7: 0% is 1L, 100% is 3H', level(7, 0) === '1L' && level(7, 100) === '3H')
check('Year 7: 82% is 3M (was 4H)', level(7, 82) === '3M', String(level(7, 82)))
check('Year 7: 71% is 3L', level(7, 71) === '3L', String(level(7, 71)))
check('Year 7: just below a boundary stays in the band below', level(7, 100 / 9 - 0.01) === '1L' && level(7, 100 / 9) === '1M')
check('Year 8 runs 2L to 4H', level(8, 0) === '2L' && level(8, 100) === '4H')
check('Year 9 runs 3L to 5H', level(9, 0) === '3L' && level(9, 100) === '5H')
check('Year 10 runs 1L to 7H in 21 bands', getLevelBoundaries(ranges.find((r) => r.yearGroup === 10)).length === 21 && level(10, 100) === '7H')
check('Year 11 runs 1L to 9H in 27 bands', getLevelBoundaries(ranges.find((r) => r.yearGroup === 11)).length === 27 && level(11, 100) === '9H')
check('a fraction is read as a share of 100%', level(7, 0.82) === level(7, 82))
check('no score → no level', level(7, null) === null && level(7, Number.NaN) === null)
check('a year group with no range → no level', level(12, 50) === null && level(null, 50) === null)
check('a negative score is 0%', level(7, -5) === '1L')
check('ranges come from the argument, not the defaults', getLevelForYearScore([{ yearGroup: 7, minLevel: 4, maxLevel: 4 }], 7, 50) === '4M')
check('a single-level range has L, M, H in thirds', getLevelForYearScore([{ yearGroup: 7, minLevel: 2, maxLevel: 2 }], 7, 34) === '2M')

console.log(failed ? `${failed} FAILED` : 'ALL PASS')
process.exit(failed ? 1 : 0)
