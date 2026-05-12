"use server"

import { randomUUID } from "node:crypto"
import { promises as fs } from "node:fs"
import { performance } from "node:perf_hooks"
import path from "node:path"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { UnitSchema, UnitsSchema, UnitJobPayloadSchema, UnitMutationStateSchema } from "@/types"
import { requireTeacherProfile, type AuthenticatedProfile } from "@/lib/auth"
import { query, withDbClient } from "@/lib/db"
import { emitUnitEvent } from "@/lib/sse/topics"
import { withTelemetry } from "@/lib/telemetry"
import { incrementUnitTitle } from "@/lib/unit-version"

const UnitsReturnValue = z.object({
  data: UnitsSchema.nullable(),
  error: z.string().nullable(),
})

const UnitReturnValue = z.object({
  data: UnitSchema.nullable(),
  error: z.string().nullable(),
})

const UNIT_ROUTE_TAG = "/units/[unitId]"
const UNIT_UPDATE_EVENT = "unit:update"
const UNIT_DEACTIVATE_EVENT = "unit:deactivate"

const UnitUpdateFormSchema = z.object({
  unitId: z.string(),
  title: z.string(),
  subject: z.string(),
  description: z.string().optional(),
  year: z.string().optional(),
})

const UnitDeactivateFormSchema = z.object({
  unitId: z.string(),
})

const DuplicateUnitReturnValue = z.object({
  data: z
    .object({
      newUnitId: z.string(),
      fileWarnings: z.array(z.string()),
    })
    .nullable(),
  error: z.string().nullable(),
})

async function revalidateUnitPaths(unitId: string) {
  void unitId
}

async function publishUnitJobEvent(event: string, payloadInput: z.input<typeof UnitJobPayloadSchema>) {
  const payload = UnitJobPayloadSchema.parse(payloadInput)
  await emitUnitEvent(event, payload)
  console.info("[units] published unit job event", { event, jobId: payload.job_id, unitId: payload.unit_id })
}

type UnitUpdateJobArgs = {
  jobId: string
  unitId: string
  updates: {
    title: string
    subject: string
    description: string | null
    year: number | null
  }
}

async function runUnitUpdateJob({ jobId, unitId, updates }: UnitUpdateJobArgs) {
  try {
    let updatedUnit: Record<string, unknown> | null = null
    await withDbClient(async (client) => {
      const payload: Record<string, unknown> = {
        title: updates.title,
        subject: updates.subject,
        description: updates.description,
      }

      if (updates.year !== undefined) {
        payload.year = updates.year
      }

      const { rows } = await client.query(
        `
          update units
          set title = $1, subject = $2, description = $3, year = $4
          where unit_id = $5
          returning unit_id, title, subject, description, active, year
        `,
        [payload.title, payload.subject, payload.description, payload.year ?? null, unitId],
      )

      updatedUnit = rows[0] ?? null
    })

    await revalidateUnitPaths(unitId)
    await publishUnitJobEvent(UNIT_UPDATE_EVENT, {
      job_id: jobId,
      unit_id: unitId,
      status: "completed",
      operation: "update",
      message: "Unit updated successfully",
      unit: updatedUnit,
    })
  } catch (error) {
    const message =
      error && typeof error === "object" && "message" in error
        ? String((error as { message?: string }).message ?? "Failed to update unit")
        : "Failed to update unit"
    console.error("[units] async update job failed", { unitId, jobId, error })

    try {
      await publishUnitJobEvent(UNIT_UPDATE_EVENT, {
        job_id: jobId,
        unit_id: unitId,
        status: "error",
        operation: "update",
        message,
        unit: null,
      })
    } catch (notifyError) {
      console.error("[units] failed to publish update error event", { jobId, notifyError })
    }
  }
}

type UnitDeactivateJobArgs = {
  jobId: string
  unitId: string
}

async function runUnitDeactivateJob({ jobId, unitId }: UnitDeactivateJobArgs) {
  try {
    await query("update units set active = false where unit_id = $1", [unitId])

    await revalidateUnitPaths(unitId)
    await publishUnitJobEvent(UNIT_DEACTIVATE_EVENT, {
      job_id: jobId,
      unit_id: unitId,
      status: "completed",
      operation: "deactivate",
      message: "Unit deactivated successfully",
      unit: null,
    })
  } catch (error) {
    const message =
      error && typeof error === "object" && "message" in error
        ? String((error as { message?: string }).message ?? "Failed to deactivate unit")
        : "Failed to deactivate unit"
    console.error("[units] async deactivate job failed", { unitId, jobId, error })

    try {
      await publishUnitJobEvent(UNIT_DEACTIVATE_EVENT, {
        job_id: jobId,
        unit_id: unitId,
        status: "error",
        operation: "deactivate",
        message,
        unit: null,
      })
    } catch (notifyError) {
      console.error("[units] failed to publish deactivate error event", { jobId, notifyError })
    }
  }
}

export async function createUnitAction(
  unitId: string,
  title: string,
  subject: string,
  description: string | null = null,
  year: number | null = null,
) {
  console.log("[v0] Server action started for unit creation:", { unitId, title, subject, year })

  const sanitizedYear =
    typeof year === "number" && Number.isFinite(year)
      ? Math.min(Math.max(Math.trunc(year), 1), 13)
      : null

  let attempt = 0
  let finalUnitId = unitId
  let lastError: { message: string } | null = null

  while (attempt < 5) {
    try {
      const { rows } = await query(
        `
          insert into units (unit_id, title, subject, description, year, active)
          values ($1, $2, $3, $4, $5, true)
          returning unit_id, title, subject, description, active, year
        `,
        [finalUnitId, title, subject, description, sanitizedYear],
      )

      const data = rows[0] ?? null
      console.log("[v0] Server action completed for unit creation:", {
        unitId: finalUnitId,
        title,
        subject,
        year: sanitizedYear,
      })

      revalidatePath("/")
      revalidatePath("/units")
      revalidatePath("/assignments")
      return UnitReturnValue.parse({ data, error: null })
    } catch (error) {
      const pgError = error as { code?: string; message?: string }
      lastError = { message: pgError.message ?? "Unable to create unit" }

      if (pgError.code === "23505" && pgError.message?.includes("units_pkey")) {
        attempt += 1
        finalUnitId = `${unitId}-${Date.now()}-${attempt}`
        console.warn("[v0] Duplicate unit_id detected, retrying with suffix", { attempt, finalUnitId })
        continue
      }

      console.error("[v0] Server action failed for unit creation:", error)
      return UnitReturnValue.parse({ data: null, error: pgError.message ?? "Unable to create unit" })
    }
  }

  console.error("[v0] Server action failed for unit creation after retries:", lastError)
  return UnitReturnValue.parse({ data: null, error: lastError?.message ?? "Unable to create unit" })
}

export async function readUnitAction(
  unitId: string,
  options?: { authEndTime?: number | null; routeTag?: string; currentProfile?: AuthenticatedProfile | null },
) {
  const routeTag = options?.routeTag ?? "/units:readUnit"

  return withTelemetry(
    {
      routeTag,
      functionName: "readUnitAction",
      params: { unitId },
      authEndTime: options?.authEndTime ?? null,
    },
    async () => {
      console.log("[v0] Server action started for reading unit:", { unitId })

      const profile = options?.currentProfile ?? (await requireTeacherProfile())
      if (!profile.isTeacher) {
        return UnitReturnValue.parse({ data: null, error: "You do not have permission to view units." })
      }

      try {
        const { rows } = await query(
          "select unit_id, title, subject, description, active, year from units where unit_id = $1 limit 1",
          [unitId],
        )
        const row = rows[0] ?? null

        if (!row) {
          return UnitReturnValue.parse({ data: null, error: "Unit not found." })
        }

        console.log("[v0] Server action completed for reading unit:", { unitId })

        return UnitReturnValue.parse({ data: row, error: null })
      } catch (error) {
        console.error("[v0] Server action failed for reading unit:", error)
        const message = error instanceof Error ? error.message : "Unable to load unit."
        return UnitReturnValue.parse({ data: null, error: message })
      }
    },
  )
}

export async function readUnitsAction(options?: {
  authEndTime?: number | null
  routeTag?: string
  currentProfile?: AuthenticatedProfile | null
  filter?: string | null
  subject?: string | null
  includeInactive?: boolean
}) {
  const routeTag = options?.routeTag ?? "/units:readUnits"

  const profile = options?.currentProfile ?? (await requireTeacherProfile())
  if (!profile.isTeacher) {
    return UnitsReturnValue.parse({ data: null, error: "You do not have permission to view units." })
  }

  return withTelemetry(
    {
      routeTag,
      functionName: "readUnitsAction",
      params: {
        filter: options?.filter ?? null,
        subject: options?.subject ?? null,
        includeInactive: options?.includeInactive ?? false,
      },
      authEndTime: options?.authEndTime ?? null,
    },
    async () => {
      console.log("[v0] Server action started for reading units:")

      let error: string | null = null

      try {
        const filters: string[] = []
        const values: unknown[] = []

        if (!options?.includeInactive) {
          filters.push("active = true")
        }

        if (options?.filter && options.filter.trim().length > 0) {
          const pattern = `%${options.filter.trim().replace(/\?/g, "%")}%`
          values.push(pattern)
          const idx = values.length
          filters.push(`(unit_id ILIKE $${idx} OR title ILIKE $${idx} OR subject ILIKE $${idx})`)
        }

        if (options?.subject && options.subject.trim().length > 0) {
          values.push(options.subject.trim())
          filters.push(`subject = $${values.length}`)
        }

        const whereClause = filters.length > 0 ? `where ${filters.join(" AND ")}` : ""
        const sql = `
          select unit_id, title, subject, description, active, year
          from units
          ${whereClause}
          order by title asc, unit_id asc;
        `
        const { rows } = await query(sql, values)
        const data = rows ?? []

        console.log("[v0] Server action completed for reading units:", error)
        return UnitsReturnValue.parse({ data, error: null })
      } catch (queryError) {
        error = queryError instanceof Error ? queryError.message : "Unable to load units."
        console.error("[v0] Failed to read units via direct PG client", queryError)
        return UnitsReturnValue.parse({ data: null, error })
      }
    },
  )
}

export async function updateUnitAction(
  unitId: string,
  updates: { title: string; subject: string; description?: string | null; active?: boolean; year?: number | null },
) {
  console.log("[v0] Server action started for unit update:", { unitId, updates })

  const payload: Record<string, unknown> = {
    title: updates.title,
    subject: updates.subject,
    description: updates.description ?? null,
  }

  if (Object.prototype.hasOwnProperty.call(updates, "year")) {
    payload.year = typeof updates.year === "number" ? updates.year : null
  }

  if (typeof updates.active === "boolean") {
    payload.active = updates.active
  }

  try {
    const { rows } = await query(
      `
        update units
        set title = $1, subject = $2, description = $3, active = coalesce($4, active), year = $5
        where unit_id = $6
        returning unit_id, title, subject, description, active, year
      `,
      [
        payload.title,
        payload.subject,
        payload.description,
        typeof payload.active === "boolean" ? payload.active : null,
        payload.year ?? null,
        unitId,
      ],
    )

    const data = rows[0] ?? null

    if (!data) {
      return UnitReturnValue.parse({ data: null, error: "Unit not found." })
    }

    console.log("[v0] Server action completed for unit update:", { unitId })

    revalidatePath("/")
    revalidatePath("/units")
    revalidatePath("/assignments")
    revalidatePath(`/units/${unitId}`)
    return UnitReturnValue.parse({ data, error: null })
  } catch (error) {
    console.error("[v0] Server action failed for unit update:", error)
    const message = error instanceof Error ? error.message : "Unable to update unit."
    return UnitReturnValue.parse({ data: null, error: message })
  }
}

export async function deleteUnitAction(unitId: string) {
  console.log("[v0] Server action started for unit deletion:", { unitId })

  try {
    await query("update units set active = false where unit_id = $1", [unitId])
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to delete unit."
    console.error("[v0] Server action failed for unit deletion:", error)
    return { success: false, error: message }
  }

  console.log("[v0] Server action completed for unit deletion:", { unitId })

  revalidatePath("/")
  revalidatePath("/units")
  revalidatePath("/assignments")
  revalidatePath(`/units/${unitId}`)
  return { success: true, unitId }
}

export async function triggerUnitUpdateJobAction(
  _prevState: z.infer<typeof UnitMutationStateSchema>,
  formData: FormData,
) {
  const profile = await requireTeacherProfile()
  const authEnd = performance.now()

  const unitIdValue = formData.get("unitId")
  const formUnitId = typeof unitIdValue === "string" ? unitIdValue : ""
  const paramsUnitId = formUnitId.trim().length > 0 ? formUnitId.trim() : null

  return withTelemetry(
    {
      routeTag: UNIT_ROUTE_TAG,
      functionName: "triggerUnitUpdateJobAction",
      params: { unitId: paramsUnitId },
      authEndTime: authEnd,
    },
    async () => {
      const parsedForm = UnitUpdateFormSchema.safeParse({
        unitId: formUnitId,
        title: typeof formData.get("title") === "string" ? formData.get("title") ?? "" : "",
        subject: typeof formData.get("subject") === "string" ? formData.get("subject") ?? "" : "",
        description: typeof formData.get("description") === "string" ? formData.get("description") ?? "" : "",
        year: typeof formData.get("year") === "string" ? formData.get("year") ?? "" : "",
      })

      if (!parsedForm.success) {
        console.warn("[units] invalid form submission for unit update", {
          issues: parsedForm.error.issues,
        })
        return UnitMutationStateSchema.parse({
          status: "error",
          jobId: null,
          message: "Invalid unit data submitted.",
        })
      }

      const trimmedUnitId = parsedForm.data.unitId.trim()
      const trimmedTitle = parsedForm.data.title.trim()
      const trimmedSubject = parsedForm.data.subject.trim()
      const descriptionValue = (parsedForm.data.description ?? "").trim()
      const sanitizedDescription = descriptionValue.length > 0 ? descriptionValue : null
      const trimmedYear = (parsedForm.data.year ?? "").trim()

      if (!trimmedUnitId || !trimmedTitle || !trimmedSubject) {
        return UnitMutationStateSchema.parse({
          status: "error",
          jobId: null,
          message: "Unit id, title, and subject are required.",
        })
      }

      let parsedYear: number | null = null
      if (trimmedYear.length > 0) {
        const numericYear = Number.parseInt(trimmedYear, 10)
        if (!Number.isFinite(numericYear) || numericYear < 1 || numericYear > 13) {
          return UnitMutationStateSchema.parse({
            status: "error",
            jobId: null,
            message: "Year must be a number between 1 and 13.",
          })
        }
        parsedYear = numericYear
      }

      const jobId = randomUUID()

      queueMicrotask(() => {
        void runUnitUpdateJob({
          jobId,
          unitId: trimmedUnitId,
          updates: {
            title: trimmedTitle,
            subject: trimmedSubject,
            description: sanitizedDescription,
            year: parsedYear,
          },
        })
      })

      console.info("[units] queued unit update job", {
        jobId,
        unitId: trimmedUnitId,
        userId: profile.userId,
      })

      return UnitMutationStateSchema.parse({
        status: "queued",
        jobId,
        message: "Unit update queued.",
      })
    },
  )
}

export async function triggerUnitDeactivateJobAction(
  _prevState: z.infer<typeof UnitMutationStateSchema>,
  formData: FormData,
) {
  const profile = await requireTeacherProfile()
  const authEnd = performance.now()

  const rawUnitId = formData.get("unitId")
  const unitId = typeof rawUnitId === "string" ? rawUnitId.trim() : ""

  return withTelemetry(
    {
      routeTag: UNIT_ROUTE_TAG,
      functionName: "triggerUnitDeactivateJobAction",
      params: { unitId: unitId || null },
      authEndTime: authEnd,
    },
    async () => {
      const parsedForm = UnitDeactivateFormSchema.safeParse({
        unitId,
      })

      if (!parsedForm.success) {
        console.warn("[units] invalid form submission for unit deactivate", {
          issues: parsedForm.error.issues,
        })
        return UnitMutationStateSchema.parse({
          status: "error",
          jobId: null,
          message: "Invalid unit selection.",
        })
      }

      const trimmedUnitId = parsedForm.data.unitId.trim()
      if (trimmedUnitId.length === 0) {
        console.warn("[units] missing unit id for deactivate job")
        return UnitMutationStateSchema.parse({
          status: "error",
          jobId: null,
          message: "Invalid unit selection.",
        })
      }

      const jobId = randomUUID()

      queueMicrotask(() => {
        void runUnitDeactivateJob({
          jobId,
          unitId: trimmedUnitId,
        })
      })

      console.info("[units] queued unit deactivate job", {
        jobId,
        unitId: trimmedUnitId,
        userId: profile.userId,
      })

      return UnitMutationStateSchema.parse({
        status: "queued",
        jobId,
        message: "Unit deactivation queued.",
      })
    },
  )
}

export async function duplicateUnitAction(unitId: string) {
  await requireTeacherProfile()

  // ── 1. Load source data ──────────────────────────────────────────────────
  const { rows: unitRows } = await query<{
    unit_id: string
    title: string
    subject: string
    description: string | null
    year: number | null
    active: boolean
  }>(
    `select unit_id, title, subject, description, year, active
     from units where unit_id = $1 limit 1`,
    [unitId],
  )

  const sourceUnit = unitRows[0] ?? null
  if (!sourceUnit) {
    return DuplicateUnitReturnValue.parse({ data: null, error: "Unit not found." })
  }

  const { rows: lessons } = await query<{
    lesson_id: string
    title: string
    order_by: number
    active: boolean
  }>(
    `select lesson_id, title, order_by, active
     from lessons where unit_id = $1`,
    [unitId],
  )

  const oldLessonIds = lessons.map((l) => l.lesson_id)

  const [loRows, scRows, linkRows, activityRows] = await Promise.all([
    oldLessonIds.length > 0
      ? query<{
          lesson_id: string
          learning_objective_id: string
          title: string
          order_index: number
          order_by: number
          active: boolean
        }>(
          `select lesson_id, learning_objective_id, title, order_index, order_by, active
           from lessons_learning_objective
           where lesson_id = any($1::text[])`,
          [oldLessonIds],
        )
      : Promise.resolve({ rows: [] }),
    oldLessonIds.length > 0
      ? query<{ lesson_id: string; success_criteria_id: string }>(
          `select lesson_id, success_criteria_id
           from lesson_success_criteria
           where lesson_id = any($1::text[])`,
          [oldLessonIds],
        )
      : Promise.resolve({ rows: [] }),
    oldLessonIds.length > 0
      ? query<{ lesson_id: string; url: string; description: string | null }>(
          `select lesson_id, url, description
           from lesson_links
           where lesson_id = any($1::text[])`,
          [oldLessonIds],
        )
      : Promise.resolve({ rows: [] }),
    oldLessonIds.length > 0
      ? query<{
          activity_id: string
          lesson_id: string
          title: string | null
          type: string | null
          body_data: unknown
          order_by: number | null
          active: boolean
          is_summative: boolean
          notes: string | null
        }>(
          `select activity_id, lesson_id, title, type, body_data, order_by, active, is_summative, notes
           from activities
           where lesson_id = any($1::text[])`,
          [oldLessonIds],
        )
      : Promise.resolve({ rows: [] }),
  ])

  const oldActivityIds = activityRows.rows.map((a) => a.activity_id)

  const { rows: actScRows } = oldActivityIds.length > 0
    ? await query<{ activity_id: string; success_criteria_id: string }>(
        `select activity_id, success_criteria_id
         from activity_success_criteria
         where activity_id = any($1::text[])`,
        [oldActivityIds],
      )
    : { rows: [] }

  // ── 2. DB transaction ────────────────────────────────────────────────────
  const newUnitId = randomUUID()
  const newTitle = incrementUnitTitle(sourceUnit.title)

  const lessonIdMap = new Map<string, string>()
  const activityIdMap = new Map<string, string>()

  try {
    await withDbClient(async (client) => {
      await client.query("begin")
      try {
        await client.query(
          `insert into units (unit_id, title, subject, description, year, active)
           values ($1, $2, $3, $4, $5, true)`,
          [newUnitId, newTitle, sourceUnit.subject, sourceUnit.description, sourceUnit.year],
        )

        for (const lesson of lessons) {
          const newLessonId = randomUUID()
          lessonIdMap.set(lesson.lesson_id, newLessonId)
          await client.query(
            `insert into lessons (lesson_id, unit_id, title, order_by, active)
             values ($1, $2, $3, $4, $5)`,
            [newLessonId, newUnitId, lesson.title, lesson.order_by, lesson.active],
          )
        }

        for (const lo of loRows.rows) {
          const newLessonId = lessonIdMap.get(lo.lesson_id)
          if (!newLessonId) continue
          await client.query(
            `insert into lessons_learning_objective
               (lesson_id, learning_objective_id, title, order_index, order_by, active)
             values ($1, $2, $3, $4, $5, $6)`,
            [newLessonId, lo.learning_objective_id, lo.title, lo.order_index, lo.order_by, lo.active],
          )
        }

        for (const sc of scRows.rows) {
          const newLessonId = lessonIdMap.get(sc.lesson_id)
          if (!newLessonId) continue
          await client.query(
            `insert into lesson_success_criteria (lesson_id, success_criteria_id)
             values ($1, $2)`,
            [newLessonId, sc.success_criteria_id],
          )
        }

        for (const link of linkRows.rows) {
          const newLessonId = lessonIdMap.get(link.lesson_id)
          if (!newLessonId) continue
          await client.query(
            `insert into lesson_links (lesson_link_id, lesson_id, url, description)
             values ($1, $2, $3, $4)`,
            [randomUUID(), newLessonId, link.url, link.description],
          )
        }

        for (const act of activityRows.rows) {
          const newActivityId = randomUUID()
          const newLessonId = lessonIdMap.get(act.lesson_id)
          if (!newLessonId) continue
          activityIdMap.set(act.activity_id, newActivityId)
          await client.query(
            `insert into activities
               (activity_id, lesson_id, title, type, body_data, order_by, active, is_summative, notes)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              newActivityId,
              newLessonId,
              act.title,
              act.type,
              act.body_data != null ? JSON.stringify(act.body_data) : null,
              act.order_by,
              act.active,
              act.is_summative,
              act.notes,
            ],
          )
        }

        for (const asc of actScRows) {
          const newActivityId = activityIdMap.get(asc.activity_id)
          if (!newActivityId) continue
          await client.query(
            `insert into activity_success_criteria (activity_id, success_criteria_id)
             values ($1, $2)`,
            [newActivityId, asc.success_criteria_id],
          )
        }

        await client.query("commit")
      } catch (err) {
        await client.query("rollback")
        throw err
      }
    })
  } catch (error) {
    console.error("[units] duplicateUnitAction transaction failed", { unitId, error })
    const message = error instanceof Error ? error.message : "Failed to duplicate unit."
    return DuplicateUnitReturnValue.parse({ data: null, error: message })
  }

  // ── 3. Copy lesson files ─────────────────────────────────────────────────
  const fileWarnings: string[] = []
  const BASE_DIR = path.join(process.cwd(), "files")
  const oldLessonIdList = Array.from(lessonIdMap.keys())

  const allFileRows = oldLessonIdList.length > 0
    ? (await query<{
        file_name: string
        stored_path: string
        size_bytes: number | null
        content_type: string | null
        checksum: string | null
        scope_path: string
      }>(
        `select file_name, stored_path, size_bytes, content_type, checksum, scope_path
         from stored_files
         where bucket = 'lessons' and scope_path = any($1::text[])`,
        [oldLessonIdList],
      )).rows
    : []

  // Group by old lesson id
  const filesByLesson = new Map<string, typeof allFileRows>()
  for (const row of allFileRows) {
    const group = filesByLesson.get(row.scope_path) ?? []
    group.push(row)
    filesByLesson.set(row.scope_path, group)
  }

  for (const [oldLessonId, newLessonId] of lessonIdMap) {
    const fileRows = filesByLesson.get(oldLessonId) ?? []
    for (const file of fileRows) {
      const newStoredPath = `lessons/${newLessonId}/${file.file_name}`
      const srcDisk = path.join(BASE_DIR, file.stored_path)
      const dstDisk = path.join(BASE_DIR, newStoredPath)

      try {
        await fs.mkdir(path.dirname(dstDisk), { recursive: true })
        await fs.copyFile(srcDisk, dstDisk)
        await query(
          `insert into stored_files
             (bucket, scope_path, file_name, stored_path, size_bytes, content_type, checksum, created_at, updated_at)
           values ($1, $2, $3, $4, $5, $6, $7, timezone('utc', now()), timezone('utc', now()))
           on conflict (bucket, scope_path, file_name) do nothing`,
          [
            "lessons",
            newLessonId,
            file.file_name,
            newStoredPath,
            file.size_bytes,
            file.content_type,
            file.checksum,
          ],
        )
      } catch (fileError) {
        console.error("[units] file copy failed", { oldLessonId, newLessonId, file: file.file_name, fileError })
        fileWarnings.push(`Lesson ${newLessonId}: failed to copy ${file.file_name}`)
      }
    }
  }

  revalidatePath("/units")

  return DuplicateUnitReturnValue.parse({
    data: { newUnitId, fileWarnings },
    error: null,
  })
}
