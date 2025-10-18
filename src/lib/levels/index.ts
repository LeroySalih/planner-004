const LEVEL_BOUNDARY_ROWS = [
  {
    level: "0",
    thresholds: { 7: 0, 8: 0, 9: 0, 10: 0, 11: 0 },
  },
  {
    level: "1L",
    thresholds: { 7: 6, 8: 6, 9: 5, 10: 4, 11: 4 },
  },
  {
    level: "1M",
    thresholds: { 7: 11, 8: 11, 9: 10, 10: 8, 11: 7 },
  },
  {
    level: "1H",
    thresholds: { 7: 17, 8: 17, 9: 14, 10: 12, 11: 11 },
  },
  {
    level: "2L",
    thresholds: { 7: 22, 8: 22, 9: 19, 10: 16, 11: 14 },
  },
  {
    level: "2M",
    thresholds: { 7: 33, 8: 28, 9: 24, 10: 20, 11: 18 },
  },
  {
    level: "2H",
    thresholds: { 7: 40, 8: 33, 9: 29, 10: 24, 11: 21 },
  },
  {
    level: "3L",
    thresholds: { 7: 47, 8: 39, 9: 33, 10: 28, 11: 25 },
  },
  {
    level: "3M",
    thresholds: { 7: 53, 8: 44, 9: 38, 10: 32, 11: 29 },
  },
  {
    level: "3H",
    thresholds: { 7: 60, 8: 50, 9: 43, 10: 36, 11: 32 },
  },
  {
    level: "4L",
    thresholds: { 7: 67, 8: 56, 9: 48, 10: 40, 11: 36 },
  },
  {
    level: "4M",
    thresholds: { 7: 73, 8: 61, 9: 52, 10: 44, 11: 39 },
  },
  {
    level: "4H",
    thresholds: { 7: 80, 8: 67, 9: 57, 10: 48, 11: 43 },
  },
  {
    level: "5L",
    thresholds: { 7: 87, 8: 72, 9: 62, 10: 52, 11: 46 },
  },
  {
    level: "5M",
    thresholds: { 7: 93, 8: 78, 9: 67, 10: 56, 11: 50 },
  },
  {
    level: "5H",
    thresholds: { 8: 83, 9: 71, 10: 60, 11: 54 },
  },
  {
    level: "6L",
    thresholds: { 8: 89, 9: 76, 10: 64, 11: 57 },
  },
  {
    level: "6M",
    thresholds: { 8: 94, 9: 81, 10: 68, 11: 61 },
  },
  {
    level: "6H",
    thresholds: { 9: 86, 10: 72, 11: 64 },
  },
  {
    level: "7L",
    thresholds: { 9: 90, 10: 76, 11: 68 },
  },
  {
    level: "7M",
    thresholds: { 9: 95, 10: 80, 11: 71 },
  },
  {
    level: "7H",
    thresholds: { 10: 84, 11: 75 },
  },
  {
    level: "8L",
    thresholds: { 10: 88, 11: 79 },
  },
  {
    level: "8M",
    thresholds: { 10: 92, 11: 82 },
  },
  {
    level: "8H",
    thresholds: { 10: 96, 11: 86 },
  },
  {
    level: "9L",
    thresholds: { 11: 89 },
  },
  {
    level: "9M",
    thresholds: { 11: 93 },
  },
] as const;

type YearGroup = 7 | 8 | 9 | 10 | 11

type LevelBoundary = {
  level: string
  minPercent: number
}

const LEVEL_BOUNDARIES_BY_YEAR: Record<YearGroup, LevelBoundary[]> = {
  7: [],
  8: [],
  9: [],
  10: [],
  11: [],
}

for (const row of LEVEL_BOUNDARY_ROWS) {
  const { level, thresholds } = row
  for (const yearKey of Object.keys(thresholds)) {
    const year = Number.parseInt(yearKey, 10) as YearGroup
    if (!LEVEL_BOUNDARIES_BY_YEAR[year]) {
      continue
    }

    const thresholdsRecord = thresholds as Record<string, number>
    const minPercent = thresholdsRecord[yearKey]
    if (typeof minPercent !== "number" || Number.isNaN(minPercent)) {
      continue
    }

    LEVEL_BOUNDARIES_BY_YEAR[year].push({ level, minPercent })
  }
}

for (const yearKey of Object.keys(LEVEL_BOUNDARIES_BY_YEAR)) {
  const year = Number.parseInt(yearKey, 10) as YearGroup
  LEVEL_BOUNDARIES_BY_YEAR[year].sort((a, b) => {
    if (a.minPercent === b.minPercent) {
      return LEVEL_BOUNDARY_ROWS.findIndex((row) => row.level === a.level) -
        LEVEL_BOUNDARY_ROWS.findIndex((row) => row.level === b.level)
    }
    return a.minPercent - b.minPercent
  })
}

export function getLevelForYearScore(year: number | null | undefined, rawScore: number | null | undefined): string | null {
  if (typeof year !== "number" || !Number.isFinite(year)) {
    return null
  }

  const roundedYear = Math.round(year) as YearGroup
  if (!LEVEL_BOUNDARIES_BY_YEAR[roundedYear as YearGroup]) {
    return null
  }

  if (rawScore === null || rawScore === undefined || Number.isNaN(rawScore)) {
    return null
  }

  const clampedScore = Math.max(0, rawScore)
  const percent = clampedScore > 1 ? clampedScore : clampedScore * 100
  const boundaries = LEVEL_BOUNDARIES_BY_YEAR[roundedYear]
  if (!boundaries || boundaries.length === 0) {
    return null
  }

  let resolvedLevel: string | null = null
  for (const entry of boundaries) {
    if (percent >= entry.minPercent) {
      resolvedLevel = entry.level
    } else {
      break
    }
  }

  return resolvedLevel ?? boundaries[0]?.level ?? null
}

export function getLevelBoundariesForYear(year: number | null | undefined): LevelBoundary[] {
  if (typeof year !== "number" || !Number.isFinite(year)) {
    return []
  }
  const roundedYear = Math.round(year) as YearGroup
  return LEVEL_BOUNDARIES_BY_YEAR[roundedYear] ?? []
}
