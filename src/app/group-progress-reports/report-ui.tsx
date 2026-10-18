'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

export function SummativeToggle({ summativeOnly }: { summativeOnly: boolean }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const handleToggle = (checked: boolean) => {
    const params = new URLSearchParams(searchParams)
    if (checked) params.set('summative', 'true')
    else params.delete('summative')
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="flex items-center gap-3">
      <Switch id="summative-toggle" checked={summativeOnly} onCheckedChange={handleToggle} />
      <Label htmlFor="summative-toggle" className="cursor-pointer">
        Show assessment scores only (summative activities)
      </Label>
    </div>
  )
}

export function formatPercent(value: number | null) {
  return typeof value === 'number' && !Number.isNaN(value) ? `${Math.round(value)}%` : '—'
}

export function getMetricColor(value: number | null): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return 'text-muted-foreground'
  if (value < 40) return 'text-red-600 dark:text-red-400'
  if (value < 70) return 'text-amber-600 dark:text-amber-400'
  return 'text-green-600 dark:text-green-400'
}

export function getCellBgColor(value: number | null): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return 'bg-muted/30'
  if (value < 40) return 'bg-red-50 dark:bg-red-900/20'
  if (value < 70) return 'bg-amber-50 dark:bg-amber-900/20'
  return 'bg-green-50 dark:bg-green-900/20'
}
