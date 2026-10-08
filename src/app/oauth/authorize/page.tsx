import type { Metadata } from "next"
import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { ConsentButtons } from "@/components/oauth/consent-buttons"
import { SameSiteReload } from "@/components/oauth/same-site-reload"
import { getAuthenticatedProfile, hasRole } from "@/lib/auth"
import { checkAuthorizeRequest } from "@/lib/oauth/server"
import { publicOrigin } from "@/lib/public-origin"
import { OAuthAuthorizeParamsSchema } from "@/types"

// Set by SameSiteReload so the reload happens at most once. Defined here, not
// in the client module: a constant imported from "use client" is a client
// reference on the server, not the string.
const SAME_SITE_RELOAD_FLAG = "same_site_reload"

export const metadata: Metadata = {
  title: "Connect to DINO",
}

// OAuth authorization endpoint (RFC 6749 §3.1). A teacher approves an MCP
// client here; the server actions behind the buttons check everything again.
export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const query = Object.fromEntries(
    Object.entries(await searchParams).flatMap(([key, value]) => {
      const first = Array.isArray(value) ? value[0] : value
      return first ? [[key, first]] : []
    }),
  )
  const params = OAuthAuthorizeParamsSchema.safeParse(query)
  if (!params.success) {
    return <AuthorizeError message="This connection request is malformed. Try connecting again." />
  }

  const headerList = await headers()
  const check = await checkAuthorizeRequest(params.data, publicOrigin(headerList))
  if (check.status === "invalid") {
    return <AuthorizeError message={check.message} />
  }
  if (check.status === "redirect") {
    redirect(check.url)
  }

  if (headerList.get("sec-fetch-site") === "cross-site" && !query[SAME_SITE_RELOAD_FLAG]) {
    return <SameSiteReload flag={SAME_SITE_RELOAD_FLAG} />
  }

  const profile = await getAuthenticatedProfile()
  if (!profile) {
    const here = headerList.get("x-pathname") ?? `/oauth/authorize?${new URLSearchParams(query)}`
    redirect(`/signin?returnTo=${encodeURIComponent(here)}`)
  }
  if (!hasRole(profile, "teacher")) {
    return <AuthorizeError message="Only teachers can connect Claude to DINO." />
  }

  const { request } = check
  const teacherName = [profile.firstName, profile.lastName].filter(Boolean).join(" ") || profile.email
  const returnHost = new URL(request.redirectUri).host

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-6 py-16">
      <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">Connect {request.clientName} to DINO</h1>
        <p className="mt-4 text-sm text-muted-foreground">
          Signed in as <span className="font-medium text-foreground">{teacherName}</span>.
        </p>
        <p className="mt-4">
          <span className="font-medium">{request.clientName}</span> is asking for{" "}
          <span className="font-medium">full access to DINO through MCP</span>: it will be able to read and change
          curricula, units, lessons, activities and timetables as you.
        </p>
        <p className="mt-4 text-sm text-muted-foreground">
          You will be returned to <span className="font-mono">{returnHost}</span>. You can disconnect it at any time
          from your profile page.
        </p>
        <form className="mt-6">
          <input type="hidden" name="response_type" value="code" />
          <input type="hidden" name="client_id" value={request.clientId} />
          <input type="hidden" name="redirect_uri" value={request.redirectUri} />
          <input type="hidden" name="code_challenge" value={request.codeChallenge} />
          <input type="hidden" name="code_challenge_method" value="S256" />
          <input type="hidden" name="state" value={request.state ?? ""} />
          <input type="hidden" name="resource" value={request.resource ?? ""} />
          <ConsentButtons />
        </form>
      </section>
    </div>
  )
}

function AuthorizeError({ message }: { message: string }) {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-6 py-16">
      <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">Unable to connect</h1>
        <p className="mt-4">{message}</p>
      </section>
    </div>
  )
}
