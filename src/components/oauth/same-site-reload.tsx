"use client"

import { useEffect } from "react"

// The session cookie is SameSite=Strict, so it is not sent when Claude opens
// the authorize URL from claude.ai — a signed-in teacher would look signed out
// and be asked to sign in again. Reloading from our own page makes the request
// same-site, and the cookie comes with it.
//
// `flag` makes it one-shot: if the reload still arrives cross-site (a browser
// that reports Sec-Fetch-Site oddly) the page carries on instead of looping.
export function SameSiteReload({ flag }: { flag: string }) {
  useEffect(() => {
    const url = new URL(window.location.href)
    url.searchParams.set(flag, "1")
    window.location.replace(url)
  }, [flag])

  return <p className="p-12 text-center text-sm text-muted-foreground">Continuing to DINO…</p>
}
