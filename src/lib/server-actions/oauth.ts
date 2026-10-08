"use server"

import { revalidatePath } from "next/cache"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { z } from "zod"

import { getAuthenticatedProfile, hasRole, requireTeacherProfile } from "@/lib/auth"
import {
  callbackUrl,
  checkAuthorizeRequest,
  issueAuthorizationCode,
  revokeConnectedApp,
  type AuthorizeRequest,
} from "@/lib/oauth/server"
import { publicOrigin } from "@/lib/public-origin"
import { withTelemetry } from "@/lib/telemetry"
import { OAuthAuthorizeParamsSchema } from "@/types"

const ROUTE_TAG = "/oauth"

// The consent form posts the authorize query back. Nothing in it is trusted:
// it is checked again exactly as the page checked it.
async function recheckConsentForm(formData: FormData): Promise<AuthorizeRequest> {
  const params = OAuthAuthorizeParamsSchema.parse(
    Object.fromEntries(
      Object.keys(OAuthAuthorizeParamsSchema.shape).flatMap((key) => {
        const value = formData.get(key)
        return typeof value === "string" && value !== "" ? [[key, value]] : []
      }),
    ),
  )
  const check = await checkAuthorizeRequest(params, publicOrigin(await headers()))
  if (check.status === "redirect") redirect(check.url)
  if (check.status === "invalid") throw new Error(check.message)
  return check.request
}

export async function approveOAuthAuthorizationAction(formData: FormData): Promise<void> {
  const request = await recheckConsentForm(formData)
  const profile = await getAuthenticatedProfile()
  if (!profile || !hasRole(profile, "teacher")) {
    throw new Error("Only teachers can connect Claude to DINO.")
  }

  const destination = await withTelemetry(
    { routeTag: ROUTE_TAG, functionName: "approveOAuthAuthorizationAction", params: { clientId: request.clientId } },
    () => issueAuthorizationCode(request, profile.userId),
  )
  redirect(destination)
}

export async function denyOAuthAuthorizationAction(formData: FormData): Promise<void> {
  const request = await recheckConsentForm(formData)
  redirect(callbackUrl(request.redirectUri, { error: "access_denied", state: request.state }))
}

const RevokeConnectedAppInputSchema = z.object({ tokenId: z.string().uuid() })

export async function revokeConnectedAppAction(tokenId: string) {
  const profile = await requireTeacherProfile()
  const parsed = RevokeConnectedAppInputSchema.safeParse({ tokenId })
  if (!parsed.success) {
    return { data: null, error: "Unknown connection." }
  }

  return withTelemetry(
    { routeTag: ROUTE_TAG, functionName: "revokeConnectedAppAction", params: parsed.data },
    async () => {
      try {
        const revoked = await revokeConnectedApp(profile.userId, parsed.data.tokenId)
        if (!revoked) return { data: null, error: "That connection was already removed." }
        revalidatePath(`/profiles/${profile.userId}`)
        return { data: { revoked: true }, error: null }
      } catch (error) {
        console.error("[oauth] Failed to revoke connected app", error)
        return { data: null, error: "Unable to disconnect that app." }
      }
    },
  )
}
