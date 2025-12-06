import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

import { getProfileFromSessionCookie } from "@/lib/auth"
import { logPupilSignIn } from "@/lib/server-actions/pupil-sign-ins"

const PUPIL_SESSION_COOKIE = "planner_session"
const HTML_ACCEPT_HEADER = "text/html"
const PAGE_SKIP_PREFIXES = [
  "/_next",
  "/api",
  "/static",
  "/assets",
  "/_vercel",
  "/.well-known",
]

function shouldSkipPath(pathname: string) {
  if (PAGE_SKIP_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return true
  }

  const staticFiles = ["/favicon.ico", "/robots.txt", "/manifest.json", "/sitemap.xml"]
  if (staticFiles.includes(pathname)) {
    return true
  }

  return /\.[a-z0-9]+$/i.test(pathname)
}

function isHtmlPageRequest(request: NextRequest) {
  if (request.method !== "GET") {
    return false
  }

  const accept = request.headers.get("accept") ?? ""
  if (!accept.toLowerCase().includes(HTML_ACCEPT_HEADER)) {
    return false
  }

  const pathname = request.nextUrl.pathname
  if (shouldSkipPath(pathname)) {
    return false
  }

  return true
}

export async function middleware(request: NextRequest) {
  if (!isHtmlPageRequest(request)) {
    return NextResponse.next()
  }

  const sessionCookie = request.cookies.get(PUPIL_SESSION_COOKIE)?.value ?? null
  if (!sessionCookie) {
    return NextResponse.next()
  }

  const profile = await getProfileFromSessionCookie(sessionCookie)
  if (!profile || profile.isTeacher) {
    return NextResponse.next()
  }

  try {
    await logPupilSignIn({
      pupilId: profile.userId,
      url: request.nextUrl.href,
      signedInAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error("[middleware] failed to log pupil sign-in", error)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next|api|static|_vercel).*)"],
  runtime: "nodejs",
}
