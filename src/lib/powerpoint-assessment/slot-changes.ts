import "server-only"

import type { Queryable } from "@/lib/curriculum/unit-curriculum-guard"
import { validateQuestionEvidence } from "@/lib/powerpoint-assessment/evidence-spec"

// A PowerPoint assessment's upload slots changed by a body save (the lesson
// editor or MCP update_activity). The questions' evidence names the slots, so
// a slot it reads cannot be removed or change kind under it. One key removed
// and one of the same kind added is a rename, carried into the questions'
// evidence, the pupils' files, what was read from them and open upload links.
// A save that leaves the slots as they were (a title or the instructions) is
// not checked against the evidence at all.

/**
 * A slot renamed between two bodies: exactly one key gone and exactly one key
 * new, of the same kind. Null for anything else.
 */
export function slotRename(before: unknown, after: unknown): { from: string; to: string } | null {
  const slots = (body: unknown) => {
    const list = (body as { uploadSlots?: unknown } | null)?.uploadSlots
    return Array.isArray(list)
      ? new Map(list.filter((slot) => slot && typeof slot === "object").map((slot) => [String(slot.key), String(slot.kind)]))
      : new Map<string, string>()
  }
  const old = slots(before)
  const next = slots(after)
  const removed = [...old.keys()].filter((key) => !next.has(key))
  const added = [...next.keys()].filter((key) => !old.has(key))
  if (removed.length !== 1 || added.length !== 1 || old.get(removed[0]) !== next.get(added[0])) return null
  return { from: removed[0], to: added[0] }
}

/** JSON with every object's keys sorted: a stored (jsonb) body's keys come back in another order. */
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

/** The body's upload slots, for telling whether a save changed them. */
function slotsText(body: unknown): string {
  return canonicalJson((body as { uploadSlots?: unknown } | null)?.uploadSlots ?? null)
}

/**
 * Apply a slot change inside the caller's transaction (with the activity row
 * locked): carry a rename (when `rename` is allowed) into the questions'
 * evidence, the pupils' files and upload links, then check every stored
 * question's evidence against the new body. Returns the problems, empty when
 * the new slots fit; the caller refuses the save (and rolls back) when not.
 * When the slots are unchanged there is nothing to carry or check: a problem
 * already in the stored evidence never blocks saving the title or the
 * instructions.
 */
export async function applyUploadSlotChange(
  client: Queryable,
  activityId: string,
  before: unknown,
  after: unknown,
  options: { rename: boolean },
): Promise<{ errors: string[]; rename: { from: string; to: string } | null }> {
  if (slotsText(before) === slotsText(after)) return { errors: [], rename: null }
  const rename = options.rename ? slotRename(before, after) : null
  if (rename) {
    await client.query(
      `update activity_questions q
          set evidence = (select jsonb_agg(case when e->>'slot' = $2 then jsonb_set(e, '{slot}', to_jsonb($3::text)) else e end
                                           order by n)
                            from jsonb_array_elements(q.evidence) with ordinality as x(e, n)),
              updated_at = timezone('utc', now())
        where q.activity_id = $1
          and exists (select 1 from jsonb_array_elements(q.evidence) e where e->>'slot' = $2)`,
      [activityId, rename.from, rename.to],
    )
    await client.query("update practical_submission_files set slot_key = $3 where activity_id = $1 and slot_key = $2", [
      activityId,
      rename.from,
      rename.to,
    ])
    await client.query(
      `update practical_submission_evidence e set slot_key = $3
         from practical_submission_files f
        where f.file_id = e.file_id and f.activity_id = $1 and e.slot_key = $2`,
      [activityId, rename.from, rename.to],
    )
    await client.query("update mcp_upload_links set slot_key = $3 where activity_id = $1 and slot_key = $2", [
      activityId,
      rename.from,
      rename.to,
    ])
  }
  const { rows: questions } = await client.query<{ label: string; marking: string; evidence: unknown }>(
    "select label, marking, evidence from activity_questions where activity_id = $1 order by position, label",
    [activityId],
  )
  const { errors } = validateQuestionEvidence(questions, after)
  return { errors, rename }
}
