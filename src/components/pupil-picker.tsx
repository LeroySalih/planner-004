"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { Eye, Loader2 } from "lucide-react"

import type { PupilPickerData } from "@/lib/pupil-picker"

export type PupilPickerProps = PupilPickerData & {
  /** The page to open for the chosen pupil, e.g. "/pupil-lessons" or "/my-assessments". */
  basePath: string
  /** "path" puts the pupil id in the URL path (My Units); "query" uses ?pupil=. */
  pupilIn: "path" | "query"
}

/**
 * Admin only: pick a class, then a pupil in it, to see a pupil-facing page
 * exactly as that pupil does. The class travels in ?group= so the pupil list
 * survives the navigation.
 */
export function PupilPicker({ groups, groupId, pupils, pupilId, basePath, pupilIn }: PupilPickerProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const go = (nextPupilId: string, nextGroupId: string | null) => {
    const params = new URLSearchParams()
    if (pupilIn === "query") params.set("pupil", nextPupilId)
    if (nextGroupId) params.set("group", nextGroupId)
    const path = pupilIn === "path" ? `${basePath}/${encodeURIComponent(nextPupilId)}` : basePath
    const search = params.toString()
    startTransition(() => router.push(search ? `${path}?${search}` : path))
  }

  const selectClass =
    "h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-4 py-3 text-sm">
      <span className="flex items-center gap-1.5 font-medium text-muted-foreground">
        <Eye className="size-4" /> View as pupil
      </span>
      <label className="sr-only" htmlFor="pupil-picker-group">Class</label>
      <select
        id="pupil-picker-group"
        className={selectClass}
        value={groupId ?? ""}
        disabled={pending}
        onChange={(event) => go(pupilId, event.target.value || null)}
      >
        <option value="" disabled>Choose a class</option>
        {groups.map((group) => (
          <option key={group.groupId} value={group.groupId}>
            {group.groupId}{group.subject ? ` · ${group.subject}` : ""}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor="pupil-picker-pupil">Pupil</label>
      <select
        id="pupil-picker-pupil"
        className={selectClass}
        value={pupils.some((pupil) => pupil.pupilId === pupilId) ? pupilId : ""}
        disabled={pending || !groupId || pupils.length === 0}
        onChange={(event) => event.target.value && go(event.target.value, groupId)}
      >
        <option value="" disabled>
          {!groupId ? "Choose a class first" : pupils.length === 0 ? "No pupils in this class" : "Choose a pupil"}
        </option>
        {pupils.map((pupil) => (
          <option key={pupil.pupilId} value={pupil.pupilId}>{pupil.name}</option>
        ))}
      </select>
      {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
    </div>
  )
}
