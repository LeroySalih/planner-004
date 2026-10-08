'use client'

import { usePathname, useRouter } from 'next/navigation'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const ALL = '__all'

export function AssessmentGroupFilter({ groupIds, value }: { groupIds: string[]; value: string | null }) {
  const router = useRouter()
  const pathname = usePathname()

  return (
    <Select
      value={value ?? ALL}
      onValueChange={(next) => router.push(next === ALL ? pathname : `${pathname}?group=${encodeURIComponent(next)}`)}
    >
      <SelectTrigger className="w-48" aria-label="Filter by group">
        <SelectValue placeholder="All groups" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All groups</SelectItem>
        {groupIds.map((groupId) => (
          <SelectItem key={groupId} value={groupId}>{groupId}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
