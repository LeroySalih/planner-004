'use client'

import { formatWeekRange, getTodaySunday } from './types'

type WeekNavigatorProps = {
  currentWeek: string
  onPrev: () => void
  onNext: () => void
}

export function WeekNavigator({ currentWeek, onPrev, onNext }: WeekNavigatorProps) {
  const isCurrentWeek = currentWeek === getTodaySunday()

  return (
    <div className="flex items-center justify-between mb-4">
      <button
        type="button"
        onClick={onPrev}
        className="w-7 h-7 flex items-center justify-center rounded-[6px] bg-transparent border border-[var(--color-border-tertiary)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-secondary)] hover:text-[var(--color-text-primary)] transition-colors text-[14px] cursor-pointer"
        aria-label="Previous week"
      >
        ‹
      </button>

      <div className="flex flex-col items-center gap-0.5">
        <span className="text-[13px] font-medium text-[var(--color-text-primary)]">
          {formatWeekRange(currentWeek)}
        </span>
        {isCurrentWeek && (
          <span className="text-[10px] text-[var(--color-text-tertiary)] uppercase tracking-wide">
            This week
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={onNext}
        className="w-7 h-7 flex items-center justify-center rounded-[6px] bg-transparent border border-[var(--color-border-tertiary)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-secondary)] hover:text-[var(--color-text-primary)] transition-colors text-[14px] cursor-pointer"
        aria-label="Next week"
      >
        ›
      </button>
    </div>
  )
}
