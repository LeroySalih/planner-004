import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import type { Queryable } from "@/lib/curriculum/unit-curriculum-guard"
import { withDbClient } from "@/lib/db"
import { authenticateApiKey, consumeApiKeyRequest } from "@/lib/oauth/api-keys"
import { ClientValidationError } from "@/lib/oauth/clients"
import { auditedErrors, ClientRequestError, recordAudit, type AuditActor } from "@/lib/oauth/client-store"

// Shared by every /api/oauth-clients route (docs/FIRST-PARTY-CLIENTS.md).
// The only credential accepted is a project API key as a Bearer token:
// cookies are ignored, so a signed-in DINO session cannot use this API and
// the API can never act as a person.
//
// 401 missing/unknown/revoked/expired key, 403 outside the key's ceiling,
// 404 a client the key does not own, 409 client_id taken, 422 invalid,
// 429 over the per-key rate limit. Bodies and the Authorization header are
// never logged.

const NO_STORE = { "Cache-Control": "no-store" }

export function json(body: object, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } })
}

const problem = (status: number, error: string, description: string, headers: Record<string, string> = {}) =>
  json({ error, error_description: description }, status, headers)

const ERROR_CODES: Record<number, string> = {
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  422: "invalid_request",
}

/** A malformed JSON body: 422, audited by withProjectKey. */
export async function readBody<T extends z.ZodTypeAny>(request: NextRequest, schema: T, optional = false): Promise<z.infer<T>> {
  const text = await request.text()
  if (!text.trim() && optional) return schema.parse({})
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new ClientRequestError(422, "The body must be JSON.")
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : ""
    throw new ClientRequestError(422, `${where}${issue?.message ?? "Invalid body."}`)
  }
  return parsed.data
}

function bearer(request: NextRequest): string | null {
  const header = request.headers.get("authorization")?.trim() ?? ""
  return /^bearer /i.test(header) ? header.slice(7).trim() || null : null
}

/**
 * Authenticates the project key, counts the request against its limit and
 * runs `fn` as that key. Every authenticated call is audited: the store
 * audits its own changes and refusals; anything refused before reaching it
 * (bad body, rate limit) is audited here.
 */
export async function withProjectKey(
  request: NextRequest,
  action: string,
  clientId: string | null,
  fn: (db: Queryable, actor: AuditActor) => Promise<Response>,
): Promise<Response> {
  try {
    return await withDbClient(async (db) => {
      const presented = bearer(request)
      const key = await authenticateApiKey(db, presented)
      if (!key) {
        return problem(401, "invalid_token", "A valid project API key is required.", {
          "WWW-Authenticate": presented ? 'Bearer realm="dino", error="invalid_token"' : 'Bearer realm="dino"',
        })
      }
      const actor: AuditActor = { kind: "api_key", key }

      if (!(await consumeApiKeyRequest(db, key.id))) {
        await recordAudit(db, actor, { action, clientId, outcome: "refused", status: 429, error: "rate limited" })
        const retryAfter = 60 - new Date().getUTCSeconds()
        return problem(429, "rate_limited", "Too many requests for this key. Try again shortly.", {
          "Retry-After": String(retryAfter),
        })
      }

      try {
        return await fn(db, actor)
      } catch (error) {
        if (error instanceof ClientRequestError || error instanceof ClientValidationError) {
          if (!auditedErrors.has(error)) {
            await recordAudit(db, actor, { action, clientId, outcome: "refused", status: error.status, error: error.message })
          }
          return problem(error.status, ERROR_CODES[error.status] ?? "invalid_request", error.message)
        }
        if (!auditedErrors.has(error as object)) {
          await recordAudit(db, actor, { action, clientId, outcome: "error", status: 500, error: "internal error" })
        }
        throw error
      }
    })
  } catch (error) {
    console.error("[oauth-clients] request failed", { action, clientId, error })
    return problem(500, "server_error", "The request failed.")
  }
}

const stringList = z.array(z.string().max(2048)).max(50)
const ttl = z.number().int().nullable()

export const CreateClientBody = z
  .object({
    client_id: z.string().max(64),
    client_name: z.string().max(100),
    client_type: z.enum(["public", "service"]).optional(),
    redirect_uris: stringList.optional(),
    roles: stringList.optional(),
    scopes: stringList.optional(),
    audience: z.string().max(64).nullable().optional(),
    allowed_audiences: stringList.optional(),
    service_scopes: stringList.optional(),
    access_ttl_seconds: ttl.optional(),
    refresh_ttl_seconds: ttl.optional(),
  })
  .strict()

export const UpdateClientBody = z
  .object({
    client_name: z.string().max(100).optional(),
    roles: stringList.optional(),
    scopes: stringList.optional(),
    allowed_audiences: stringList.optional(),
    service_scopes: stringList.optional(),
    access_ttl_seconds: ttl.optional(),
    refresh_ttl_seconds: ttl.optional(),
  })
  .strict()

export const RedirectUriBody = z.object({ uri: z.string().max(2048) }).strict()

export const RotateSecretBody = z.object({ overlap_seconds: z.number().int().optional() }).strict()

export type RouteContext = { params: Promise<{ id: string }> }
