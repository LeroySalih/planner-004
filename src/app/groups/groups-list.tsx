"use client"

import Link from "next/link"
import { Pencil } from "lucide-react"

import type { Group } from "@/types"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type GroupsListProps = {
  groups: Group[]
  onEdit: (group: Group) => void
  onJoinCodeClick: (code: string | null) => void
}

export function GroupsList({ groups, onEdit, onJoinCodeClick }: GroupsListProps) {
  return (
    <section className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {groups.map((group) => (
        <Card key={group.group_id} className="overflow-hidden border-slate-200 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-slate-100 bg-slate-50/80 py-3">
            <CardTitle className="text-base font-semibold text-slate-900">{group.group_id}</CardTitle>
            <Button
              size="icon"
              variant="outline"
              className="h-8 w-8 border-slate-200"
              onClick={() => onEdit(group)}
              aria-label={`Edit ${group.group_id}`}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-3 py-4">
            <div className="space-y-1">
              <p className="text-sm font-medium text-slate-700">Subject</p>
              <p className="text-sm text-slate-800">{group.subject ?? "Untitled"}</p>
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-slate-700">Join code</p>
              <Button
                type="button"
                variant="outline"
                className="w-fit border-slate-200 bg-white px-3 py-1 text-sm font-mono"
                onClick={() => onJoinCodeClick(group.join_code ?? null)}
              >
                {group.join_code ?? "—"}
              </Button>
            </div>
            <div className="flex items-center justify-between pt-2">
              <Link href={`/groups/${encodeURIComponent(group.group_id)}`} className="text-sm font-medium text-blue-600">
                View group →
              </Link>
            </div>
          </CardContent>
        </Card>
      ))}
    </section>
  )
}
