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
