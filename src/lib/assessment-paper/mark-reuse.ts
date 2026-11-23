import "server-only"

import { createHash } from "node:crypto"

import { query } from "@/lib/db"
import type { Queryable } from "@/lib/curriculum/unit-curriculum-guard"
import type { ModelPart } from "@/lib/ai/model-client"
import type { MarkReplyRow } from "@/lib/assessment-paper/marking"
import type { AiEffort, AiProvider } from "@/types"

// Do not pay twice for the same mark request (migration 151). Every
// question-marked type's marker (assessment paper, PowerPoint and database
// assessment) fingerprints its mark request just before the model call. When
// the submission and question already have an answered request with the same
// fingerprint, the stored result is applied through the same path as a fresh
// reply, and the model is not called.
//
// The fingerprint is over everything the model is sent and everything that
// decides how its reply is checked: provider, model, effort, system text,
// response schema, output token ceiling, every part in order (text verbatim;
// an attachment by its mime type and the sha256 of its bytes), the criteria
// ids with their allocations, and MARK_REUSE_VERSION. So a changed mark
// scheme, question text, criterion, allocation, evidence (report text,
// screenshots, script pages, transcription, an earlier answer), model or
// route, or system prompt makes a fresh call.
//
// The stored row is written by completeAssessmentQuestionMark inside the
// transaction that applies the result (a failed apply stores nothing), and is
// kept through re-marks; remark_assessment_activity with `force` deletes it.

/**
 * Bump when a code change to how a mark reply is checked or applied should
 * stop stored answers being reused: every stored fingerprint then differs.
 */
export const MARK_REUSE_VERSION = 1

/** What is stored to apply a mark again exactly as the marker returned it. */
export interface StoredMarkResult {
  rows: MarkReplyRow[]
  /** The practical marker's teacher-only note; null on an assessment paper. */
  evidenceNote: string | null
  /** The practical marker held the part for the teacher with this reason; null when not. */
  hold: string | null
}

/** A stored answer to put back, and what to store after a fresh one. */
export interface MarkRequestRecord {
  questionId: string
  requestHash: string
  model: string
  result: StoredMarkResult
}

/** The request as the marker is about to send it. */
export interface MarkRequestFingerprintInput {
  provider: AiProvider
  model: string
  effort: AiEffort | null
  systemText: string
  responseSchema: unknown
  maxTokens: number | null
  parts: ModelPart[]
  criteria: Array<{ successCriteriaId: string; allocation: number }>
}

/** JSON with object keys sorted, so the fingerprint does not depend on key order. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`
  }
  return JSON.stringify(value ?? null)
}

function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex")
}

/** The sha256 fingerprint of one mark request (see the top of this file). */
export function markRequestHash(input: MarkRequestFingerprintInput): string {
  const parts = input.parts.map((part) => {
    if (part.inline_data) {
      return {
        mimeType: part.inline_data.mime_type,
        sha256: sha256(Buffer.from(part.inline_data.data, "base64")),
      }
    }
    return { text: part.text ?? "" }
  })
  return sha256(
    canonicalJson({
      version: MARK_REUSE_VERSION,
      provider: input.provider,
      model: input.model,
      effort: input.effort ?? null,
      system: input.systemText,
      responseSchema: input.responseSchema,
      maxTokens: input.maxTokens ?? null,
      parts,
      criteria: input.criteria.map((c) => ({ id: c.successCriteriaId, allocation: c.allocation })),
    }),
  )
}

function parseStored(result: unknown): StoredMarkResult | null {
  const r = result as Partial<StoredMarkResult> | null
  if (!r || !Array.isArray(r.rows)) return null
  return {
    rows: r.rows,
    evidenceNote: typeof r.evidenceNote === "string" ? r.evidenceNote : null,
    hold: typeof r.hold === "string" && r.hold.trim() ? r.hold : null,
  }
}

/** The stored answer for this submission and question when its fingerprint is `requestHash`; else null. */
export async function readReusableMark(
  submissionId: string,
  questionId: string,
  requestHash: string,
): Promise<StoredMarkResult | null> {
  const { rows } = await query<{ result: unknown }>(
    `select result from submission_question_mark_requests
      where submission_id = $1 and question_id = $2::uuid and request_hash = $3`,
    [submissionId, questionId, requestHash],
  )
  return rows[0] ? parseStored(rows[0].result) : null
}

/**
 * A stored answer in the shape of the model's reply, so it goes through the
 * same checks (validateMarkReply, the hold rule, the output guard) as a fresh
 * one.
 */
export function storedResultAsReply(result: StoredMarkResult): Record<string, unknown> {
  return {
    ...(result.evidenceNote !== null ? { evidence_note: result.evidenceNote } : {}),
    criteria: result.rows.map((row) => ({
      success_criteria_id: row.successCriteriaId,
      awarded: row.awarded,
      why_not_awarded: row.whyNotAwarded,
      how_to_improve: row.howToImprove,
    })),
    ...(result.hold !== null ? { hold_for_teacher: { reason: result.hold } } : {}),
  }
}

/** Keep the latest answered request of a submission's question (inside the apply's transaction). */
export async function storeMarkRequest(db: Queryable, submissionId: string, record: MarkRequestRecord): Promise<void> {
  await db.query(
    `insert into submission_question_mark_requests (submission_id, question_id, request_hash, model, result)
     values ($1, $2::uuid, $3, $4, $5::jsonb)
     on conflict (submission_id, question_id) do update
       set request_hash = excluded.request_hash, model = excluded.model,
           result = excluded.result, created_at = now()`,
    [submissionId, record.questionId, record.requestHash, record.model, JSON.stringify(record.result)],
  )
}

/**
 * Forget the stored answers of these submissions (only `questionIds`' when
 * given), so their next mark calls the model (remark_assessment_activity
 * `force`). Returns how many were forgotten.
 */
export async function forgetStoredMarks(submissionIds: string[], questionIds: string[] | null): Promise<number> {
  if (submissionIds.length === 0) return 0
  const { rowCount } = await query(
    `delete from submission_question_mark_requests
      where submission_id = any($1::text[])
        and ($2::text[] is null or question_id::text = any($2::text[]))`,
    [submissionIds, questionIds],
  )
  return rowCount ?? 0
}
