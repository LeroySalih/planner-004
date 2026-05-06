# Stale Deployment Refresh Prompt — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user's browser has a stale JS bundle after a redeployment, intercept the "Failed to find Server Action" error and show a persistent toast prompting them to refresh — instead of silently failing.

**Architecture:** A small `"use client"` component uses `useEffect` to attach a global `unhandledrejection` listener. When the error message matches Next.js's stale-action error, it fires a persistent `sonner` toast with a "Refresh" button. The component is added to the root layout (which already has `<Toaster />`). No new dependencies needed.

**Tech Stack:** React 19, Next.js 15 App Router, sonner (already installed).

**Why `unhandledrejection`:** When a server action call fails with "Failed to find Server Action", Next.js throws the error as an unhandled promise rejection in the client. There is no existing interception point for this in the codebase.

---

## Files touched

| File | Change |
|------|--------|
| `src/components/stale-deployment-detector.tsx` | Create — client component with the rejection listener |
| `src/app/layout.tsx` | Add `<StaleDeploymentDetector />` inside the layout |

---

## Task 1: Create the detector component and wire it into the root layout

**Files:**
- Create: `src/components/stale-deployment-detector.tsx`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Create `src/components/stale-deployment-detector.tsx`**

```tsx
"use client"

import { useEffect } from "react"
import { toast } from "sonner"

/**
 * Detects when the client-side JS bundle is out of date with the server.
 *
 * After a redeployment, Next.js assigns new server action IDs. Users with
 * open tabs still hold the old bundle and send requests with stale action IDs,
 * causing "Failed to find Server Action" errors. Without interception these
 * errors are silent — the action simply never runs.
 *
 * This component attaches a global unhandledrejection listener, detects that
 * specific error, and shows a persistent toast prompting the user to refresh.
 */
export function StaleDeploymentDetector() {
  useEffect(() => {
    function handleRejection(event: PromiseRejectionEvent) {
      const message: string =
        event.reason?.message ?? event.reason?.toString() ?? ""

      if (message.includes("Failed to find Server Action")) {
        // Prevent the error from appearing in the browser console as an
        // uncaught rejection — we are handling it with the toast below.
        event.preventDefault()

        toast.error("This page has been updated.", {
          description: "Refresh to continue using the latest version.",
          duration: Infinity,
          action: {
            label: "Refresh",
            onClick: () => window.location.reload(),
          },
        })
      }
    }

    window.addEventListener("unhandledrejection", handleRejection)
    return () => window.removeEventListener("unhandledrejection", handleRejection)
  }, [])

  return null
}
```

- [ ] **Step 2: Add `<StaleDeploymentDetector />` to the root layout**

Open `src/app/layout.tsx`. Add the import and the component inside `<ThemeProvider>`, alongside the existing `<Toaster />`:

```tsx
import { StaleDeploymentDetector } from "@/components/stale-deployment-detector"
```

Place `<StaleDeploymentDetector />` directly after `<Toaster />`:

```tsx
          <Analytics />
          <Toaster />
          <StaleDeploymentDetector />
        </ThemeProvider>
```

- [ ] **Step 3: Verify lint passes**

```bash
cd /Users/leroysalih/nodejs/planner-004 && pnpm lint
```

Pre-existing ESLint config warning can be ignored. No new errors expected.

- [ ] **Step 4: Commit**

```bash
git add src/components/stale-deployment-detector.tsx src/app/layout.tsx
git commit -m "feat(ux): prompt users to refresh after stale deployment

After a redeployment, users with open tabs get 'Failed to find Server
Action' errors because their JS bundle references old action IDs. Intercepts
the unhandledrejection event and shows a persistent sonner toast with a
Refresh button instead of silently failing."
```
