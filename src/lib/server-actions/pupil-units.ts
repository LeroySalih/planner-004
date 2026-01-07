"use server"

import { z } from "zod"

import { query } from "@/lib/db"
import { withTelemetry } from "@/lib/telemetry"

const PupilProfileSchema = z
  .object({
    user_id: z.string(),
    first_name: z.string().nullable().optional(),
    last_name: z.string().nullable().optional(),
    is_teacher: z.boolean().nullable().optional(),
  })
  .nullable()

const LessonObjectiveSchema = z.object({
  lesson_id: z.string(),
  objective_id: z.string(),
  title: z.string(),
  order_index: z.number().nullable(),
})

const DisplayImageSchema = z.object({
  lesson_id: z.string(),
  activity_id: z.string(),
  title: z.string().nullable(),
  order_by: z.number().nullable(),
  image_file: z.string().nullable(),
  image_url: z.string().nullable(),
  file_url: z.string().nullable(),
})

const LessonFileSchema = z.object({
  lesson_id: z.string(),
  name: z.string(),
  path: z.string(),
  mime_type: z.string().nullable(),
  size: z.number().nullable(),
  updated_at: z.string().nullable(),
})

const LessonAssignmentSchema = z.object({
  lesson_id: z.string(),
  lesson_title: z.string(),
  lesson_order: z.number().nullable(),
  unit_id: z.string(),
  unit_title: z.string(),
  group_id: z.string(),
  subject: z.string().nullable(),
  start_date: z.string().nullable(),
  feedback_visible: z.boolean(),
})

const SubjectUnitsSchema = z.object({
  profile: PupilProfileSchema,
  subjects: z.array(
    z.object({
      subject: z.string().nullable(),
      units: z.array(
        z.object({
          unitId: z.string(),
          unitTitle: z.string(),
          firstLessonDate: z.string().nullable(),
          lessons: z.array(
            z.object({
              lessonId: z.string(),
              lessonTitle: z.string(),
              lessonOrder: z.number().nullable(),
              startDate: z.string().nullable(),
              groupId: z.string(),
              subject: z.string().nullable(),
              feedbackVisible: z.boolean(),
              isEnrolled: z.boolean(),
              objectives: z.array(
                z.object({
                  id: z.string(),
                  title: z.string(),
                  orderIndex: z.number().nullable(),
                }),
              ),
              displayImages: z.array(
                z.object({
                  activityId: z.string(),
                  title: z.string().nullable(),
                  orderBy: z.number().nullable(),
                  imageFile: z.string().nullable(),
                  imageUrl: z.string().nullable(),
                  fileUrl: z.string().nullable(),
                }),
              ),
              files: z.array(
                z.object({
                  name: z.string(),
                  path: z.string(),
                  mimeType: z.string().nullable(),
                  size: z.number().nullable(),
                  updatedAt: z.string().nullable(),
                }),
              ),
            }),
          ),
        }),
      ),
    }),
  ),
})

type LessonObjective = z.infer<typeof LessonObjectiveSchema>
type DisplayImage = z.infer<typeof DisplayImageSchema>
type LessonFile = z.infer<typeof LessonFileSchema>
type SubjectUnitsPayload = z.infer<typeof SubjectUnitsSchema>

type LessonObjectiveRow = {
  lesson_id: string
  learning_objective_id: string
  title: string | null
  order_index: number | null
  order_by: number | null
}

type TelemetryOptions = { authEndTime?: number | null; routeTag?: string }

export async function readPupilUnitsBootstrapAction(pupilId: string, options?: TelemetryOptions) {
  const routeTag = options?.routeTag ?? "/pupil-units:bootstrap"

  return withTelemetry(
    {
      routeTag,
      functionName: "readPupilUnitsBootstrapAction",
      params: { pupilId },
      authEndTime: options?.authEndTime ?? null,
    },
    async () => {
      if (!pupilId || pupilId.trim().length === 0) {
        return { data: null, error: "Missing pupil identifier." }
      }

      try {
        const normalizedPupilId = pupilId.trim()
        const [profileResult, membershipResult, assignmentsResult] = await Promise.all([
          query<{
            user_id: string
            first_name: string | null
            last_name: string | null
            is_teacher: boolean | null
          }>(
            `
              select user_id, first_name, last_name, is_teacher
              from profiles
              where user_id = $1
              limit 1
            `,
            [normalizedPupilId],
          ),
          query<{ group_id: string; subject: string | null }>(
            `
              select gm.group_id, g.subject
              from group_membership gm
              join groups g on g.group_id = gm.group_id
              where gm.user_id = $1
                and coalesce(g.active, true) = true
            `,
            [normalizedPupilId],
          ),
          query<{
            lesson_id: string
            lesson_title: string | null
            lesson_order: number | null
            unit_id: string | null
            unit_title: string | null
            group_id: string
            subject: string | null
            start_date: string | Date | null
            feedback_visible: boolean | null
          }>(
            `
              with target_memberships as (
                select gm.group_id, g.subject
                from group_membership gm
                join groups g on g.group_id = gm.group_id
                where gm.user_id = $1
                  and coalesce(g.active, true) = true
              )
              select
                la.lesson_id,
                coalesce(l.title, 'Untitled lesson') as lesson_title,
                l.order_by as lesson_order,
                l.unit_id,
                u.title as unit_title,
                la.group_id,
                tm.subject,
                la.start_date,
                coalesce(la.feedback_visible, false) as feedback_visible
              from target_memberships tm
              join lesson_assignments la on la.group_id = tm.group_id
              join lessons l on l.lesson_id = la.lesson_id
              join units u on u.unit_id = l.unit_id
              where coalesce(l.active, true) = true
            `,
            [normalizedPupilId],
          ),
        ])

        const profileRow = profileResult.rows[0] ?? null
        const profile = profileRow
          ? {
              user_id: profileRow.user_id,
              first_name: profileRow.first_name,
              last_name: profileRow.last_name,
              is_teacher: profileRow.is_teacher,
            }
          : null

        const subjectsSet = new Map<string | null, { subject: string | null; units: Map<string, true> }>()
        membershipResult.rows.forEach((row) => {
          subjectsSet.set(row.subject ?? null, { subject: row.subject ?? null, units: new Map() })
        })

        const assignments = assignmentsResult.rows
          .map((row) =>
            LessonAssignmentSchema.parse({
              lesson_id: row.lesson_id,
              lesson_title: row.lesson_title ?? "Untitled lesson",
              lesson_order: typeof row.lesson_order === "number" ? row.lesson_order : null,
              unit_id: row.unit_id ?? "",
              unit_title: row.unit_title ?? row.unit_id ?? "Untitled unit",
              group_id: row.group_id,
              subject: row.subject ?? null,
              start_date:
                row.start_date instanceof Date
                  ? row.start_date.toISOString()
                  : typeof row.start_date === "string"
                    ? row.start_date
                    : null,
              feedback_visible: Boolean(row.feedback_visible),
            }),
          )
          .filter((assignment) => assignment.unit_id && assignment.lesson_id)

        const lessonIds = Array.from(new Set(assignments.map((assignment) => assignment.lesson_id)))

        const [objectivesResult, imagesResult, filesResult] = await Promise.all([
          lessonIds.length === 0
            ? Promise.resolve({ rows: [] as LessonObjectiveRow[] })
            : query<LessonObjectiveRow>(
                `
                  select
                    llo.lesson_id,
                    llo.learning_objective_id,
                    llo.title,
                    llo.order_index,
                    llo.order_by
                  from lessons_learning_objective llo
                  where llo.lesson_id = any($1::text[])
                    and coalesce(llo.active, true) = true
                `,
                [lessonIds],
              ),
          lessonIds.length === 0
            ? Promise.resolve({ rows: [] as DisplayImage[] })
            : query<{
                lesson_id: string
                activity_id: string
                title: string | null
                order_by: number | null
                image_file: string | null
                image_url: string | null
                file_url: string | null
              }>(
                `
                  select
                    act.lesson_id,
                    act.activity_id,
                    act.title,
                    act.order_by,
                    nullif(trim((act.body_data ->> 'imageFile')::text), '') as image_file,
                    nullif(trim((act.body_data ->> 'imageUrl')::text), '') as image_url,
                    nullif(trim((act.body_data ->> 'fileUrl')::text), '') as file_url
                  from activities act
                  where act.lesson_id = any($1::text[])
                    and lower(coalesce(act.type, '')) = 'display-image'
                    and coalesce(act.active, true) = true
                    and coalesce(act.is_homework, false) = false
                `,
                [lessonIds],
              ),
          lessonIds.length === 0
            ? Promise.resolve({ rows: [] as LessonFile[] })
            : query<{
                lesson_id: string
                name: string
                path: string
                mime_type: string | null
                size: number | null
                updated_at: string | Date | null
              }>(
                `
                  select
                    scope_path as lesson_id,
                    file_name as name,
                    scope_path || '/' || file_name as path,
                    content_type as mime_type,
                    size_bytes as size,
                    updated_at
                  from stored_files
                  where bucket = 'lessons'
                    and scope_path = any($1::text[])
                    and file_name is not null
                    and file_name <> ''
                    and file_name not like 'activities/%'
                `,
                [lessonIds],
              ),
        ])

        const objectives = objectivesResult.rows.map((row) =>
          LessonObjectiveSchema.parse({
            lesson_id: row.lesson_id,
            objective_id: row.learning_objective_id,
            title: (row.title ?? "Learning objective").trim() || "Learning objective",
            order_index:
              typeof row.order_index === "number"
                ? row.order_index
                : typeof row.order_by === "number"
                  ? row.order_by
                  : null,
          }),
        )

        const displayImages = imagesResult.rows.map((row) =>
          DisplayImageSchema.parse({
            lesson_id: row.lesson_id,
            activity_id: row.activity_id,
            title: row.title ?? null,
            order_by: typeof row.order_by === "number" ? row.order_by : null,
            image_file: row.image_file ?? null,
            image_url: row.image_url ?? null,
            file_url: row.file_url ?? null,
          }),
        )

        const files = filesResult.rows.map((row) =>
          LessonFileSchema.parse({
            lesson_id: row.lesson_id,
            name: row.name,
            path: row.path,
            mime_type: row.mime_type ?? null,
            size: typeof row.size === "number" ? row.size : null,
            updated_at:
              row.updated_at instanceof Date
                ? row.updated_at.toISOString()
                : typeof row.updated_at === "string"
                  ? row.updated_at
                  : null,
          }),
        )

        const objectivesByLesson = new Map<string, LessonObjective[]>()  
        objectives.forEach((objective) => {
          const list = objectivesByLesson.get(objective.lesson_id) ?? []
          list.push(objective)
          objectivesByLesson.set(objective.lesson_id, list)
        })

        const imagesByLesson = new Map<string, DisplayImage[]>()  
        displayImages.forEach((image) => {
          const list = imagesByLesson.get(image.lesson_id) ?? []
          list.push(image)
          imagesByLesson.set(image.lesson_id, list)
        })

        const filesByLesson = new Map<string, LessonFile[]>()  
        files.forEach((file) => {
          const list = filesByLesson.get(file.lesson_id) ?? []
          list.push(file)
          filesByLesson.set(file.lesson_id, list)
        })

        const unitsBySubject = new Map<
          string | null,
          Map<
            string,
            {
              unitId: string
              unitTitle: string
              firstLessonDate: string | null
              lessons: SubjectUnitsPayload["subjects"][number]["units"][number]["lessons"]
            }
          >
        >()

        assignments.forEach((assignment) => {
          const subjectKey = assignment.subject ?? null
          const subjectUnits = unitsBySubject.get(subjectKey) ?? new Map()
          const unitEntry =
            subjectUnits.get(assignment.unit_id) ??
            ({
              unitId: assignment.unit_id,
              unitTitle: assignment.unit_title,
              firstLessonDate: assignment.start_date,
              lessons: [],
            } satisfies SubjectUnitsPayload["subjects"][number]["units"][number])

          const objectivesForLesson = (objectivesByLesson.get(assignment.lesson_id) ?? []).sort((a, b) => {
            const orderA = typeof a.order_index === "number" ? a.order_index : Number.POSITIVE_INFINITY
            const orderB = typeof b.order_index === "number" ? b.order_index : Number.POSITIVE_INFINITY
            if (orderA !== orderB) return orderA - orderB
            return a.title.localeCompare(b.title)
          })

          const imagesForLesson = (imagesByLesson.get(assignment.lesson_id) ?? []).sort((a, b) => {
            const orderA = typeof a.order_by === "number" ? a.order_by : Number.POSITIVE_INFINITY
            const orderB = typeof b.order_by === "number" ? b.order_by : Number.POSITIVE_INFINITY
            if (orderA !== orderB) return orderA - orderB
            return (a.title ?? "").localeCompare(b.title ?? "")
          })

          const filesForLesson = (filesByLesson.get(assignment.lesson_id) ?? []).sort((a, b) => {
            const dateA = a.updated_at ? Date.parse(a.updated_at) : 0
            const dateB = b.updated_at ? Date.parse(b.updated_at) : 0
            if (dateA !== dateB) return dateB - dateA
            return a.name.localeCompare(b.name)
          })

          unitEntry.firstLessonDate =
            unitEntry.firstLessonDate && assignment.start_date
              ? [unitEntry.firstLessonDate, assignment.start_date].sort()[0]
              : unitEntry.firstLessonDate ?? assignment.start_date

          unitEntry.lessons.push({
            lessonId: assignment.lesson_id,
            lessonTitle: assignment.lesson_title,
            lessonOrder: assignment.lesson_order,
            startDate: assignment.start_date,
            groupId: assignment.group_id,
            subject: assignment.subject,
            feedbackVisible: assignment.feedback_visible,
            isEnrolled: true,
            objectives: objectivesForLesson.map((objective) => ({
              id: objective.objective_id,
              title: objective.title,
              orderIndex: objective.order_index,
            })),
            displayImages: imagesForLesson.map((image) => ({
              activityId: image.activity_id,
              title: image.title,
              orderBy: image.order_by,
              imageFile: image.image_file,
              imageUrl: image.image_url,
              fileUrl: image.file_url,
            })),
            files: filesForLesson.map((file) => ({
              name: file.name,
              path: file.path,
              mimeType: file.mime_type,
              size: file.size,
              updatedAt: file.updated_at,
            })),
          })

          subjectUnits.set(assignment.unit_id, unitEntry)
          unitsBySubject.set(subjectKey, subjectUnits)
        })

        const subjects = Array.from(
          new Set([
            ...subjectsSet.keys(),
            ...Array.from(unitsBySubject.keys()),
            ...assignments.map((assignment) => assignment.subject ?? null),
          ]),
        )
          .map((subject) => {
            const unitMap = unitsBySubject.get(subject) ?? new Map()
            const units = Array.from(unitMap.values()).sort((a, b) => {
              if (a.firstLessonDate && b.firstLessonDate && a.firstLessonDate !== b.firstLessonDate) {
                return new Date(a.firstLessonDate).getTime() - new Date(b.firstLessonDate).getTime()
              }
              if (a.firstLessonDate && !b.firstLessonDate) return -1
              if (!a.firstLessonDate && b.firstLessonDate) return 1
              return a.unitTitle.localeCompare(b.unitTitle)
            })

            units.forEach((unit: SubjectUnitsPayload["subjects"][number]["units"][number]) =>
              unit.lessons.sort((a, b) => {
                const dateA = a.startDate ? Date.parse(a.startDate) : Number.NEGATIVE_INFINITY
                const dateB = b.startDate ? Date.parse(b.startDate) : Number.NEGATIVE_INFINITY
                if (!Number.isNaN(dateA) && !Number.isNaN(dateB) && dateA !== dateB) {
                  return dateB - dateA
                }

                const orderA = typeof a.lessonOrder === "number" ? a.lessonOrder : Number.POSITIVE_INFINITY
                const orderB = typeof b.lessonOrder === "number" ? b.lessonOrder : Number.POSITIVE_INFINITY
                if (orderA !== orderB) return orderA - orderB
                return a.lessonTitle.localeCompare(b.lessonTitle)
              }),
            )

            return {
              subject,
              units,
            }
          })
          .sort((a, b) => {
            const subjectA = a.subject ?? ""
            const subjectB = b.subject ?? ""
            return subjectA.localeCompare(subjectB)
          })

        const payload = SubjectUnitsSchema.parse({
          profile,
          subjects,
        })

        return { data: payload, error: null }
      } catch (error) {
        console.error("[pupil-units] Failed to load pupil units bootstrap", error)
        const message = error instanceof Error ? error.message : "Unable to load pupil units."
        return { data: null, error: message }
      }
    },
  )
}
