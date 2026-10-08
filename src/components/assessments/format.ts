/** "2026-10-08" -> "08-10-2026". Kept as string surgery so no timezone can shift the day. */
export function formatAssessmentDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-')
  return year && month && day ? `${day}-${month}-${year}` : isoDate
}

export function percentOf(awarded: number, available: number): number {
  return available > 0 ? Math.round((awarded / available) * 100) : 0
}

export type ScoreBand = 'full' | 'partial' | 'zero'

export function scoreBand(awarded: number, available: number): ScoreBand {
  if (available > 0 && awarded >= available) return 'full'
  return awarded > 0 ? 'partial' : 'zero'
}

/** Cell/badge colours for each band; shared by the grid legend and the feedback view. */
export const SCORE_BAND_CLASSES: Record<ScoreBand, string> = {
  full: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  partial: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  zero: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200',
}

/** Average colours by percentage, so weak questions stand out in the class row. */
export function averageBandClass(percent: number): string {
  if (percent >= 70) return SCORE_BAND_CLASSES.full
  if (percent >= 40) return SCORE_BAND_CLASSES.partial
  return SCORE_BAND_CLASSES.zero
}

export function pupilName(pupil: { first_name: string | null; last_name: string | null; pupil_id: string }): string {
  return `${pupil.first_name ?? ''} ${pupil.last_name ?? ''}`.trim() || pupil.pupil_id
}
