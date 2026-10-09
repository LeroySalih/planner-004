'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { InterventionStatusBadge, formatDay, formatScore } from '@/components/interventions/status-badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type { InterventionSummary } from '@/lib/interventions/store'
import { deleteInterventionsAction, setInterventionFeedbackAction } from '@/lib/server-actions/interventions'
import { cn } from '@/lib/utils'

const ALL = '__all'

const STATUS_TABS = [
  { value: '', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
] as const

type Tab = (typeof STATUS_TABS)[number]['value']

const inTab = (tab: Tab) => (i: InterventionSummary) =>
  tab === 'open' ? i.status === 'assigned' || i.status === 'in_progress'
    : tab === 'overdue' ? i.overdue
      : tab === '' ? i.status !== 'cancelled'
        : i.status === tab

const distinctSorted = (values: (string | null)[]) =>
  [...new Set(values.filter((v): v is string => Boolean(v)))].sort((a, b) => a.localeCompare(b))

export function InterventionsTable({ interventions }: { interventions: InterventionSummary[] }) {
  const router = useRouter()
  const [pupilQuery, setPupilQuery] = useState('')
  const [groupId, setGroupId] = useState(ALL)
  const [subject, setSubject] = useState(ALL)
  const [tab, setTab] = useState<Tab>('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const [isDeleting, startDelete] = useTransition()
  // Optimistic feedback switches, keyed by intervention; cleared on refresh.
  const [feedbackOverrides, setFeedbackOverrides] = useState<Record<string, boolean>>({})
  const [savingFeedback, setSavingFeedback] = useState<Set<string>>(new Set())

  const setFeedback = async (id: string, visible: boolean) => {
    setFeedbackOverrides((prev) => ({ ...prev, [id]: visible }))
    setSavingFeedback((prev) => new Set(prev).add(id))
    const { error } = await setInterventionFeedbackAction(id, visible)
    setSavingFeedback((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    if (error) {
      setFeedbackOverrides((prev) => ({ ...prev, [id]: !visible }))
      toast.error(`Unable to update feedback: ${error}`)
      return
    }
    toast.success(visible ? 'Feedback on for this pupil.' : 'Feedback off for this pupil.')
  }

  const groupIds = useMemo(() => distinctSorted(interventions.map((i) => i.group_id)), [interventions])
  const subjects = useMemo(() => distinctSorted(interventions.map((i) => i.subject)), [interventions])

  // Pupil, class and subject narrow the rows; the tabs then count and cut them.
  const filtered = useMemo(() => {
    const needle = pupilQuery.trim().toLowerCase()
    return interventions.filter((i) =>
      (!needle || (i.pupil_name || i.pupil_id).toLowerCase().includes(needle)) &&
      (groupId === ALL || i.group_id === groupId) &&
      (subject === ALL || i.subject === subject))
  }, [interventions, pupilQuery, groupId, subject])
  const rows = useMemo(() => filtered.filter(inTab(tab)), [filtered, tab])

  // Only rows on screen count as selected, so a filter change can never
  // delete something the teacher can no longer see.
  const selectedRows = rows.filter((i) => selected.has(i.intervention_id))
  const allSelected = rows.length > 0 && selectedRows.length === rows.length
  const headerChecked = allSelected ? true : selectedRows.length > 0 ? 'indeterminate' : false

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  const toggleAll = (on: boolean) => setSelected(on ? new Set(rows.map((i) => i.intervention_id)) : new Set())

  const hasFilters = pupilQuery !== '' || groupId !== ALL || subject !== ALL
  const clearFilters = () => {
    setPupilQuery('')
    setGroupId(ALL)
    setSubject(ALL)
  }

  const deleteSelected = () =>
    startDelete(async () => {
      const ids = selectedRows.map((i) => i.intervention_id)
      const { data, error } = await deleteInterventionsAction(ids)
      if (error || !data) {
        toast.error(error ?? 'Unable to delete the interventions.')
        return
      }
      toast.success(`Deleted ${data.deleted} intervention${data.deleted === 1 ? '' : 's'}.`)
      setSelected(new Set())
      setConfirming(false)
      router.refresh()
    })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={pupilQuery}
          onChange={(e) => setPupilQuery(e.target.value)}
          placeholder="Search pupil name"
          aria-label="Filter by pupil name"
          className="w-56"
        />
        <Select value={groupId} onValueChange={setGroupId}>
          <SelectTrigger className="w-44" aria-label="Filter by class">
            <SelectValue placeholder="All classes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All classes</SelectItem>
            {groupIds.map((g) => (
              <SelectItem key={g} value={g}>{g}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={subject} onValueChange={setSubject}>
          <SelectTrigger className="w-44" aria-label="Filter by subject">
            <SelectValue placeholder="All subjects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All subjects</SelectItem>
            {subjects.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hasFilters && (
          <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {STATUS_TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            className={cn(
              'rounded-full border px-3 py-1 text-sm',
              t.value === tab ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted',
            )}
          >
            {t.label} <span className="tabular-nums opacity-70">{filtered.filter(inTab(t.value)).length}</span>
          </button>
        ))}
        <div className="ml-auto flex items-center gap-3">
          {selectedRows.length > 0 && (
            <span className="text-sm text-muted-foreground tabular-nums">{selectedRows.length} selected</span>
          )}
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={selectedRows.length === 0 || isDeleting}
            onClick={() => setConfirming(true)}
          >
            Delete selected
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No interventions match.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left">
              <tr>
                <th className="w-10 px-4 py-2">
                  <Checkbox
                    checked={headerChecked}
                    onCheckedChange={(v) => toggleAll(v === true)}
                    aria-label="Select all shown interventions"
                  />
                </th>
                <th className="px-4 py-2 font-medium">Pupil</th>
                <th className="px-4 py-2 font-medium">Intervention</th>
                <th className="px-4 py-2 font-medium">Set</th>
                <th className="px-4 py-2 font-medium">Due</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium">Done</th>
                <th className="px-4 py-2 text-right font-medium">Score</th>
                <th className="px-4 py-2 font-medium">Feedback</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => {
                const isSelected = selected.has(i.intervention_id)
                return (
                  <tr
                    key={i.intervention_id}
                    className={cn('border-b align-top last:border-0', isSelected && 'bg-muted/40')}
                  >
                    <td className="px-4 py-2">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={(v) => toggle(i.intervention_id, v === true)}
                        aria-label={`Select ${i.lesson_title} for ${i.pupil_name || i.pupil_id}`}
                      />
                    </td>
                    <td className="px-4 py-2">
                      <button
                        type="button"
                        onClick={() => setPupilQuery(i.pupil_name || i.pupil_id)}
                        className="text-left font-medium hover:underline"
                      >
                        {i.pupil_name || i.pupil_id}
                      </button>
                      {i.group_id && <div className="text-xs text-muted-foreground">{i.group_id}</div>}
                    </td>
                    <td className="px-4 py-2">
                      <Link href={`/lessons/${i.lesson_id}`} className="font-medium hover:underline">
                        {i.lesson_title}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {[i.subject, i.unit_title].filter(Boolean).join(' · ')}
                      </div>
                      {i.learning_objectives.length > 0 && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {i.learning_objectives.map((lo) => lo.title).join(' · ')}
                        </div>
                      )}
                      {i.reason && <div className="mt-1 text-xs italic text-muted-foreground">{i.reason}</div>}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <div className="tabular-nums">{formatDay(i.set_at)}</div>
                      {i.set_by_name && <div className="text-xs text-muted-foreground">{i.set_by_name}</div>}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap tabular-nums">{formatDay(i.due_date)}</td>
                    <td className="px-4 py-2">
                      <InterventionStatusBadge status={i.status} overdue={i.overdue} />
                      {i.completed_at && (
                        <div className="mt-1 text-xs text-muted-foreground tabular-nums">{formatDay(i.completed_at)}</div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {i.submitted_activities} / {i.scorable_activities}
                    </td>
                    <td className="px-4 py-2 text-right font-semibold tabular-nums">{formatScore(i.score)}</td>
                    <td className="px-4 py-2">
                      <Switch
                        checked={feedbackOverrides[i.intervention_id] ?? i.feedback_visible}
                        disabled={savingFeedback.has(i.intervention_id)}
                        onCheckedChange={(v) => setFeedback(i.intervention_id, v)}
                        aria-label={`Show feedback to ${i.pupil_name || i.pupil_id}`}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <AlertDialog open={confirming} onOpenChange={(open) => !isDeleting && setConfirming(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedRows.length} intervention{selectedRows.length === 1 ? '' : 's'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They will be removed from this page, the pupil report and the pupil&apos;s list, and the pupil will no
              longer be able to open them. The lessons and any work already done are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Keep them</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={(e) => {
                e.preventDefault()
                deleteSelected()
              }}
            >
              {isDeleting ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
