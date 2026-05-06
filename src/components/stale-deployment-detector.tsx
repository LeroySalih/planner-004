"use client"

import { useEffect, useRef } from "react"
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
 * The toast is shown at most once — subsequent stale rejections are suppressed
 * so rapid button-clicks don't stack duplicate toasts.
 */
export function StaleDeploymentDetector() {
  const hasShown = useRef(false)

  useEffect(() => {
    function handleRejection(event: PromiseRejectionEvent) {
      const message: string =
        event.reason?.message ?? event.reason?.toString() ?? ""

      if (message.includes("Failed to find Server Action")) {
        // Prevent the error appearing in the browser console as an uncaught
        // rejection regardless of whether we show the toast again.
        event.preventDefault()

        if (hasShown.current) return

        hasShown.current = true
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
