"use client"

import { useEffect, useState } from "react"

export function CookieChecker({ isSessionCookieReadable }: { isSessionCookieReadable: boolean }) {
  const [cookiesEnabled, setCookiesEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    const enabled = typeof navigator !== "undefined" && navigator.cookieEnabled
    setCookiesEnabled(enabled)
  }, [])

  let cookiesStatusText = ""
  let cookiesStatusColorClass = "bg-muted-foreground"

  if (cookiesEnabled === null) {
    cookiesStatusText = "Checking..."
    cookiesStatusColorClass = "bg-yellow-500"
  } else if (cookiesEnabled) {
    cookiesStatusText = "Enabled"
    cookiesStatusColorClass = "bg-emerald-500"
  } else {
    cookiesStatusText = "Disabled"
    cookiesStatusColorClass = "bg-destructive"
  }

  const sessionStatusText = isSessionCookieReadable ? "Readable" : "Not Readable or Absent"
  const sessionStatusColorClass = isSessionCookieReadable ? "bg-emerald-500" : "bg-destructive"

  return (
    <div className="mt-4 w-full max-w-md rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Cookies Enabled</p>
          <p className="text-base font-semibold">{cookiesStatusText}</p>
        </div>
        <span
          className={`h-3 w-3 rounded-full ${cookiesStatusColorClass}`}
          aria-hidden
        />
      </div>
      {cookiesEnabled === false && (
        <p className="mt-3 text-sm text-destructive">
          Cookies are required for authentication. Please enable them in your browser settings.
        </p>
      )}

      <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Session Cookie</p>
          <p className="text-base font-semibold">{sessionStatusText}</p>
        </div>
        <span
          className={`h-3 w-3 rounded-full ${sessionStatusColorClass}`}
          aria-hidden
        />
      </div>
      {!isSessionCookieReadable && cookiesEnabled && (
        <p className="mt-3 text-sm text-amber-500">
          The session cookie is not present or malformed. You might need to sign in.
        </p>
      )}
    </div>
  )
}

