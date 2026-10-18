'use client'

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

const MIN_HEIGHT = 320
const BOTTOM_GAP = 24

/**
 * The scroll box for a report grid. It is sized to end at the bottom of the
 * window, so its horizontal scrollbar is visible without scrolling the page,
 * and the table's header row stays pinned while it scrolls. Pin the first
 * column with `sticky left-0` on its cells, as the grids already do.
 */
export function ReportGrid({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [maxHeight, setMaxHeight] = useState<number | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      // Position on the page, not in the viewport, so scrolling does not change it.
      const top = el.getBoundingClientRect().top + window.scrollY
      setMaxHeight(Math.max(MIN_HEIGHT, window.innerHeight - top - BOTTOM_GAP))
    }
    update()
    window.addEventListener('resize', update)
    // Content above the grid (filters, a banner) can change its position.
    const observer = new ResizeObserver(update)
    observer.observe(document.body)
    return () => {
      window.removeEventListener('resize', update)
      observer.disconnect()
    }
  }, [])

  return (
    <div
      ref={ref}
      style={maxHeight ? { maxHeight } : undefined}
      className={cn(
        'overflow-auto rounded-xl border border-border bg-card shadow-sm',
        // The header row stays at the top of the box. bg-card under it keeps
        // the rows scrolling beneath from showing through translucent cells.
        '[&_thead]:sticky [&_thead]:top-0 [&_thead]:z-20 [&_thead]:bg-card [&_thead]:shadow-[0_1px_0_var(--border)]',
        className,
      )}
    >
      {children}
    </div>
  )
}
