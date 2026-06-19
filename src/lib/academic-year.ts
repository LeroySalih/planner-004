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
