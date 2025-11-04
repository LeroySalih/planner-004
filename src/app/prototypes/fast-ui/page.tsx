import type { Metadata } from "next"

import { requireTeacherProfile } from "@/lib/auth"
import { FAST_UI_INITIAL_STATE, triggerFastUiUpdateAction } from "@/lib/server-updates"

import { FastUiPanel } from "@/components/prototypes/fast-ui/fast-ui-panel"

export const metadata: Metadata = {
  title: "Fast UI Prototype",
}

export default async function FastUiPrototypePage() {
  await requireTeacherProfile()

  return (
    <main className="container mx-auto max-w-3xl space-y-8 py-10">
      <header className="space-y-2">
        <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Prototype</p>
        <h1 className="text-3xl font-semibold text-foreground">Fast UI async counter</h1>
        <p className="text-sm text-muted-foreground">
          Trigger server work that finishes in the background while realtime updates keep the UI in sync.
        </p>
      </header>

      <FastUiPanel action={triggerFastUiUpdateAction} initialState={FAST_UI_INITIAL_STATE} />
    </main>
  )
}
