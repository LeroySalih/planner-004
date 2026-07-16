export function currentAcademicYear(): number {
  const now = new Date()
  // Academic year starts in September (month index 8)
  return now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1
}

export function academicYearLabel(year: number): string {
  return `${year}/${String(year + 1).slice(2)}`
}

export function availableAcademicYears(year: number = currentAcademicYear()): number[] {
  return [year - 1, year, year + 1]
}

/** First day of the academic year: 1 September of `year` (ISO YYYY-MM-DD). */
export function academicYearStart(year: number): string {
  return `${year}-09-01`
}

/** Last day of the academic year: 31 August of `year + 1` (ISO YYYY-MM-DD). */
export function academicYearEnd(year: number): string {
  return `${year + 1}-08-31`
}

/** True when an ISO (YYYY-MM-DD) date falls within the given academic year. */
export function isWithinAcademicYear(isoDate: string, year: number): boolean {
  return isoDate >= academicYearStart(year) && isoDate <= academicYearEnd(year)
}

/**
 * Validate a half-term's dates for an academic year. Returns an error message,
 * or null when valid. Both dates must sit inside the Sep→Aug academic-year
 * window and start must precede end — this catches wrong-year typos (e.g. an
 * H3 saved in Jan of `year` instead of `year + 1`) before they blank the SoW.
 */
export function validateHalfTermDates(
  year: number,
  startDate: string,
  endDate: string,
): string | null {
  if (!startDate || !endDate) {
    return 'Set both a start and end date.'
  }
  if (startDate >= endDate) {
    return 'Start date must be before end date.'
  }
  if (!isWithinAcademicYear(startDate, year) || !isWithinAcademicYear(endDate, year)) {
    return `Dates for ${academicYearLabel(year)} must fall between ${academicYearStart(year)} and ${academicYearEnd(year)}.`
  }
  return null
}

export async function fetchActiveAcademicYears(): Promise<number[]> {
  const { readActiveSchoolYearsAction } = await import('@/lib/server-updates')
  const { data } = await readActiveSchoolYearsAction()
  if (data && data.length > 0) return data.map((y) => y.year)
  // Fallback to computed years if table is empty
  const year = currentAcademicYear()
  return availableAcademicYears(year)
}
