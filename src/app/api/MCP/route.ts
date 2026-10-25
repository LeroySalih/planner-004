import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import { mcpChallengeHeaders, verifyMcpAuthorization, type McpCaller } from '@/lib/mcp/auth'
import { recordMcpCall } from '@/lib/mcp/audit'
import { publicOrigin } from '@/lib/public-origin'
import { SingleRequestTransport } from '@/lib/mcp/transport'
import {
  listCurriculumSummaries,
  getCurriculumSummary,
  findCurriculumIdsByTitle,
  createCurriculum,
} from '@/lib/mcp/curriculum'
import {
  fetchCurriculumLosc,
  listAssessmentObjectives,
  createAssessmentObjective,
  createLearningObjective,
  createSuccessCriterion,
  updateAssessmentObjective,
  updateLearningObjective,
  updateSuccessCriterion,
  deactivateLearningObjective,
  deactivateSuccessCriterion,
} from '@/lib/mcp/losc'
import { listLessonAssignments } from '@/lib/mcp/assignments'
import { createSubUnit, listSubUnitsWithLessons, setLessonSubUnit, setSubUnitActive, updateSubUnit } from '@/lib/sub-units/store'
import { listUnits, findUnitsByTitle, createUnit, updateUnit, getUnit } from '@/lib/mcp/units'
import { LESSON_DESCRIPTION_MAX } from '@/lib/lesson-description'
import { listUnitAudits, readUnitAudit, recordUnitAudit, MAX_AUDIT_ACTIONS, type UnitAudit } from '@/lib/unit-audits/store'
import { withDbClient } from '@/lib/db'
import { listLessonsForUnit, getLessonObjectives, createLesson, updateLesson, reorderLessons, addSuccessCriterionToLesson, removeSuccessCriterionFromLesson, removeLearningObjectiveFromLesson, uploadLessonFile, removeLessonFile } from '@/lib/mcp/lessons'
import {
  listTeachers,
  listGroups,
  resolveTeacherId,
  listTimetableSlots,
  setTimetableSlot,
  deleteTimetableSlot,
  VALID_DAYS,
  VALID_PERIODS,
} from '@/lib/mcp/timetable'
import {
  listAssessments,
  getAssessment,
  getPupilResult,
  createAssessment,
  setAssessmentObjectives,
  mapAssessmentObjective,
  setAssessmentQuestions,
  listGroupPupils,
  recordPupilResult,
  attachAssessmentFile,
  listAssessmentFiles,
  linkAssessmentFileToPupil,
  removeAssessmentFile,
  ASSESSMENT_UPLOAD_MAX_BYTES,
} from '@/lib/assessments/store'
import {
  AssessmentFileSchema,
  AssessmentPaperSchema,
  AssessmentPaperSummarySchema,
  AssessmentPupilResultSchema,
  GroupPupilSchema,
  RecordAssessmentResultSchema,
  type AssessmentPaper,
} from '@/types'
import { MCP_UPLOAD_MAX_BYTES, decodeBase64File, fetchFileFromUrl } from '@/lib/mcp/file-input'
import { createUploadLink } from '@/lib/mcp/upload-links'
import { createDownloadLink, listLessonFiles } from '@/lib/mcp/download-links'
import { getPupilLessonFeedback, setPupilFeedback } from '@/lib/mcp/pupil-feedback'
import {
  INTERVENTION_STATUSES,
  createIntervention,
  getPupilGaps,
  readInterventions,
  updateIntervention,
  type InterventionSummary,
} from '@/lib/interventions/store'
import { ACTIVITY_TYPES, ActivityBodyDataError, listActivitiesForLesson, getActivity, createActivity, updateActivity, setActivityMaxMarks, addSuccessCriterionToActivity, removeSuccessCriterionFromActivity, removeActivity, reorderActivities, uploadActivityFile, removeActivityFile, uploadActivityImage, moveInlineImagesToFiles, type ActivityUpdate } from '@/lib/mcp/activities'

// Force Node.js runtime — MCP SDK is not compatible with the Edge runtime.
export const runtime = 'nodejs'

// ---------------------------------------------------------------------------
// McpServer factory — creates a fresh server instance per request.
//
// A module-level singleton throws "Already connected to a transport. Call
// close() before connecting to a new transport" on every second request
// because the MCP SDK v1.29 prevents calling connect() more than once on the
// same instance. Tool registration is pure in-memory JS with negligible
// overhead, so creating a new server per request is safe.
// ---------------------------------------------------------------------------

function createMcpServer(caller: McpCaller, baseUrl = ''): McpServer {
  const srv = new McpServer(
    { name: 'planner-mcp-server', version: '0.1.0' },
    {
      capabilities: {
        resources: {},
        tools: { listChanged: true },
        prompts: {},
        logging: {},
      },
    },
  )

  // Every tool here answers with a one-line summary in `content` and the real
  // payload in `structuredContent`. Clients differ on whether they surface
  // structured output: Claude Desktop shows only the text, so asking for a
  // curriculum's objectives returned "55 learning objectives." and nothing
  // else, and the data looked missing when it had been sent all along.
  //
  // Wrapping registration once appends the payload as text too, rather than
  // editing sixty-five handlers and relying on the next one to remember.
  //
  // The same wrapper writes every call to mcp_audit_log. Handlers report
  // failure by returning null payloads with the message as text rather than
  // throwing, so that is what counts as an error here.
  const register = srv.registerTool.bind(srv)
  srv.registerTool = ((name: string, config: unknown, handler: (...args: unknown[]) => unknown) =>
    register(
      name as never,
      config as never,
      (async (...args: unknown[]) => {
        const started = performance.now()
        let result: {
          content?: Array<{ type: string; text?: string }>
          structuredContent?: Record<string, unknown>
          isError?: boolean
        }
        try {
          result = (await (handler as (...a: unknown[]) => Promise<unknown>)(...args)) as typeof result
        } catch (error) {
          await recordMcpCall(caller, {
            tool: name,
            args: args[0],
            error: error instanceof Error ? error.message : String(error),
            durationMs: performance.now() - started,
          })
          throw error
        }
        const payload = result?.structuredContent
        const failed = result?.isError === true
          || (payload !== undefined && Object.keys(payload).length > 0 && Object.values(payload).every((value) => value === null))
        await recordMcpCall(caller, {
          tool: name,
          args: args[0],
          error: failed ? (result.content?.[0]?.text ?? 'Tool returned no data') : null,
          durationMs: performance.now() - started,
        })
        if (result?.structuredContent && Array.isArray(result.content)) {
          return {
            ...result,
            content: [
              ...result.content,
              { type: 'text' as const, text: JSON.stringify(result.structuredContent) },
            ],
          }
        }
        return result
      }) as never,
    )) as typeof srv.registerTool

  srv.registerTool(
    'get_all_curriculum',
    {
      title: 'List curricula',
      description: 'Return all curriculum summaries (id, title, active).',
      outputSchema: {
        curricula: z.array(
          z.object({
            curriculum_id: z.string(),
            title: z.string(),
            is_active: z.boolean(),
          }),
        ),
      },
    },
    async () => {
      const curricula = await listCurriculumSummaries()
      return {
        content: [
          {
            type: 'text' as const,
            text:
              curricula.length > 0
                ? curricula.map((c) => `${c.curriculum_id} • ${c.title}`).join('\n')
                : 'No curricula available.',
          },
        ],
        structuredContent: { curricula },
      }
    },
  )

  srv.registerTool(
    'get_curriculum',
    {
      title: 'Get curriculum summary',
      description: 'Return { curriculum_id, title, is_active } for a specific curriculum.',
      inputSchema: {
        curriculum_id: z.string().min(1).describe('Curriculum identifier.'),
      },
      outputSchema: {
        curriculum: z
          .object({
            curriculum_id: z.string(),
            title: z.string(),
            is_active: z.boolean(),
          })
          .nullable(),
      },
    },
    async ({ curriculum_id }) => {
      const curriculum = await getCurriculumSummary(curriculum_id)
      if (!curriculum) {
        return {
          content: [{ type: 'text' as const, text: `Curriculum ${curriculum_id} was not found.` }],
          structuredContent: { curriculum: null },
        }
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: `${curriculum.curriculum_id} • ${curriculum.title} (active=${curriculum.is_active})`,
          },
        ],
        structuredContent: { curriculum },
      }
    },
  )

  srv.registerTool(
    'get_curriculum_id_from_title',
    {
      title: 'Find curriculum IDs by title',
      description:
        'Search curricula by title using wildcards (*, ?) or JavaScript-style /regex/ patterns.',
      inputSchema: {
        curriculum_title: z
          .string()
          .min(1)
          .describe('Title pattern, e.g. "Math*" or "/Math.+/" (case-insensitive).'),
      },
      outputSchema: {
        matches: z.array(
          z.object({
            curriculum_id: z.string(),
            curriculum_title: z.string(),
          }),
        ),
      },
    },
    async ({ curriculum_title }) => {
      const matches = await findCurriculumIdsByTitle(curriculum_title)
      return {
        content: [
          {
            type: 'text' as const,
            text:
              matches.length > 0
                ? matches.map((m) => `${m.curriculum_id} • ${m.curriculum_title}`).join('\n')
                : 'No curricula matched the provided title.',
          },
        ],
        structuredContent: { matches },
      }
    },
  )

  srv.registerTool(
    'get_all_los_and_scs_for_curriculum',
    {
      title: 'Learning objectives + success criteria',
      description: 'Return the LO/SC tree for a curriculum.',
      inputSchema: {
        curriculum_id: z.string().min(1).describe('ID of the curriculum to inspect.'),
      },
      outputSchema: {
        learning_objectives: z.array(
          z.object({
            learning_objective_id: z.string(),
            title: z.string(),
            active: z.boolean(),
            spec_ref: z.string().nullable(),
            order_index: z.number(),
            scs: z.array(
              z.object({
                success_criteria_id: z.string(),
                title: z.string(),
                active: z.boolean(),
                order_index: z.number(),
              }),
            ),
          }),
        ),
      },
    },
    async ({ curriculum_id }) => {
      const curriculum = await fetchCurriculumLosc(curriculum_id)
      if (!curriculum) {
        return {
          content: [{ type: 'text' as const, text: `No curriculum found for id ${curriculum_id}.` }],
          structuredContent: { learning_objectives: [] },
        }
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: `${curriculum.title} (${curriculum.curriculum_id}) • ${curriculum.learning_objectives.length} learning objectives.`,
          },
        ],
        structuredContent: { learning_objectives: curriculum.learning_objectives },
      }
    },
  )

  srv.registerTool(
    'get_all_units',
    {
      title: 'List units',
      description: 'Return all unit summaries (id, title, active).',
      outputSchema: {
        units: z.array(
          z.object({
            unit_id: z.string(),
            title: z.string(),
            is_active: z.boolean(),
          }),
        ),
      },
    },
    async () => {
      const units = await listUnits()
      return {
        content: [
          {
            type: 'text' as const,
            text:
              units.length > 0
                ? units.map((u) => `${u.unit_id} • ${u.title}`).join('\n')
                : 'No units available.',
          },
        ],
        structuredContent: { units },
      }
    },
  )

  srv.registerTool(
    'get_unit_by_title',
    {
      title: 'Find units by title',
      description: 'Search units by title using wildcards (*, ?) or /regex/ patterns.',
      inputSchema: {
        unit_title: z
          .string()
          .min(1)
          .describe('Title pattern, e.g. "Design*" or "/Design.+/" (case-insensitive).'),
      },
      outputSchema: {
        matches: z.array(
          z.object({
            unit_id: z.string(),
            unit_title: z.string(),
          }),
        ),
      },
    },
    async ({ unit_title }) => {
      const matches = await findUnitsByTitle(unit_title)
      return {
        content: [
          {
            type: 'text' as const,
            text:
              matches.length > 0
                ? matches.map((m) => `${m.unit_id} • ${m.unit_title}`).join('\n')
                : 'No units matched the provided title.',
          },
        ],
        structuredContent: { matches },
      }
    },
  )

  srv.registerTool(
    'get_unit',
    {
      title: 'Get a unit',
      description: 'Return one unit: title, description, subject, year, active, its curriculum and how many lessons it has. Read this before update_unit to see the description you are changing.',
      inputSchema: {
        unit_id: z.string().min(1).describe('Unit identifier.'),
      },
      outputSchema: {
        unit: z.object({
          unit_id: z.string(),
          title: z.string(),
          subject: z.string(),
          description: z.string().nullable(),
          year: z.number().nullable(),
          is_active: z.boolean(),
          curriculum_id: z.string().nullable(),
          curriculum_title: z.string().nullable(),
          lesson_count: z.number(),
        }).nullable(),
      },
    },
    async ({ unit_id }) => {
      try {
        const unit = await getUnit(unit_id)
        return {
          content: [{ type: 'text' as const, text: `${unit.unit_id} • ${unit.title} (${unit.subject}${unit.year ? `, Year ${unit.year}` : ''}, ${unit.lesson_count} lessons)` }],
          structuredContent: { unit },
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to read unit'
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], structuredContent: { unit: null } }
      }
    },
  )

  srv.registerTool(
    'get_lessons_for_unit',
    {
      title: 'List lessons for a unit',
      description: 'Return the lessons associated with a given unit. sub_unit_id is the sub unit a lesson is grouped under, or null (see list_sub_units).',
      inputSchema: {
        unit_id: z.string().min(1).describe('Unit identifier.'),
      },
      outputSchema: {
        lessons: z.array(
          z.object({
            lesson_id: z.string(),
            unit_id: z.string(),
            title: z.string(),
            description: z.string().nullable(),
            is_active: z.boolean(),
            order_index: z.number(),
            sub_unit_id: z.string().nullable(),
          }),
        ),
      },
    },
    async ({ unit_id }) => {
      const lessons = await listLessonsForUnit(unit_id)
      return {
        content: [
          {
            type: 'text' as const,
            text:
              lessons.length > 0
                ? lessons
                    .map((l) => `${l.lesson_id} • ${l.title} (order=${l.order_index})`)
                    .join('\n')
                : `No lessons found for unit ${unit_id}.`,
          },
        ],
        structuredContent: { lessons },
      }
    },
  )

  srv.registerTool(
    'reorder_lessons',
    {
      title: 'Reorder lessons in a unit',
      description: 'Set the order of a unit\'s lessons. Pass every active lesson id (from get_lessons_for_unit) exactly once, first to last. '
        + 'Inactive lessons stay after them; interventions are not part of the order. '
        + 'A sub unit\'s lessons are kept together, at the place of its first lesson.',
      inputSchema: z.object({
        unit_id: z.string().min(1).describe('Unit identifier.'),
        lesson_ids: z.preprocess(
          (v) => (typeof v === 'string' ? JSON.parse(v) : v),
          z.array(z.string().min(1)).min(1),
        ).describe('Every active lesson id in the unit, in the new order.'),
      }),
      outputSchema: z.object({
        lessons: z.array(z.object({
          lesson_id: z.string(),
          unit_id: z.string(),
          title: z.string(),
          is_active: z.boolean(),
          order_index: z.number(),
          sub_unit_id: z.string().nullable(),
        })).nullable(),
      }),
    },
    async ({ unit_id, lesson_ids }) => {
      try {
        const lessons = await reorderLessons(unit_id, lesson_ids)
        return {
          content: [{
            type: 'text' as const,
            text: lessons.map((l, i) => `${i + 1}. ${l.lesson_id} • ${l.title}${l.is_active ? '' : ' (inactive)'}`).join('\n'),
          }],
          structuredContent: { lessons },
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          structuredContent: { lessons: null },
        }
      }
    },
  )

  srv.registerTool(
    'get_lesson_objectives',
    {
      title: 'Get lesson objectives and success criteria',
      description: 'Return everything linked to a lesson: its learning objectives, the success criteria under each, and which of the lesson\'s activities use each criterion. '
        + 'Use it to check links after add_success_criterion_to_lesson / add_success_criterion_to_activity, or to find stale ones to remove. '
        + 'linked_to_lesson is false for an LO or SC that only reaches the lesson through a criterion or activity, rather than being linked to the lesson itself. '
        + 'Also returns the lesson\'s description (null if unset), which update_lesson writes.',
      inputSchema: {
        lesson_id: z.string().min(1).describe('Lesson identifier.'),
      },
      outputSchema: {
        lesson: z.object({
          lesson_id: z.string(),
          unit_id: z.string(),
          title: z.string(),
          description: z.string().nullable(),
          learning_objectives: z.array(z.object({
            learning_objective_id: z.string(),
            assessment_objective_code: z.string().nullable(),
            title: z.string(),
            active: z.boolean(),
            linked_to_lesson: z.boolean(),
            success_criteria: z.array(z.object({
              success_criteria_id: z.string(),
              description: z.string(),
              level: z.number(),
              active: z.boolean(),
              linked_to_lesson: z.boolean(),
              activities: z.array(z.object({ activity_id: z.string(), title: z.string(), type: z.string() })),
            })),
          })),
        }).nullable(),
      },
    },
    async ({ lesson_id }) => {
      try {
        const lesson = await getLessonObjectives(lesson_id)
        const scCount = lesson.learning_objectives.reduce((n, lo) => n + lo.success_criteria.length, 0)
        const lines = lesson.learning_objectives.flatMap((lo) => [
          `${lo.assessment_objective_code ? `${lo.assessment_objective_code} ` : ''}LO ${lo.learning_objective_id} • ${lo.title}${lo.linked_to_lesson ? '' : ' [LO not linked to lesson]'}${lo.active ? '' : ' [inactive]'}`,
          ...lo.success_criteria.map((sc) =>
            `  SC ${sc.success_criteria_id} (L${sc.level}) • ${sc.description}${sc.linked_to_lesson ? '' : ' [SC not linked to lesson]'}${sc.active ? '' : ' [inactive]'}`
            + ` — activities: ${sc.activities.length > 0 ? sc.activities.map((a) => a.title.trim() || `untitled ${a.type}`).join('; ') : 'none'}`),
        ])
        return {
          content: [{
            type: 'text' as const,
            text: `${lesson.title}: ${lesson.learning_objectives.length} learning objectives, ${scCount} success criteria.`
              + (lines.length > 0 ? `\n${lines.join('\n')}` : ''),
          }],
          structuredContent: { lesson },
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to read lesson objectives'
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          structuredContent: { lesson: null },
        }
      }
    },
  )

  srv.registerTool(
    'create_curriculum',
    {
      title: 'Create curriculum',
      description: 'Create a new curriculum. Returns the full created record.',
      inputSchema: {
        title: z.string().min(1).describe('Curriculum title.'),
        subject: z.string().optional().describe('Subject area (e.g. "Computer Science").'),
        description: z.string().optional().describe('Optional description.'),
      },
      outputSchema: {
        curriculum: z.object({
          curriculum_id: z.string(),
          title: z.string(),
          subject: z.string().nullable(),
          description: z.string().nullable(),
          is_active: z.boolean(),
        }).nullable(),
      },
    },
    async ({ title, subject, description }) => {
      try {
        const curriculum = await createCurriculum(title, subject ?? null, description ?? null)
        return {
          content: [{ type: 'text' as const, text: `Created curriculum ${curriculum.curriculum_id} • ${curriculum.title}` }],
          structuredContent: { curriculum },
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to create curriculum'
        return {
          content: [{ type: 'text' as const, text: message }],
          structuredContent: { curriculum: null },
        }
      }
    },
  )

  srv.registerTool(
    'create_unit',
    {
      title: 'Create unit',
      description: 'Create a new unit. New units start inactive (hidden from pupils) until a teacher activates them. Lessons and activities can be edited via MCP whether or not their unit is active.',
      inputSchema: {
        title: z.string().min(1).describe('Unit title.'),
        subject: z.string().min(1).describe('Subject area (e.g. "Computer Science").'),
        description: z.string().optional().describe('Optional description.'),
        year: z.number().int().min(1).max(13).optional().describe('Year group (1–13).'),
      },
      outputSchema: {
        unit: z.object({
          unit_id: z.string(),
          title: z.string(),
          subject: z.string(),
          description: z.string().nullable(),
          year: z.number().nullable(),
          is_active: z.boolean(),
        }).nullable(),
      },
    },
    async ({ title, subject, description, year }) => {
      try {
        const unit = await createUnit(title, subject, description ?? null, year ?? null)
        return {
          content: [{ type: 'text' as const, text: `Created unit ${unit.unit_id} • ${unit.title} (inactive — awaiting teacher review)` }],
          structuredContent: { unit },
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to create unit'
        return {
          content: [{ type: 'text' as const, text: message }],
          structuredContent: { unit: null },
        }
      }
    },
  )

  const LESSON_DESCRIPTION_HELP = `One short sentence (at most ${LESSON_DESCRIPTION_MAX} characters) telling pupils what they will achieve in the lesson, written from its learning objectives and success criteria. Shown under the title on the pupil lesson page.`
  const lessonRecordShape = z.object({
    lesson_id: z.string(),
    unit_id: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    is_active: z.boolean(),
    order_index: z.number(),
  })

  srv.registerTool(
    'create_lesson',
    {
      title: 'Create lesson',
      description: 'Create a new lesson under a unit. Appended at the end of the unit\'s lesson order.',
      inputSchema: {
        unit_id: z.string().min(1).describe('Unit identifier.'),
        title: z.string().min(1).describe('Lesson title.'),
        description: z.string().max(LESSON_DESCRIPTION_MAX).optional().describe(LESSON_DESCRIPTION_HELP),
      },
      outputSchema: {
        lesson: lessonRecordShape.nullable(),
      },
    },
    async ({ unit_id, title, description }) => {
      try {
        const lesson = await createLesson(unit_id, title, description)
        return {
          content: [{ type: 'text' as const, text: `Created lesson ${lesson.lesson_id} • ${lesson.title} in unit ${unit_id}` }],
          structuredContent: { lesson },
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to create lesson'
        return {
          content: [{ type: 'text' as const, text: message }],
          structuredContent: { lesson: null },
        }
      }
    },
  )

  srv.registerTool(
    'update_unit',
    {
      title: 'Update unit',
      description: 'Change a unit\'s title and/or description. Omitted fields are left unchanged; an empty description clears it.',
      inputSchema: {
        unit_id: z.string().min(1).describe('Unit identifier.'),
        title: z.string().optional().describe('New unit title.'),
        description: z.string().optional().describe('New description. Pass "" to clear it.'),
      },
      outputSchema: {
        unit: z.object({
          unit_id: z.string(),
          title: z.string(),
          subject: z.string(),
          description: z.string().nullable(),
          year: z.number().nullable(),
          is_active: z.boolean(),
        }).nullable(),
      },
    },
    async ({ unit_id, title, description }) => {
      try {
        const unit = await updateUnit(unit_id, { title, description })
        return {
          content: [{ type: 'text' as const, text: `Updated unit ${unit.unit_id} • ${unit.title}` }],
          structuredContent: { unit },
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to update unit'
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          structuredContent: { unit: null },
        }
      }
    },
  )

  // Unit audits (migration 123): the status is "audited" only while nothing in
  // the unit or its lessons has changed since the audit.
  const unitAuditShape = z.object({
    unit_id: z.string(),
    unit_title: z.string(),
    subject: z.string(),
    status: z.enum(['audited', 'failed', 'not_audited']),
    last_result: z.enum(['passed', 'failed']).nullable(),
    audited_at: z.string().nullable(),
    audited_by: z.string().nullable(),
    changed_at: z.string().nullable(),
    actions: z.array(z.object({
      action: z.string(),
      lesson_id: z.string().nullable(),
      lesson_title: z.string().nullable(),
    })),
  })
  const toUnitAuditOutput = (audit: UnitAudit) => ({
    unit_id: audit.unitId,
    unit_title: audit.unitTitle,
    subject: audit.subject,
    status: audit.status,
    last_result: audit.lastResult,
    audited_at: audit.auditedAt,
    audited_by: audit.auditedBy,
    changed_at: audit.changedAt,
    actions: audit.actions.map((item) => ({ action: item.action, lesson_id: item.lessonId, lesson_title: item.lessonTitle })),
  })
  const describeAudit = (audit: UnitAudit) => {
    const date = audit.auditedAt ? audit.auditedAt.slice(0, 10) : null
    if (audit.status === 'audited') return `${audit.unitTitle}: audited ${date}`
    if (audit.status === 'failed') return `${audit.unitTitle}: audit failed ${date}, ${audit.actions.length} action(s)`
    return audit.auditedAt
      ? `${audit.unitTitle}: not audited (changed since the ${audit.lastResult} audit of ${date})`
      : `${audit.unitTitle}: not audited`
  }

  srv.registerTool(
    'get_unit_audit',
    {
      title: 'Get unit audit',
      description: 'Return a unit\'s audit status: "audited" (passed, nothing changed since), "failed" (with the actions to fix), '
        + 'or "not_audited" (never audited, or the unit or its lessons changed since the last audit). '
        + 'After a change, last_result, audited_at and the actions of the last audit are still returned.',
      inputSchema: {
        unit_id: z.string().min(1).describe('Unit identifier.'),
      },
      outputSchema: { audit: unitAuditShape.nullable() },
    },
    async ({ unit_id }) => {
      const audit = await withDbClient((client) => readUnitAudit(client, unit_id))
      if (!audit) {
        return {
          content: [{ type: 'text' as const, text: `Unit ${unit_id} was not found.` }],
          structuredContent: { audit: null },
        }
      }
      return {
        content: [{ type: 'text' as const, text: describeAudit(audit) }],
        structuredContent: { audit: toUnitAuditOutput(audit) },
      }
    },
  )

  srv.registerTool(
    'list_unit_audits',
    {
      title: 'List unit audits',
      description: 'Return the audit status of every active unit, optionally filtered by subject, curriculum or status. '
        + 'Use status "not_audited" to find units that need auditing.',
      inputSchema: {
        subject: z.string().min(1).optional().describe('Only units of this subject.'),
        curriculum_id: z.string().min(1).optional().describe('Only units linked to this curriculum.'),
        status: z.enum(['audited', 'failed', 'not_audited']).optional().describe('Only units with this status.'),
      },
      outputSchema: { audits: z.array(unitAuditShape) },
    },
    async ({ subject, curriculum_id, status }) => {
      const audits = await withDbClient((client) =>
        listUnitAudits(client, { subject: subject ?? null, curriculumId: curriculum_id ?? null, status: status ?? null }),
      )
      return {
        content: [{
          type: 'text' as const,
          text: audits.length > 0 ? audits.map(describeAudit).join('\n') : 'No units match.',
        }],
        structuredContent: { audits: audits.map(toUnitAuditOutput) },
      }
    },
  )

  srv.registerTool(
    'record_unit_audit',
    {
      title: 'Record unit audit',
      description: 'Record the result of auditing a unit and its lessons. "passed" marks the unit audited with today\'s date '
        + 'and takes no actions. "failed" needs at least one action, each saying what to fix and, where it concerns one lesson, '
        + 'that lesson\'s id. The actions replace those of any earlier audit. Any later change to the unit or its lessons makes '
        + 'it not audited again. Pass started_at (when you began reading the unit) so that an edit made while you were auditing '
        + 'is not hidden; make your own fixes before that time, or audit again after them.',
      inputSchema: z.object({
        unit_id: z.string().min(1).describe('Unit identifier.'),
        result: z.enum(['passed', 'failed']).describe('The audit outcome.'),
        actions: z.preprocess(
          (v) => (typeof v === 'string' ? JSON.parse(v) : v),
          z.array(z.object({
            action: z.string().min(1).describe('What must change, e.g. "Add an STQ checking the LO".'),
            lesson_id: z.string().min(1).optional().describe('The lesson the action concerns; omit for the unit as a whole.'),
          })).max(MAX_AUDIT_ACTIONS),
        ).optional().describe('Why the audit failed: one entry per thing to fix. Omit for a pass.'),
        started_at: z.string().optional().describe('ISO time you started reading the unit for this audit. Defaults to now.'),
      }),
      outputSchema: z.object({ audit: unitAuditShape.nullable() }),
    },
    async ({ unit_id, result, actions, started_at }) => {
      try {
        const audit = await withDbClient((client) =>
          recordUnitAudit(
            client,
            { unitId: unit_id, result, actions: actions ?? [], startedAt: started_at ?? null },
            { userId: caller.userId, clientId: caller.clientId },
          ),
        )
        return {
          content: [{ type: 'text' as const, text: `Recorded. ${describeAudit(audit)}` }],
          structuredContent: { audit: toUnitAuditOutput(audit) },
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to record the audit'
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          structuredContent: { audit: null },
        }
      }
    },
  )

  srv.registerTool(
    'update_lesson',
    {
      title: 'Update lesson',
      description: 'Change a lesson\'s title and/or description. Omitted fields are left unchanged; an empty description clears it. '
        + 'The description is one short sentence for pupils on what they will achieve, written from the lesson\'s learning objectives and success criteria '
        + '(read them with get_lesson_objectives, which also returns the current description).',
      inputSchema: {
        lesson_id: z.string().min(1).describe('Lesson identifier.'),
        title: z.string().min(1).optional().describe('New lesson title.'),
        description: z.string().max(LESSON_DESCRIPTION_MAX).optional().describe(`${LESSON_DESCRIPTION_HELP} Pass "" to clear it.`),
      },
      outputSchema: {
        lesson: lessonRecordShape.nullable(),
      },
    },
    async ({ lesson_id, title, description }) => {
      try {
        const lesson = await updateLesson(lesson_id, { title, description })
        return {
          content: [{
            type: 'text' as const,
            text: `Updated lesson ${lesson.lesson_id} • ${lesson.title}${lesson.description ? ` — ${lesson.description}` : ''}`,
          }],
          structuredContent: { lesson },
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to update lesson'
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          structuredContent: { lesson: null },
        }
      }
    },
  )

  // Sub units group a unit's lessons for planning (migration 126). Structure
  // only: reports and progress never read them. The rules are in
  // src/lib/sub-units/store.ts, shared with the unit page.
  const subUnitShape = z.object({
    sub_unit_id: z.string(),
    unit_id: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    active: z.boolean(),
  })
  const subUnitError = (error: unknown, fallback: string) =>
    error instanceof z.ZodError ? error.issues[0]?.message ?? fallback : error instanceof Error ? error.message : fallback

  srv.registerTool(
    'list_sub_units',
    {
      title: 'List sub units in a unit',
      description: 'Return a unit\'s sub units, active and inactive, each with its lessons in the unit\'s order. '
        + 'A sub unit groups lessons for planning and is a section heading for pupils on My Units; it does not affect reports or progress. '
        + 'Lessons in no sub unit are not listed here; get_lessons_for_unit lists every lesson with its sub_unit_id.',
      inputSchema: {
        unit_id: z.string().min(1).describe('Unit identifier.'),
      },
      outputSchema: {
        sub_units: z.array(subUnitShape.extend({
          lessons: z.array(z.object({
            lesson_id: z.string(),
            title: z.string(),
            is_active: z.boolean(),
            order_index: z.number(),
          })),
        })).nullable(),
      },
    },
    async ({ unit_id }) => {
      try {
        const subUnits = await listSubUnitsWithLessons(unit_id)
        return {
          content: [{
            type: 'text' as const,
            text: subUnits.length
              ? subUnits.map((su) => `${su.sub_unit_id} • ${su.title}${su.active ? '' : ' (inactive)'} — ${su.lessons.length} lessons`).join('\n')
              : `No sub units in unit ${unit_id}.`,
          }],
          structuredContent: { sub_units: subUnits },
        }
      } catch (error) {
        const message = subUnitError(error, 'Failed to list sub units')
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], structuredContent: { sub_units: null } }
      }
    },
  )

  srv.registerTool(
    'create_sub_unit',
    {
      title: 'Create a sub unit',
      description: 'Add a sub unit to a unit. It starts empty and active; put lessons in it with set_lesson_sub_unit.',
      inputSchema: {
        unit_id: z.string().min(1).describe('Unit identifier.'),
        title: z.string().min(1).max(255).describe('Sub unit title, e.g. "Polymers".'),
        description: z.string().max(LESSON_DESCRIPTION_MAX).optional().describe('Optional. What this part of the unit covers.'),
      },
      outputSchema: { sub_unit: subUnitShape.nullable() },
    },
    async ({ unit_id, title, description }) => {
      try {
        const subUnit = await createSubUnit(unit_id, title, description)
        return {
          content: [{ type: 'text' as const, text: `Created sub unit ${subUnit.sub_unit_id} • ${subUnit.title}` }],
          structuredContent: { sub_unit: subUnit },
        }
      } catch (error) {
        const message = subUnitError(error, 'Failed to create sub unit')
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], structuredContent: { sub_unit: null } }
      }
    },
  )

  srv.registerTool(
    'update_sub_unit',
    {
      title: 'Update a sub unit',
      description: 'Change a sub unit\'s title or description, or switch it on or off. Omitted fields are left unchanged; an empty description clears it. '
        + 'Switching it off (active: false) needs lessons: "ungroup" returns its lessons to the unit, still active; '
        + '"deactivate" makes its lessons inactive too and keeps them in the sub unit. Switching it back on does not reactivate lessons.',
      inputSchema: {
        sub_unit_id: z.string().min(1).describe('Sub unit identifier (from list_sub_units).'),
        title: z.string().min(1).max(255).optional(),
        description: z.string().max(LESSON_DESCRIPTION_MAX).optional().describe('Pass "" to clear it.'),
        active: z.boolean().optional(),
        lessons: z.enum(['ungroup', 'deactivate']).optional()
          .describe('Required when switching the sub unit off: what happens to its lessons.'),
      },
      outputSchema: { sub_unit: subUnitShape.nullable() },
    },
    async ({ sub_unit_id, title, description, active, lessons }) => {
      try {
        if (title === undefined && description === undefined && active === undefined) {
          throw new Error('Nothing to change: pass title, description and/or active.')
        }
        let subUnit = title !== undefined || description !== undefined
          ? await updateSubUnit(sub_unit_id, { title, description })
          : null
        if (active !== undefined) {
          if (!active && !lessons) {
            throw new Error('Switching a sub unit off needs lessons: "ungroup" (return them to the unit) or "deactivate" (make them inactive).')
          }
          subUnit = await setSubUnitActive(sub_unit_id, active, lessons ?? 'ungroup')
        }
        return {
          content: [{ type: 'text' as const, text: `Updated sub unit ${subUnit!.sub_unit_id} • ${subUnit!.title}${subUnit!.active ? '' : ' (inactive)'}` }],
          structuredContent: { sub_unit: subUnit },
        }
      } catch (error) {
        const message = subUnitError(error, 'Failed to update sub unit')
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], structuredContent: { sub_unit: null } }
      }
    },
  )

  srv.registerTool(
    'set_lesson_sub_unit',
    {
      title: 'Put a lesson in a sub unit',
      description: 'Put a lesson in a sub unit of its own unit, or take it out with sub_unit_id null. '
        + 'It joins at the end of the sub unit; taken out, it sits just after the sub unit. Lessons do not have to be in a sub unit. '
        + 'Returns the unit\'s lessons in their new order.',
      inputSchema: {
        lesson_id: z.string().min(1).describe('Lesson identifier.'),
        sub_unit_id: z.string().min(1).nullable().describe('Sub unit identifier, or null to return the lesson to the unit.'),
      },
      outputSchema: {
        lessons: z.array(z.object({
          lesson_id: z.string(),
          unit_id: z.string(),
          title: z.string(),
          description: z.string().nullable(),
          is_active: z.boolean(),
          order_index: z.number(),
          sub_unit_id: z.string().nullable(),
        })).nullable(),
      },
    },
    async ({ lesson_id, sub_unit_id }) => {
      try {
        const { unit_id } = await setLessonSubUnit(lesson_id, sub_unit_id)
        const lessons = await listLessonsForUnit(unit_id)
        return {
          content: [{
            type: 'text' as const,
            text: lessons.map((l, i) => `${i + 1}. ${l.title}${l.sub_unit_id ? ` [${l.sub_unit_id}]` : ''}${l.is_active ? '' : ' (inactive)'}`).join('\n'),
          }],
          structuredContent: { lessons },
        }
      } catch (error) {
        const message = subUnitError(error, 'Failed to set the lesson\'s sub unit')
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], structuredContent: { lessons: null } }
      }
    },
  )

  srv.registerTool(
    'add_success_criterion_to_lesson',
    {
      title: 'Add success criterion to lesson',
      description: 'Links a success criterion to a lesson. The parent learning objective is automatically linked to the lesson too if not already present.',
      inputSchema: z.object({
        lesson_id: z.string().describe('UUID of the lesson'),
        success_criteria_id: z.string().describe('UUID of the success criterion to link'),
      }),
      outputSchema: z.object({
        link: z.object({
          lesson_id: z.string(),
          success_criteria_id: z.string(),
          learning_objective_id: z.string(),
          lo_already_linked: z.boolean(),
          sc_already_linked: z.boolean(),
        }).nullable(),
      }),
    },
    async ({ lesson_id, success_criteria_id }) => {
      try {
        const link = await addSuccessCriterionToLesson(lesson_id, success_criteria_id)
        const scNote = link.sc_already_linked ? ' (SC already linked)' : ''
        const loNote = link.lo_already_linked ? ' (LO already linked)' : ' — LO auto-linked'
        return {
          content: [{ type: 'text' as const, text: `Linked SC ${success_criteria_id} to lesson ${lesson_id}${scNote}${loNote}` }],
          structuredContent: { link },
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          structuredContent: { link: null },
        }
      }
    },
  )

  srv.registerTool(
    'list_assessment_objectives',
    {
      title: 'List assessment objectives',
      description: 'List the assessment objectives (AOs) of a curriculum in display order, with how many active learning objectives sit under each. Use create_assessment_objective to add one and update_assessment_objective to edit one; AOs cannot be deleted.',
      inputSchema: {
        curriculum_id: z.string().min(1).describe('UUID of the curriculum'),
      },
      outputSchema: {
        assessment_objectives: z.array(z.object({
          assessment_objective_id: z.string(),
          curriculum_id: z.string(),
          code: z.string(),
          title: z.string(),
          order_index: z.number(),
          learning_objective_count: z.number(),
        })).nullable(),
      },
    },
    async ({ curriculum_id }) => {
      try {
        const assessment_objectives = await listAssessmentObjectives(curriculum_id)
        const lines = assessment_objectives.map((ao) => `${ao.code}: ${ao.title} (id: ${ao.assessment_objective_id}, ${ao.learning_objective_count} LOs)`)
        return {
          content: [{ type: 'text' as const, text: lines.length > 0 ? lines.join('\n') : `Curriculum ${curriculum_id} has no assessment objectives.` }],
          structuredContent: { assessment_objectives },
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to list assessment objectives'
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          structuredContent: { assessment_objectives: null },
        }
      }
    },
  )

  srv.registerTool(
    'create_assessment_objective',
    {
      title: 'Create assessment objective',
      description: 'Create a new assessment objective under a curriculum.',
      inputSchema: z.object({
        curriculum_id: z.string().describe('UUID of the curriculum'),
        code: z.string().describe('Short code for the AO, e.g. "AO1"'),
        title: z.string().describe('Title of the assessment objective'),
      }),
      outputSchema: z.object({
        assessment_objective: z.object({
          assessment_objective_id: z.string(),
          curriculum_id: z.string(),
          code: z.string(),
          title: z.string(),
          order_index: z.number(),
        }).nullable(),
      }),
    },
    async ({ curriculum_id, code, title }) => {
      try {
        const ao = await createAssessmentObjective(curriculum_id, code, title)
        return {
          content: [{ type: 'text' as const, text: `Created assessment objective "${ao.code}: ${ao.title}" (id: ${ao.assessment_objective_id})` }],
          structuredContent: { assessment_objective: ao },
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          structuredContent: { assessment_objective: null },
        }
      }
    },
  )

  srv.registerTool(
    'create_learning_objective',
    {
      title: 'Create learning objective',
      description: 'Create a new learning objective under an assessment objective.',
      inputSchema: {
        assessment_objective_id: z.string().min(1).describe('Assessment objective identifier.'),
        title: z.string().min(1).describe('Learning objective title.'),
        spec_ref: z.string().optional().describe('Optional specification reference.'),
      },
      outputSchema: {
        learning_objective: z.object({
          learning_objective_id: z.string(),
          assessment_objective_id: z.string(),
          title: z.string(),
          spec_ref: z.string().nullable(),
          active: z.boolean(),
          order_index: z.number(),
        }).nullable(),
      },
    },
    async ({ assessment_objective_id, title, spec_ref }) => {
      try {
        const learning_objective = await createLearningObjective(assessment_objective_id, title, spec_ref ?? null)
        return {
          content: [{ type: 'text' as const, text: `Created learning objective ${learning_objective.learning_objective_id} • ${learning_objective.title}` }],
          structuredContent: { learning_objective },
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to create learning objective'
        return {
          content: [{ type: 'text' as const, text: message }],
          structuredContent: { learning_objective: null },
        }
      }
    },
  )

  srv.registerTool(
    'create_success_criterion',
    {
      title: 'Create success criterion',
      description: 'Create a new success criterion under a learning objective.',
      inputSchema: {
        learning_objective_id: z.string().min(1).describe('Learning objective identifier.'),
        description: z.string().min(1).describe('Success criterion description.'),
        level: z.number().int().min(1).max(9).describe('Level (1–9).'),
      },
      outputSchema: {
        success_criterion: z.object({
          success_criteria_id: z.string(),
          learning_objective_id: z.string(),
          description: z.string(),
          level: z.number(),
          order_index: z.number(),
          active: z.boolean(),
        }).nullable(),
      },
    },
    async ({ learning_objective_id, description, level }) => {
      try {
        const success_criterion = await createSuccessCriterion(learning_objective_id, description, level)
        return {
          content: [{ type: 'text' as const, text: `Created success criterion ${success_criterion.success_criteria_id} (level ${success_criterion.level})` }],
          structuredContent: { success_criterion },
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to create success criterion'
        return {
          content: [{ type: 'text' as const, text: message }],
          structuredContent: { success_criterion: null },
        }
      }
    },
  )

  srv.registerTool(
    'update_assessment_objective',
    {
      title: 'Update assessment objective',
      description: 'Update an assessment objective. Omitted fields keep their current value.',
      inputSchema: {
        assessment_objective_id: z.string().min(1).describe('Assessment objective identifier.'),
        code: z.string().min(1).optional().describe('New code (e.g. AO1).'),
        title: z.string().min(1).optional().describe('New title.'),
        order_index: z.coerce.number().int().min(0).optional().describe('New display position (0 = first).'),
      },
      outputSchema: {
        assessment_objective: z.object({
          assessment_objective_id: z.string(),
          curriculum_id: z.string(),
          code: z.string(),
          title: z.string(),
          order_index: z.number(),
        }).nullable(),
      },
    },
    async ({ assessment_objective_id, code, title, order_index }) => {
      try {
        const assessment_objective = await updateAssessmentObjective(assessment_objective_id, { code: code ?? null, title: title ?? null, orderIndex: order_index ?? null })
        return {
          content: [{ type: 'text' as const, text: `Updated assessment objective ${assessment_objective.assessment_objective_id} • ${assessment_objective.code} ${assessment_objective.title}` }],
          structuredContent: { assessment_objective },
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to update assessment objective'
        return {
          content: [{ type: 'text' as const, text: message }],
          structuredContent: { assessment_objective: null },
        }
      }
    },
  )

  srv.registerTool(
    'update_learning_objective',
    {
      title: 'Update learning objective',
      description: 'Update a learning objective. Omitted fields keep their current value.',
      inputSchema: {
        learning_objective_id: z.string().min(1).describe('Learning objective identifier.'),
        title: z.string().min(1).optional().describe('New title.'),
        spec_ref: z.string().min(1).optional().describe('New specification reference.'),
        active: z.boolean().optional().describe('Set false to deactivate, true to reactivate.'),
      },
      outputSchema: {
        learning_objective: z.object({
          learning_objective_id: z.string(),
          assessment_objective_id: z.string(),
          title: z.string(),
          spec_ref: z.string().nullable(),
          active: z.boolean(),
          order_index: z.number(),
        }).nullable(),
      },
    },
    async ({ learning_objective_id, title, spec_ref, active }) => {
      try {
        const learning_objective = await updateLearningObjective(learning_objective_id, { title: title ?? null, specRef: spec_ref ?? null, active: active ?? null })
        return {
          content: [{ type: 'text' as const, text: `Updated learning objective ${learning_objective.learning_objective_id} • ${learning_objective.title}` }],
          structuredContent: { learning_objective },
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to update learning objective'
        return {
          content: [{ type: 'text' as const, text: message }],
          structuredContent: { learning_objective: null },
        }
      }
    },
  )

  srv.registerTool(
    'update_success_criterion',
    {
      title: 'Update success criterion',
      description: 'Update a success criterion. Omitted fields keep their current value. '
        + 'learning_objective_id moves the criterion to another LO in the same curriculum, keeping its lesson and activity links and pupils\' marks; '
        + 'each lesson linking the criterion gets the new LO linked (lessons_linked_to_new_lo). The old LO stays linked to those lessons: remove it with remove_learning_objective_from_lesson if nothing else there uses it.',
      inputSchema: {
        success_criteria_id: z.string().min(1).describe('Success criterion identifier.'),
        description: z.string().min(1).optional().describe('New description.'),
        level: z.number().int().min(1).max(9).optional().describe('New level (1–9).'),
        active: z.boolean().optional().describe('Set false to deactivate, true to reactivate.'),
        learning_objective_id: z.string().min(1).optional().describe('Move the criterion to this learning objective (same curriculum).'),
      },
      outputSchema: {
        success_criterion: z.object({
          success_criteria_id: z.string(),
          learning_objective_id: z.string(),
          description: z.string(),
          level: z.number(),
          order_index: z.number(),
          active: z.boolean(),
          lessons_linked_to_new_lo: z.array(z.string()),
        }).nullable(),
      },
    },
    async ({ success_criteria_id, description, level, active, learning_objective_id }) => {
      try {
        const success_criterion = await updateSuccessCriterion(success_criteria_id, {
          description: description ?? null,
          level: level ?? null,
          active: active ?? null,
          learningObjectiveId: learning_objective_id ?? null,
        })
        return {
          content: [{ type: 'text' as const, text: `Updated success criterion ${success_criterion.success_criteria_id} (level ${success_criterion.level}, LO ${success_criterion.learning_objective_id})` }],
          structuredContent: { success_criterion },
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to update success criterion'
        return {
          content: [{ type: 'text' as const, text: message }],
          structuredContent: { success_criterion: null },
        }
      }
    },
  )

  srv.registerTool(
    'delete_learning_objective',
    {
      title: 'Delete learning objective',
      description: 'Soft-delete a learning objective (sets active=false). Pupil work referencing it is preserved.',
      inputSchema: {
        learning_objective_id: z.string().min(1).describe('Learning objective identifier.'),
      },
      outputSchema: {
        learning_objective: z.object({
          learning_objective_id: z.string(),
          active: z.boolean(),
        }).nullable(),
      },
    },
    async ({ learning_objective_id }) => {
      try {
        const lo = await deactivateLearningObjective(learning_objective_id)
        return {
          content: [{ type: 'text' as const, text: `Deactivated learning objective ${lo.learning_objective_id}` }],
          structuredContent: { learning_objective: { learning_objective_id: lo.learning_objective_id, active: lo.active } },
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to delete learning objective'
        return {
          content: [{ type: 'text' as const, text: message }],
          structuredContent: { learning_objective: null },
        }
      }
    },
  )

  srv.registerTool(
    'delete_success_criterion',
    {
      title: 'Delete success criterion',
      description: 'Soft-delete a success criterion (sets active=false). Pupil work referencing it is preserved.',
      inputSchema: {
        success_criteria_id: z.string().min(1).describe('Success criterion identifier.'),
      },
      outputSchema: {
        success_criterion: z.object({
          success_criteria_id: z.string(),
          active: z.boolean(),
        }).nullable(),
      },
    },
    async ({ success_criteria_id }) => {
      try {
        const sc = await deactivateSuccessCriterion(success_criteria_id)
        return {
          content: [{ type: 'text' as const, text: `Deactivated success criterion ${sc.success_criteria_id}` }],
          structuredContent: { success_criterion: { success_criteria_id: sc.success_criteria_id, active: sc.active } },
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to delete success criterion'
        return {
          content: [{ type: 'text' as const, text: message }],
          structuredContent: { success_criterion: null },
        }
      }
    },
  )

  srv.registerTool(
    'remove_success_criterion_from_lesson',
    {
      title: 'Remove success criterion from lesson',
      description: 'Unlink a success criterion from a lesson (removes the link only; the criterion itself is untouched).',
      inputSchema: {
        lesson_id: z.string().min(1).describe('Lesson identifier.'),
        success_criteria_id: z.string().min(1).describe('Success criterion identifier.'),
      },
      outputSchema: {
        lesson_id: z.string(),
        success_criteria_id: z.string(),
        removed: z.boolean(),
      },
    },
    async ({ lesson_id, success_criteria_id }) => {
      try {
        const result = await removeSuccessCriterionFromLesson(lesson_id, success_criteria_id)
        return {
          content: [{ type: 'text' as const, text: result.removed ? `Unlinked success criterion ${success_criteria_id} from lesson ${lesson_id}` : `No link existed between success criterion ${success_criteria_id} and lesson ${lesson_id}` }],
          structuredContent: result,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to remove success criterion from lesson'
        return {
          content: [{ type: 'text' as const, text: message }],
          structuredContent: { lesson_id, success_criteria_id, removed: false },
        }
      }
    },
  )

  srv.registerTool(
    'remove_learning_objective_from_lesson',
    {
      title: 'Remove learning objective from lesson',
      description: 'Unlink a learning objective from a lesson, together with the lesson\'s links to that LO\'s success criteria (a criterion left linked would show the LO again). '
        + 'The LO itself is untouched. Activities in the lesson still linked to one of its criteria are listed in activities_still_linked and keep the LO showing in get_lesson_objectives; '
        + 'unlink them with remove_success_criterion_from_activity if they should go too.',
      inputSchema: {
        lesson_id: z.string().min(1).describe('Lesson identifier.'),
        learning_objective_id: z.string().min(1).describe('Learning objective identifier.'),
      },
      outputSchema: {
        result: z.object({
          lesson_id: z.string(),
          learning_objective_id: z.string(),
          removed: z.boolean(),
          success_criteria_unlinked: z.array(z.string()),
          activities_still_linked: z.array(z.object({
            activity_id: z.string(),
            title: z.string().nullable(),
            success_criteria_id: z.string(),
          })),
        }).nullable(),
      },
    },
    async ({ lesson_id, learning_objective_id }) => {
      try {
        const result = await removeLearningObjectiveFromLesson(lesson_id, learning_objective_id)
        const still = result.activities_still_linked.length
        const text = !result.removed
          ? `Lesson ${lesson_id} did not link learning objective ${learning_objective_id}`
          : `Unlinked learning objective ${learning_objective_id} from lesson ${lesson_id}`
            + (result.success_criteria_unlinked.length ? `, with ${result.success_criteria_unlinked.length} of its success criteria` : '')
            + (still ? `. ${still} activity link(s) to its criteria remain` : '')
        return { content: [{ type: 'text' as const, text }], structuredContent: { result } }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to remove learning objective from lesson'
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], structuredContent: { result: null } }
      }
    },
  )

  srv.registerTool(
    'remove_success_criterion_from_activity',
    {
      title: 'Remove success criterion from activity',
      description: 'Unlink a success criterion from an activity (removes the link only; the criterion itself is untouched).',
      inputSchema: {
        activity_id: z.string().min(1).describe('Activity identifier.'),
        success_criteria_id: z.string().min(1).describe('Success criterion identifier.'),
      },
      outputSchema: {
        activity_id: z.string(),
        success_criteria_id: z.string(),
        removed: z.boolean(),
      },
    },
    async ({ activity_id, success_criteria_id }) => {
      try {
        const result = await removeSuccessCriterionFromActivity(activity_id, success_criteria_id)
        return {
          content: [{ type: 'text' as const, text: result.removed ? `Unlinked success criterion ${success_criteria_id} from activity ${activity_id}` : `No link existed between success criterion ${success_criteria_id} and activity ${activity_id}` }],
          structuredContent: result,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to remove success criterion from activity'
        return {
          content: [{ type: 'text' as const, text: message }],
          structuredContent: { activity_id, success_criteria_id, removed: false },
        }
      }
    },
  )

  srv.registerTool(
    'get_activities_for_lesson',
    {
      title: 'List activities for a lesson',
      description: 'Return all active activities for a given lesson.',
      inputSchema: {
        lesson_id: z.string().min(1).describe('Lesson identifier.'),
      },
      outputSchema: {
        activities: z.array(z.object({
          activity_id: z.string(),
          lesson_id: z.string(),
          title: z.string().nullable(),
          type: z.string(),
          order_index: z.number().nullable(),
          is_summative: z.boolean(),
          active: z.boolean(),
        })),
      },
    },
    async ({ lesson_id }) => {
      const activities = await listActivitiesForLesson(lesson_id)
      return {
        content: [
          {
            type: 'text' as const,
            text: activities.length > 0
              ? activities.map((a) => `${a.activity_id} • ${a.type}${a.title ? ` — ${a.title}` : ''}`).join('\n')
              : `No activities found for lesson ${lesson_id}.`,
          },
        ],
        structuredContent: { activities },
      }
    },
  )

  srv.registerTool(
    'get_activity',
    {
      title: 'Get an activity',
      description: 'Return one activity in full, including its body_data (the text of a Display Text activity, a question and model answer, '
        + 'MCQ options, flashcards, …), teacher notes, max marks and linked success criteria. '
        + 'To change part of body_data, pass only those fields to update_activity (question, model_answer, mcq_options, correct_option_id or body_data_patch) rather than resending it.',
      inputSchema: {
        activity_id: z.string().min(1).describe('Activity identifier (from get_activities_for_lesson).'),
      },
      outputSchema: {
        activity: z.object({
          activity_id: z.string(),
          lesson_id: z.string(),
          title: z.string().nullable(),
          type: z.string(),
          order_index: z.number().nullable(),
          is_summative: z.boolean(),
          active: z.boolean(),
          body_data: z.unknown(),
          notes: z.string().nullable(),
          max_marks: z.number().nullable(),
          success_criteria: z.array(z.object({
            success_criteria_id: z.string(),
            description: z.string().nullable(),
            sc_type: z.string().nullable(),
          })),
        }).nullable(),
      },
    },
    async ({ activity_id }) => {
      try {
        const activity = await getActivity(activity_id)
        return {
          content: [{ type: 'text' as const, text: `${activity.activity_id} • ${activity.type}${activity.title ? ` — ${activity.title}` : ''}` }],
          structuredContent: { activity },
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to read activity'
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          structuredContent: { activity: null },
        }
      }
    },
  )

  // A body_data the app cannot use is a real failure, not an empty result, so
  // it is flagged isError with a machine-readable code and the limit broken.
  const activityBodyErrorShape = z.object({
    code: z.string(),
    field: z.string(),
    limit: z.number().nullable(),
    received: z.number().nullable(),
  })
  const activityErrorResult = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    if (err instanceof ActivityBodyDataError) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `Error ${message}` }],
        structuredContent: {
          activity: null,
          error: { code: err.code, field: err.field, limit: err.limit, received: err.received },
        },
      }
    }
    return {
      content: [{ type: 'text' as const, text: `Error: ${message}` }],
      structuredContent: { activity: null },
    }
  }

  srv.registerTool(
    'create_activity',
    {
      title: 'Create activity',
      description: `Create a new activity under a lesson. Type-specific requirements:
- short-text-question: provide question and model_answer (required).
- multiple-choice-question: provide question, mcq_options (2–4 items), and correct_option_id matching one option id (required).
- text: body_data must be { "text": "<markdown content>", "displayType"?: "default" | "exam-tip" }.
- group-items: body_data { "groups": 2–4 × { "id", "name" }, "items": 2–12 × { "id", "text", "groupId" } }.
- matcher: body_data { "pairs": 2–8 × { "id", "term", "definition" } }.
- sequence: body_data { "terms": 2–12 × { "id", "text" } }, in the correct order.
- display-webpage: body_data { "url"?: "https://…" } for a link. To show an HTML page, create the activity, then upload one .html file to it; the upload sets body_data.htmlFile.
- All other types: use body_data for any extra JSON payload.
max_marks sets the marks the activity is out of, e.g. 6 for a "(6 marks)" question. Omitted, a short-text-question is out of 3 and every other type out of 1. It is refused for non-scorable types and for matcher and group-items, which are worth one mark per pair or item. Linking success criteria later replaces it with the marks the criteria are worth.
A body_data over a limit is refused with isError and error.code LIMIT_EXCEEDED (BELOW_MINIMUM or INVALID_BODY_DATA for other problems), naming the field, the limit and the count received. Split the content across several activities.`,
      inputSchema: z.object({
        lesson_id: z.string().min(1).describe('Lesson identifier.'),
        type: z.enum(ACTIVITY_TYPES).describe(
          'Activity type. Scorable: multiple-choice-question, short-text-question, text-question, long-text-question, upload-file, upload-url, feedback, sketch-render, group-items, matcher, sequence. Non-scorable: text, display-image, display-webpage, display-flashcards, file-download, show-video, voice, share-my-work, review-others-work, display-section. do-flashcards is legacy and cannot be created.',
        ),
        title: z.string().optional().describe('Optional activity title.'),
        question: z.string().optional().describe('Question text — required for short-text-question and multiple-choice-question.'),
        model_answer: z.string().optional().describe('Model answer — required for short-text-question.'),
        mcq_options: z.preprocess(
          (v) => (typeof v === 'string' ? JSON.parse(v) : v),
          z.array(z.object({
            id: z.string().describe('Unique option identifier, e.g. "a", "b", "c".'),
            text: z.string().describe('Option text shown to the pupil.'),
          })),
        ).optional().describe('Answer options — required for multiple-choice-question. Provide 2–4 items.'),
        correct_option_id: z.string().optional().describe('id of the correct option — required for multiple-choice-question.'),
        body_data: z.record(z.string(), z.unknown()).optional().describe('Generic body JSON for other activity types.'),
        is_summative: z.boolean().optional().describe('Mark as summative assessment (scorable types only).'),
        max_marks: z.coerce.number().int().min(1).optional().describe('Marks available (scorable types only, not matcher or group-items). Defaults: short-text-question 3, others 1.'),
      }),
      outputSchema: z.object({
        activity: z.object({
          activity_id: z.string(),
          lesson_id: z.string(),
          title: z.string().nullable(),
          type: z.string(),
          order_index: z.number().nullable(),
          is_summative: z.boolean(),
          active: z.boolean(),
        }).nullable(),
        error: activityBodyErrorShape.optional(),
      }),
    },
    async ({ lesson_id, type, title, question, model_answer, mcq_options, correct_option_id, body_data, is_summative, max_marks }) => {
      try {
        let resolvedBodyData: Record<string, unknown> | null = body_data ?? null

        if (type === 'short-text-question') {
          if (!question?.trim()) return { content: [{ type: 'text' as const, text: 'Error: question is required for short-text-question' }], structuredContent: { activity: null } }
          if (!model_answer?.trim()) return { content: [{ type: 'text' as const, text: 'Error: model_answer is required for short-text-question' }], structuredContent: { activity: null } }
          resolvedBodyData = { question: question.trim(), modelAnswer: model_answer.trim() }
        } else if (type === 'multiple-choice-question') {
          if (!question?.trim()) return { content: [{ type: 'text' as const, text: 'Error: question is required for multiple-choice-question' }], structuredContent: { activity: null } }
          if (!mcq_options || mcq_options.length < 2) return { content: [{ type: 'text' as const, text: 'Error: mcq_options must have at least 2 items' }], structuredContent: { activity: null } }
          if (mcq_options.length > 4) return { content: [{ type: 'text' as const, text: 'Error: mcq_options must have at most 4 items' }], structuredContent: { activity: null } }
          if (!correct_option_id?.trim()) return { content: [{ type: 'text' as const, text: 'Error: correct_option_id is required for multiple-choice-question' }], structuredContent: { activity: null } }
          if (!mcq_options.some((o) => o.id === correct_option_id)) return { content: [{ type: 'text' as const, text: `Error: correct_option_id "${correct_option_id}" does not match any option id` }], structuredContent: { activity: null } }
          resolvedBodyData = { question: question.trim(), options: mcq_options, correctOptionId: correct_option_id }
        }

        const activity = await createActivity(lesson_id, type, title ?? null, resolvedBodyData, is_summative, max_marks)
        return {
          content: [{ type: 'text' as const, text: `Created activity ${activity.activity_id} • ${activity.type}${activity.title ? ` — ${activity.title}` : ''}` }],
          structuredContent: { activity },
        }
      } catch (error) {
        return activityErrorResult(error)
      }
    },
  )

  srv.registerTool(
    'update_activity',
    {
      title: 'Update activity',
      description: `Update an existing activity. Omitted fields are left unchanged; at least one must be given.
- title, is_summative: as on create_activity.
- Patch body_data without resending it: question, model_answer (short-text-question), mcq_options, correct_option_id (multiple-choice-question) set those fields; body_data_patch sets any other top-level fields of body_data, and a field set to null is removed. Everything else in body_data, such as images, is kept.
- body_data replaces the stored object as a whole; it cannot be combined with the patch fields.
- type changes the activity's type, refused once pupils have submitted work for it. The body must suit the new type: pass it in the same call (e.g. text → show-video with body_data { "fileUrl": "https://…" }). max_marks resets to the new type's default, or to what its success criteria are worth.
The result is checked as create_activity checks it; a body over a limit is refused with isError and error.code LIMIT_EXCEEDED.`,
      inputSchema: z.object({
        activity_id: z.string().describe('UUID of the activity to update'),
        title: z.string().nullable().optional().describe('New title (pass null to clear)'),
        type: z.enum(ACTIVITY_TYPES).optional().describe('New activity type. Refused when pupils have submitted work.'),
        question: z.string().min(1).optional().describe('New question text (short-text-question, multiple-choice-question).'),
        model_answer: z.string().min(1).optional().describe('New model answer (short-text-question).'),
        mcq_options: z.preprocess(
          (v) => (typeof v === 'string' ? JSON.parse(v) : v),
          z.array(z.object({
            id: z.string(),
            text: z.string(),
            imageUrl: z.string().nullable().optional(),
          })),
        ).optional().describe('Replacement answer options, 2–4 × { id, text } (multiple-choice-question).'),
        correct_option_id: z.string().min(1).optional().describe('id of the correct option (multiple-choice-question).'),
        body_data_patch: z.record(z.string(), z.unknown()).optional().describe('Top-level body_data fields to set; null removes a field.'),
        body_data: z.record(z.string(), z.unknown()).nullable().optional().describe('Replacement body data, as a whole (pass null to clear)'),
        is_summative: z.boolean().optional().describe('Mark or unmark as summative assessment (scorable types only)'),
      }),
      outputSchema: z.object({
        activity: z.object({
          activity_id: z.string(),
          lesson_id: z.string(),
          title: z.string().nullable(),
          type: z.string(),
          order_index: z.number(),
          is_summative: z.boolean(),
          active: z.boolean(),
        }).nullable(),
        error: activityBodyErrorShape.optional(),
      }),
    },
    async ({ activity_id, title, type, question, model_answer, mcq_options, correct_option_id, body_data_patch, body_data, is_summative }) => {
      try {
        const patch: Record<string, unknown> = { ...body_data_patch }
        if (question !== undefined) patch.question = question.trim()
        if (model_answer !== undefined) patch.modelAnswer = model_answer.trim()
        if (mcq_options !== undefined) patch.options = mcq_options
        if (correct_option_id !== undefined) patch.correctOptionId = correct_option_id

        const fields: ActivityUpdate = {}
        if (title !== undefined) fields.title = title
        if (type !== undefined) fields.type = type
        if (body_data !== undefined) fields.bodyData = body_data
        if (Object.keys(patch).length > 0) fields.bodyPatch = patch
        if (is_summative !== undefined) fields.isSummative = is_summative

        const activity = await updateActivity(activity_id, fields)
        return {
          content: [{ type: 'text' as const, text: `Updated activity ${activity_id} • ${activity.type}${activity.is_summative ? ' (summative)' : ''}` }],
          structuredContent: { activity },
        }
      } catch (err) {
        return activityErrorResult(err)
      }
    },
  )

  srv.registerTool(
    'set_activity_max_marks',
    {
      title: 'Set activity max marks',
      description: 'Set the marks an existing activity is out of, e.g. 6 for a "(6 marks)" question. '
        + 'Marks pupils already hold are rescaled with it, so full marks stay full marks. '
        + 'Refused for non-scorable types, for matcher and group-items (one mark per pair or item), and for an activity with success criteria linked, '
        + 'whose max_marks is derived from them (binary = 1, levelled = 1 per descriptor).',
      inputSchema: z.object({
        activity_id: z.string().describe('UUID of the activity'),
        max_marks: z.coerce.number().int().min(1).describe('Marks available, a whole number of at least 1.'),
      }),
      outputSchema: z.object({
        activity: z.object({
          activity_id: z.string(),
          type: z.string(),
          title: z.string().nullable(),
          previous_max_marks: z.number().nullable(),
          max_marks: z.number(),
          rescaled_submissions: z.number(),
        }).nullable(),
      }),
    },
    async ({ activity_id, max_marks }) => {
      try {
        const activity = await setActivityMaxMarks(activity_id, max_marks)
        const rescaled = activity.rescaled_submissions > 0 ? `; ${activity.rescaled_submissions} submission(s) rescaled` : ''
        return {
          content: [{ type: 'text' as const, text: `${activity.title ?? activity_id}: max_marks ${activity.previous_max_marks} → ${activity.max_marks}${rescaled}` }],
          structuredContent: { activity },
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          structuredContent: { activity: null },
        }
      }
    },
  )

  srv.registerTool(
    'add_success_criterion_to_activity',
    {
      title: 'Add success criterion to activity',
      description: 'Links a success criterion to an activity.',
      inputSchema: z.object({
        activity_id: z.string().describe('UUID of the activity'),
        success_criteria_id: z.string().describe('UUID of the success criterion to link'),
      }),
      outputSchema: z.object({
        link: z.object({
          activity_id: z.string(),
          success_criteria_id: z.string(),
          already_linked: z.boolean(),
        }).nullable(),
      }),
    },
    async ({ activity_id, success_criteria_id }) => {
      try {
        const link = await addSuccessCriterionToActivity(activity_id, success_criteria_id)
        const note = link.already_linked ? ' (already linked)' : ''
        return {
          content: [{ type: 'text' as const, text: `Linked SC ${success_criteria_id} to activity ${activity_id}${note}` }],
          structuredContent: { link },
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          structuredContent: { link: null },
        }
      }
    },
  )

  srv.registerTool(
    'remove_activity',
    {
      title: 'Remove activity from lesson',
      description: 'Permanently deletes an activity and its success criteria links from a lesson.',
      inputSchema: z.object({
        activity_id: z.string().describe('UUID of the activity to remove'),
        lesson_id: z.string().describe('UUID of the lesson the activity belongs to'),
      }),
      outputSchema: z.object({
        removed: z.object({
          activity_id: z.string(),
          lesson_id: z.string(),
        }).nullable(),
      }),
    },
    async ({ activity_id, lesson_id }) => {
      try {
        const removed = await removeActivity(activity_id, lesson_id)
        return {
          content: [{ type: 'text' as const, text: `Removed activity ${activity_id} from lesson ${lesson_id}` }],
          structuredContent: { removed },
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          structuredContent: { removed: null },
        }
      }
    },
  )

  srv.registerTool(
    'reorder_activities',
    {
      title: 'Reorder activities in a lesson',
      description: 'Set the order of a lesson\'s activities. Pass every active activity id (from get_activities_for_lesson) exactly once, first to last.',
      inputSchema: z.object({
        lesson_id: z.string().min(1).describe('UUID of the lesson.'),
        activity_ids: z.preprocess(
          (v) => (typeof v === 'string' ? JSON.parse(v) : v),
          z.array(z.string().min(1)).min(1),
        ).describe('Every active activity id in the lesson, in the new order.'),
      }),
      outputSchema: z.object({
        activities: z.array(z.object({
          activity_id: z.string(),
          lesson_id: z.string(),
          title: z.string().nullable(),
          type: z.string(),
          order_index: z.number().nullable(),
          is_summative: z.boolean(),
          active: z.boolean(),
        })).nullable(),
      }),
    },
    async ({ lesson_id, activity_ids }) => {
      try {
        const activities = await reorderActivities(lesson_id, activity_ids)
        return {
          content: [{
            type: 'text' as const,
            text: activities.map((a, i) => `${i + 1}. ${a.activity_id} • ${a.type}${a.title ? ` — ${a.title}` : ''}`).join('\n'),
          }],
          structuredContent: { activities },
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          structuredContent: { activities: null },
        }
      }
    },
  )

  srv.registerTool(
    'get_lesson_file_upload_info',
    {
      title: 'Get lesson file upload info',
      description: 'Returns the URL and form fields needed to upload a file directly to the lesson teacher file store via multipart POST — no base64 encoding required.',
      inputSchema: z.object({
        lesson_id: z.string().describe('UUID of the lesson to upload the file to'),
      }),
      outputSchema: z.object({
        upload_url: z.string(),
        method: z.string(),
        form_fields: z.record(z.string(), z.string()),
        instructions: z.string(),
      }),
    },
    async ({ lesson_id }) => {
      // Never hand out a credential here: the caller already holds one. An
      // OAuth-connected teacher must not be able to read the service key.
      const uploadUrl = `${baseUrl}/api/MCP/files/lesson`
      const result = {
        upload_url: uploadUrl,
        method: 'POST',
        form_fields: { lesson_id },
        instructions: `Send a multipart/form-data POST to upload_url. Authenticate with the same Authorization header you use for this MCP connection (the service key or your OAuth access token). Add the form_fields as form fields. Include the file under the field name "file". Max file size 5 MB.`,
      }
      return {
        content: [{ type: 'text' as const, text: `Upload to: POST ${uploadUrl}\nForm fields: lesson_id=${lesson_id}\nFile field name: file` }],
        structuredContent: result,
      }
    },
  )

  srv.registerTool(
    'get_activity_file_upload_info',
    {
      title: 'Get activity file upload info',
      description: 'Returns the URL and form fields needed to upload a file directly to a file-download, display-image or display-webpage activity via multipart POST — no base64 encoding required.',
      inputSchema: z.object({
        lesson_id: z.string().describe('UUID of the lesson'),
        activity_id: z.string().describe('UUID of the file-download, display-image or display-webpage activity'),
      }),
      outputSchema: z.object({
        upload_url: z.string(),
        method: z.string(),
        form_fields: z.record(z.string(), z.string()),
        instructions: z.string(),
      }),
    },
    async ({ lesson_id, activity_id }) => {
      // Never hand out a credential here: the caller already holds one. An
      // OAuth-connected teacher must not be able to read the service key.
      const uploadUrl = `${baseUrl}/api/MCP/files/activity`
      const result = {
        upload_url: uploadUrl,
        method: 'POST',
        form_fields: { lesson_id, activity_id },
        instructions: `Send a multipart/form-data POST to upload_url. Authenticate with the same Authorization header you use for this MCP connection (the service key or your OAuth access token). Add the form_fields as form fields. Include the file under the field name "file". Max file size 5 MB. Activity must be type file-download, display-image or display-webpage (one .html file, which replaces any earlier one).`,
      }
      return {
        content: [{ type: 'text' as const, text: `Upload to: POST ${uploadUrl}\nForm fields: lesson_id=${lesson_id}, activity_id=${activity_id}\nFile field name: file` }],
        structuredContent: result,
      }
    },
  )

  // A one-time link carries its own permission, so Claude can send a file it
  // made in its code sandbox, which has no copy of this connection's
  // credentials. The token is a credential, but a narrow one: one file, one
  // target, 15 minutes — never the service key or an access token.
  const uploadLinkOutput = z.object({
    upload_url: z.string(),
    expires_at: z.string(),
    max_bytes: z.number(),
    instructions: z.string(),
  }).nullable()
  const uploadLinkTool = async (
    target: { lessonId: string; activityId: string | null } | { assessmentId: string; pupilId: string | null },
    fileName: string | undefined,
  ) => {
    const maxBytes = 'assessmentId' in target ? ASSESSMENT_UPLOAD_MAX_BYTES : MCP_UPLOAD_MAX_BYTES
    const maxLabel = `${maxBytes / (1024 * 1024)} MB`
    try {
      const { token, expiresAt } = await createUploadLink(caller, { ...target, fileName: fileName ?? null })
      const uploadUrl = `${baseUrl}/api/MCP/upload/${token}`
      const instructions =
        `From your code sandbox, send the file to upload_url, e.g. curl -sS -F "file=@/path/to/file.pptx" "${uploadUrl}" `
        + '(or PUT/POST the raw bytes, adding ?file_name=name.ext to the URL). No Authorization header is needed. '
        + `The link works once and expires at ${expiresAt}. Max ${maxLabel}; HTML and SVG are refused. `
        + 'A JSON reply with "success": true confirms the upload. If the request cannot connect, the sandbox\'s network settings '
        + `are blocking ${new URL(uploadUrl).host}: ask the user to allow that domain in Claude's settings (Capabilities → code execution network access).`
      return {
        content: [{ type: 'text' as const, text: `Upload link (single use, expires ${expiresAt}):\n${uploadUrl}\n${instructions}` }],
        structuredContent: { link: { upload_url: uploadUrl, expires_at: expiresAt, max_bytes: maxBytes, instructions } },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create upload link'
      return {
        content: [{ type: 'text' as const, text: `Error: ${message}` }],
        structuredContent: { link: null },
      }
    }
  }

  srv.registerTool(
    'create_activity_file_upload_link',
    {
      title: 'Create a one-time upload link for an activity file',
      description: 'Best way to upload a file you have in your code sandbox (e.g. a deck you made) to a file-download, display-image or display-webpage activity. '
        + 'Returns a single-use link, valid 15 minutes, that accepts the file with a plain curl POST — no credentials, no base64. '
        + 'Create the activity first with create_activity.',
      inputSchema: z.object({
        lesson_id: z.string().describe('UUID of the lesson'),
        activity_id: z.string().describe('UUID of the file-download, display-image or display-webpage activity'),
        file_name: z.string().optional().describe('Name to store the file under, including extension. Defaults to the uploaded file\'s name.'),
      }),
      outputSchema: z.object({ link: uploadLinkOutput }),
    },
    async ({ lesson_id, activity_id, file_name }) => uploadLinkTool({ lessonId: lesson_id, activityId: activity_id }, file_name),
  )

  srv.registerTool(
    'create_lesson_file_upload_link',
    {
      title: 'Create a one-time upload link for a lesson file',
      description: 'Best way to upload a file you have in your code sandbox to a lesson\'s private teacher file store (not visible to pupils). '
        + 'Returns a single-use link, valid 15 minutes, that accepts the file with a plain curl POST — no credentials, no base64.',
      inputSchema: z.object({
        lesson_id: z.string().describe('UUID of the lesson'),
        file_name: z.string().optional().describe('Name to store the file under, including extension. Defaults to the uploaded file\'s name.'),
      }),
      outputSchema: z.object({ link: uploadLinkOutput }),
    },
    async ({ lesson_id, file_name }) => uploadLinkTool({ lessonId: lesson_id, activityId: null }, file_name),
  )

  const lessonFileOutput = z.object({
    lesson_id: z.string(),
    activity_id: z.string().nullable(),
    activity_title: z.string().nullable(),
    activity_type: z.string().nullable(),
    file_name: z.string(),
    size_bytes: z.number().nullable(),
    content_type: z.string().nullable(),
    updated_at: z.string().nullable(),
  })

  srv.registerTool(
    'list_lesson_files',
    {
      title: 'List a lesson\'s files',
      description: 'List the teacher files of a lesson: its private lesson files (activity_id null) and the files attached to its activities '
        + '(file-download, display-image and similar). Pupils\' uploaded work is not included. '
        + 'Use get_lesson_file_download_link to fetch one.',
      inputSchema: z.object({
        lesson_id: z.string().describe('UUID of the lesson'),
      }),
      outputSchema: z.object({ files: z.array(lessonFileOutput).nullable() }),
    },
    async ({ lesson_id }) => {
      try {
        const files = await listLessonFiles(lesson_id)
        return {
          content: [{
            type: 'text' as const,
            text: files.length > 0
              ? files.map((f) => `${f.file_name} • ${f.activity_id ? `activity ${f.activity_id}${f.activity_title ? ` — ${f.activity_title}` : ''}` : 'lesson file'}${f.size_bytes != null ? ` • ${f.size_bytes} bytes` : ''}`).join('\n')
              : `Lesson ${lesson_id} has no files.`,
          }],
          structuredContent: { files },
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to list lesson files'
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], structuredContent: { files: null } }
      }
    },
  )

  srv.registerTool(
    'get_lesson_file_download_link',
    {
      title: 'Get a one-time download link for a lesson file',
      description: 'Best way to open one of a lesson\'s files (e.g. a deck or worksheet) in your code sandbox. '
        + 'Returns a single-use link, valid 15 minutes, that downloads the file with a plain curl GET — no credentials. '
        + 'Take lesson_id, activity_id and file_name exactly from list_lesson_files; omit activity_id for a lesson file.',
      inputSchema: z.object({
        lesson_id: z.string().describe('UUID of the lesson'),
        activity_id: z.string().optional().describe('UUID of the activity the file belongs to. Omit for the lesson\'s own teacher files.'),
        file_name: z.string().describe('Exact file name from list_lesson_files'),
      }),
      outputSchema: z.object({
        link: z.object({
          download_url: z.string(),
          expires_at: z.string(),
          file: lessonFileOutput,
          instructions: z.string(),
        }).nullable(),
      }),
    },
    async ({ lesson_id, activity_id, file_name }) => {
      try {
        const { token, expiresAt, file } = await createDownloadLink(caller, {
          lessonId: lesson_id,
          activityId: activity_id ?? null,
          fileName: file_name,
        })
        const downloadUrl = `${baseUrl}/api/MCP/download/${token}`
        const instructions =
          `From your code sandbox, fetch the file with e.g. curl -sSf -o "${file.file_name.replace(/[^\w .()-]/g, '_')}" "${downloadUrl}". `
          + `No Authorization header is needed. The link works once and expires at ${expiresAt}. `
          + 'If the request cannot connect, the sandbox\'s network settings '
          + `are blocking ${new URL(downloadUrl).host}: ask the user to allow that domain in Claude's settings (Capabilities → code execution network access).`
        return {
          content: [{ type: 'text' as const, text: `Download link (single use, expires ${expiresAt}):\n${downloadUrl}\n${instructions}` }],
          structuredContent: { link: { download_url: downloadUrl, expires_at: expiresAt, file, instructions } },
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to create download link'
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], structuredContent: { link: null } }
      }
    },
  )

  srv.registerTool(
    'upload_lesson_file',
    {
      title: 'Upload file to lesson (teacher storage)',
      description: 'Uploads a base64-encoded file to the lesson\'s private teacher file store. Not visible to pupils. Max 5 MB.',
      inputSchema: z.object({
        lesson_id: z.string().describe('UUID of the lesson'),
        file_name: z.string().describe('File name including extension, e.g. "notes.pdf"'),
        base64_content: z.string().describe('Base64-encoded file content'),
        content_type: z.string().optional().describe('MIME type, e.g. "application/pdf"'),
      }),
      outputSchema: z.object({
        file: z.object({
          lesson_id: z.string(),
          file_name: z.string(),
          size_bytes: z.number(),
          url: z.string(),
        }).nullable(),
      }),
    },
    async ({ lesson_id, file_name, base64_content, content_type }) => {
      try {
        const file = await uploadLessonFile(lesson_id, file_name, decodeBase64File(base64_content), content_type ?? null)
        return {
          content: [{ type: 'text' as const, text: `Uploaded "${file_name}" (${file.size_bytes} bytes) to lesson ${lesson_id} teacher files. Available at ${file.url}` }],
          structuredContent: { file },
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          structuredContent: { file: null },
        }
      }
    },
  )

  srv.registerTool(
    'upload_activity_file',
    {
      title: 'Upload file to a file-download, display-image or display-webpage activity',
      description: 'Uploads a base64-encoded file to a file-download activity (so pupils can download it) a display-image activity (to set its image), or a display-webpage activity (one .html file, replacing any earlier one).',
      inputSchema: z.object({
        lesson_id: z.string().describe('UUID of the lesson'),
        activity_id: z.string().describe('UUID of the file-download, display-image or display-webpage activity'),
        file_name: z.string().describe('File name including extension, e.g. "worksheet.pdf"'),
        base64_content: z.string().describe('Base64-encoded file content'),
        content_type: z.string().optional().describe('MIME type, e.g. "application/pdf" or "image/png"'),
      }),
      outputSchema: z.object({
        file: z.object({
          activity_id: z.string(),
          lesson_id: z.string(),
          file_name: z.string(),
          size_bytes: z.number(),
          url: z.string(),
        }).nullable(),
      }),
    },
    async ({ lesson_id, activity_id, file_name, base64_content, content_type }) => {
      try {
        const file = await uploadActivityFile(lesson_id, activity_id, file_name, decodeBase64File(base64_content), content_type ?? null)
        return {
          content: [{ type: 'text' as const, text: `Uploaded "${file_name}" (${file.size_bytes} bytes) to activity ${activity_id}. Available at ${file.url}` }],
          structuredContent: { file },
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          structuredContent: { file: null },
        }
      }
    },
  )

  const FROM_URL_HELP =
    'DINO downloads the file itself, so nothing has to be passed through this conversation. '
    + 'The link must be public https: a Google Drive file shared "Anyone with the link" (its normal share link works), '
    + 'a Google Slides/Docs/Sheets link (exported as pptx/docx/xlsx), or any direct download link. Max 5 MB. Web pages and SVGs are refused.'

  srv.registerTool(
    'upload_activity_file_from_url',
    {
      title: 'Upload file to activity from a link',
      description: 'Downloads a file from a link into a file-download activity (so pupils can download it) or a display-image activity (to set its image). A display-webpage activity takes an .html file, but by link only when the server sends it as something other than text/html; otherwise use a one-time upload link. '
        + 'Create the activity first with create_activity. ' + FROM_URL_HELP,
      inputSchema: z.object({
        lesson_id: z.string().describe('UUID of the lesson'),
        activity_id: z.string().describe('UUID of the file-download, display-image or display-webpage activity'),
        url: z.string().describe('Public https link to the file'),
        file_name: z.string().optional().describe('File name to store, including extension. Defaults to the name the link provides.'),
      }),
      outputSchema: z.object({
        file: z.object({
          activity_id: z.string(),
          lesson_id: z.string(),
          file_name: z.string(),
          size_bytes: z.number(),
          url: z.string(),
        }).nullable(),
      }),
    },
    async ({ lesson_id, activity_id, url, file_name }) => {
      try {
        const fetched = await fetchFileFromUrl(url, file_name)
        const file = await uploadActivityFile(lesson_id, activity_id, fetched.fileName, fetched.buffer, fetched.contentType)
        return {
          content: [{ type: 'text' as const, text: `Uploaded "${file.file_name}" (${file.size_bytes} bytes) to activity ${activity_id}. Available at ${file.url}` }],
          structuredContent: { file },
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          structuredContent: { file: null },
        }
      }
    },
  )

  srv.registerTool(
    'upload_lesson_file_from_url',
    {
      title: 'Upload file to lesson (teacher storage) from a link',
      description: 'Downloads a file from a link into the lesson\'s private teacher file store. Not visible to pupils. ' + FROM_URL_HELP,
      inputSchema: z.object({
        lesson_id: z.string().describe('UUID of the lesson'),
        url: z.string().describe('Public https link to the file'),
        file_name: z.string().optional().describe('File name to store, including extension. Defaults to the name the link provides.'),
      }),
      outputSchema: z.object({
        file: z.object({
          lesson_id: z.string(),
          file_name: z.string(),
          size_bytes: z.number(),
          url: z.string(),
        }).nullable(),
      }),
    },
    async ({ lesson_id, url, file_name }) => {
      try {
        const fetched = await fetchFileFromUrl(url, file_name)
        const file = await uploadLessonFile(lesson_id, fetched.fileName, fetched.buffer, fetched.contentType)
        return {
          content: [{ type: 'text' as const, text: `Uploaded "${file.file_name}" (${file.size_bytes} bytes) to lesson ${lesson_id} teacher files. Available at ${file.url}` }],
          structuredContent: { file },
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          structuredContent: { file: null },
        }
      }
    },
  )

  srv.registerTool(
    'remove_lesson_file',
    {
      title: 'Remove a lesson file',
      description: 'Delete one of a lesson\'s private teacher files (an old deck, a timestamped copy). Take file_name exactly from list_lesson_files, where lesson files have activity_id null. '
        + 'For a file attached to an activity, use remove_activity_file.',
      inputSchema: z.object({
        lesson_id: z.string().describe('UUID of the lesson'),
        file_name: z.string().describe('Exact file name from list_lesson_files'),
      }),
      outputSchema: z.object({
        file: z.object({ lesson_id: z.string(), file_name: z.string() }).nullable(),
      }),
    },
    async ({ lesson_id, file_name }) => {
      try {
        const file = await removeLessonFile(lesson_id, file_name)
        return { content: [{ type: 'text' as const, text: `Removed "${file_name}" from lesson ${lesson_id}` }], structuredContent: { file } }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], structuredContent: { file: null } }
      }
    },
  )

  srv.registerTool(
    'remove_activity_file',
    {
      title: 'Remove a file from an activity',
      description: 'Delete one file from an activity, e.g. one of a file-download\'s sheets. Take file_name exactly from list_lesson_files. '
        + 'If body_data names the file (a display-image\'s image, a display-webpage\'s HTML file, an MCQ\'s question image) that field is cleared. '
        + 'still_referenced is true when body_data text, such as an <img> in a question, still links to the file. To replace a file, remove it and upload the new one.',
      inputSchema: z.object({
        activity_id: z.string().describe('UUID of the activity'),
        file_name: z.string().describe('Exact file name from list_lesson_files'),
      }),
      outputSchema: z.object({
        file: z.object({
          activity_id: z.string(),
          lesson_id: z.string(),
          file_name: z.string(),
          cleared_fields: z.array(z.string()),
          still_referenced: z.boolean(),
        }).nullable(),
      }),
    },
    async ({ activity_id, file_name }) => {
      try {
        const file = await removeActivityFile(activity_id, file_name)
        const notes = [
          file.cleared_fields.length ? `cleared body_data ${file.cleared_fields.join(', ')}` : null,
          file.still_referenced ? 'body_data still links to it' : null,
        ].filter(Boolean)
        return {
          content: [{ type: 'text' as const, text: `Removed "${file_name}" from activity ${activity_id}${notes.length ? ` (${notes.join('; ')})` : ''}` }],
          structuredContent: { file },
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], structuredContent: { file: null } }
      }
    },
  )

  const activityImageOutput = z.object({
    activity_id: z.string(),
    lesson_id: z.string(),
    file_name: z.string(),
    size_bytes: z.number(),
    url: z.string(),
    img_tag: z.string(),
  })

  srv.registerTool(
    'upload_activity_image',
    {
      title: 'Upload an image for an activity\'s question',
      description: 'Store a png, jpg, gif or webp image with an activity and get a url to place in its body_data, e.g. <img src="url"> in a question (update_activity question=…) '
        + 'or an MCQ option\'s imageUrl, instead of an inline base64 image. Pass base64_content or a public https url (DINO downloads it). Max 5 MB. '
        + 'Not for file-download, display-image or display-webpage activities: use upload_activity_file.',
      inputSchema: z.object({
        activity_id: z.string().describe('UUID of the activity'),
        file_name: z.string().optional().describe('File name with extension, e.g. "circuit.png". Required with base64_content; defaults to the link\'s name with url.'),
        base64_content: z.string().optional().describe('Base64-encoded image'),
        url: z.string().optional().describe('Public https link to the image'),
      }),
      outputSchema: z.object({ image: activityImageOutput.nullable() }),
    },
    async ({ activity_id, file_name, base64_content, url }) => {
      try {
        if (Boolean(base64_content) === Boolean(url)) throw new Error('Pass exactly one of base64_content or url')
        let image
        if (url) {
          const fetched = await fetchFileFromUrl(url, file_name)
          image = await uploadActivityImage(activity_id, fetched.fileName, fetched.buffer)
        } else {
          if (!file_name) throw new Error('file_name is required with base64_content')
          image = await uploadActivityImage(activity_id, file_name, decodeBase64File(base64_content!))
        }
        return {
          content: [{ type: 'text' as const, text: `Stored "${image.file_name}" (${image.size_bytes} bytes) with activity ${activity_id}. Use ${image.img_tag}` }],
          structuredContent: { image },
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], structuredContent: { image: null } }
      }
    },
  )

  srv.registerTool(
    'move_activity_images_to_files',
    {
      title: 'Move an activity\'s inline images to files',
      description: 'Move every base64 image held inline in an activity\'s body_data (pasted into a question, or an option\'s imageUrl) into a file stored with the activity, '
        + 'and point body_data at the file. Nothing else in body_data changes and pupils see the same images. '
        + 'Run it before editing a question whose body_data is too large to read or resend.',
      inputSchema: z.object({
        activity_id: z.string().describe('UUID of the activity'),
      }),
      outputSchema: z.object({
        result: z.object({
          activity_id: z.string(),
          images_moved: z.number(),
          body_bytes_before: z.number(),
          body_bytes_after: z.number(),
          files: z.array(z.string()),
        }).nullable(),
      }),
    },
    async ({ activity_id }) => {
      try {
        const result = await moveInlineImagesToFiles(activity_id)
        return {
          content: [{
            type: 'text' as const,
            text: result.images_moved === 0
              ? `Activity ${activity_id} has no inline images`
              : `Moved ${result.images_moved} image(s) to files; body_data is ${result.body_bytes_after} bytes (was ${result.body_bytes_before})`,
          }],
          structuredContent: { result },
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], structuredContent: { result: null } }
      }
    },
  )

  // ── Timetable slots ───────────────────────────────────────────────────────
  //
  // list_teachers and list_groups exist because MCP had no way to discover
  // either: without them a caller would have to know a uuid or a group code
  // out of band before the slot tools could be used at all.

  srv.registerTool(
    'list_teachers',
    {
      title: 'List teachers',
      description: 'Return every teacher with their id, name and email. Use this to find the identifier for the timetable tools.',
      outputSchema: {
        teachers: z.array(
          z.object({ user_id: z.string(), name: z.string(), email: z.string().nullable() }),
        ),
      },
    },
    async () => {
      const teachers = await listTeachers()
      return {
        content: [
          {
            type: 'text' as const,
            text: teachers.length
              ? teachers.map((t) => `${t.name} • ${t.email ?? 'no email'}`).join('\n')
              : 'No teachers found.',
          },
        ],
        structuredContent: { teachers },
      }
    },
  )

  srv.registerTool(
    'list_groups',
    {
      title: 'List groups',
      description: 'Return teaching groups (classes) with subject and active flag. Inactive groups are excluded unless include_inactive is true.',
      inputSchema: {
        include_inactive: z.boolean().optional().describe('Include retired classes. Defaults to false.'),
      },
      outputSchema: {
        groups: z.array(
          z.object({ group_id: z.string(), subject: z.string().nullable(), is_active: z.boolean() }),
        ),
      },
    },
    async ({ include_inactive }) => {
      const groups = await listGroups(include_inactive === true)
      return {
        content: [
          {
            type: 'text' as const,
            text: groups.length
              ? groups.map((g) => `${g.group_id} • ${g.subject ?? 'no subject'}`).join('\n')
              : 'No groups found.',
          },
        ],
        structuredContent: { groups },
      }
    },
  )

  srv.registerTool(
    'get_timetable_slots',
    {
      title: 'Get a teacher timetable',
      description: "Return a teacher's timetable slots. A slot with a null group_id is explicitly marked as no class; a slot absent from the list has never been set.",
      inputSchema: {
        teacher: z.string().min(1).describe('Teacher email or user id.'),
      },
      outputSchema: {
        teacher_id: z.string(),
        slots: z.array(
          z.object({ day: z.string(), period: z.number(), group_id: z.string().nullable() }),
        ),
      },
    },
    async ({ teacher }) => {
      const teacherId = await resolveTeacherId(teacher)
      const slots = await listTimetableSlots(teacherId)
      return {
        content: [
          {
            type: 'text' as const,
            text: slots.length
              ? slots.map((s) => `${s.day} P${s.period} • ${s.group_id ?? 'no class'}`).join('\n')
              : 'No timetable slots set.',
          },
        ],
        structuredContent: { teacher_id: teacherId, slots },
      }
    },
  )

  const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use yyyy-MM-dd.')

  srv.registerTool(
    'list_lesson_assignments',
    {
      title: 'List lesson assignments',
      description:
        'Read-only. Which lessons each class has been given, and when, from the planner. One row per (class, lesson): '
        + 'start_date is the week the class first has it (the date progress and due dates use), due_date is start_date + 7 days, '
        + 'and sessions lists every planned slot with its calendar date, day and period. Newest first. '
        + 'Filter by group_id, unit_id, lesson_id and/or a from/to range on start_date (yyyy-MM-dd, inclusive). '
        + 'Retired classes are excluded unless include_inactive is true or group_id names one.',
      inputSchema: {
        group_id: z.string().optional().describe('Class, e.g. 26-10-DT. See list_groups.'),
        unit_id: z.string().optional(),
        lesson_id: z.string().optional(),
        from: isoDate.optional().describe('Earliest start_date, yyyy-MM-dd.'),
        to: isoDate.optional().describe('Latest start_date, yyyy-MM-dd.'),
        include_inactive: z.boolean().optional().describe('Include retired classes. Defaults to false.'),
      },
      outputSchema: {
        assignments: z
          .array(
            z.object({
              group_id: z.string(),
              group_subject: z.string().nullable(),
              lesson_id: z.string(),
              lesson_title: z.string(),
              unit_id: z.string(),
              unit_title: z.string(),
              start_date: z.string(),
              due_date: z.string().nullable(),
              locked: z.boolean(),
              feedback_visible: z.boolean(),
              sessions: z.array(
                z.object({ date: z.string(), week_start_date: z.string(), day: z.string(), period: z.number() }),
              ),
            }),
          )
          .nullable(),
      },
    },
    async ({ group_id, unit_id, lesson_id, from, to, include_inactive }) => {
      try {
        const assignments = await listLessonAssignments({
          groupId: group_id,
          unitId: unit_id,
          lessonId: lesson_id,
          from,
          to,
          includeInactive: include_inactive,
        })
        return {
          content: [
            {
              type: 'text' as const,
              text: assignments.length
                ? assignments
                    .map((a) => `${a.start_date} • ${a.group_id} • ${a.unit_title} › ${a.lesson_title} (due ${a.due_date ?? 'n/a'})`)
                    .join('\n')
                : 'No lesson assignments match.',
            },
          ],
          structuredContent: { assignments },
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to list lesson assignments'
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], structuredContent: { assignments: null } }
      }
    },
  )

  srv.registerTool(
    'set_timetable_slot',
    {
      title: 'Set a timetable slot',
      description: `Create or update one slot. Omit group_id to mark the slot as no class. Days: ${VALID_DAYS.join(', ')}. Periods: ${VALID_PERIODS.join(', ')}.`,
      inputSchema: {
        teacher: z.string().min(1).describe('Teacher email or user id.'),
        day: z.string().min(1).describe(`One of: ${VALID_DAYS.join(', ')}.`),
        period: z.coerce.number().int().describe(`One of: ${VALID_PERIODS.join(', ')}.`),
        group_id: z.string().optional().describe('Class to teach in this slot. Omit for no class.'),
      },
      outputSchema: {
        teacher_id: z.string(),
        slot: z.object({ day: z.string(), period: z.number(), group_id: z.string().nullable() }),
      },
    },
    async ({ teacher, day, period, group_id }) => {
      const teacherId = await resolveTeacherId(teacher)
      const slot = await setTimetableSlot({ teacherId, day, period, groupId: group_id })
      return {
        content: [
          {
            type: 'text' as const,
            text: `${day} P${period} set to ${slot.group_id ?? 'no class'}.`,
          },
        ],
        structuredContent: { teacher_id: teacherId, slot },
      }
    },
  )

  srv.registerTool(
    'delete_timetable_slot',
    {
      title: 'Delete a timetable slot',
      description: 'Remove a slot entirely, as though it had never been set. To keep the slot but mark it free, use set_timetable_slot with no group_id instead.',
      inputSchema: {
        teacher: z.string().min(1).describe('Teacher email or user id.'),
        day: z.string().min(1).describe(`One of: ${VALID_DAYS.join(', ')}.`),
        period: z.coerce.number().int().describe(`One of: ${VALID_PERIODS.join(', ')}.`),
      },
      outputSchema: { teacher_id: z.string(), deleted: z.boolean() },
    },
    async ({ teacher, day, period }) => {
      const teacherId = await resolveTeacherId(teacher)
      const deleted = await deleteTimetableSlot(teacherId, day, period)
      return {
        content: [
          {
            type: 'text' as const,
            text: deleted ? `Removed ${day} P${period}.` : `Nothing set at ${day} P${period}.`,
          },
        ],
        structuredContent: { teacher_id: teacherId, deleted },
      }
    },
  )

  // -------------------------------------------------------------------------
  // Assessment papers — written papers marked outside a lesson. Unrelated to
  // the curriculum's assessment objectives (create_assessment_objective).
  // -------------------------------------------------------------------------

  const jsonArray = <T extends z.ZodTypeAny>(item: T) =>
    z.preprocess((v) => (typeof v === 'string' ? JSON.parse(v) : v), z.array(item))

  const objectiveInput = z.object({
    code: z.string().optional().describe('Code printed on the paper, e.g. "LO1". Defaults to LO{n} by position.'),
    title: z.string().optional().describe('Objective wording as printed on the paper. Defaults to the linked learning objective\'s title.'),
    learning_objective_id: z
      .string()
      .nullable()
      .optional()
      .describe('Curriculum learning objective to link (one-to-one per paper). Omit to keep the current link; null or "" to leave unlinked.'),
  })
  const toObjectiveInput = (o: z.infer<typeof objectiveInput>) => ({
    code: o.code,
    title: o.title,
    learningObjectiveId: o.learning_objective_id,
  })

  const describePaper = (paper: AssessmentPaper) => {
    const unlinked = paper.objectives.filter((o) => !o.learning_objective_id).length
    return `${paper.title} (${paper.assessment_id}): ${paper.questions.length} questions, ${paper.total_marks} marks, `
      + `${paper.objectives.length} objectives${unlinked > 0 ? ` (${unlinked} not linked)` : ''}, `
      + `${paper.pupils.length} pupils with results.`
  }
  const paperTool = async (action: () => Promise<AssessmentPaper>, prefix = '') => {
    try {
      const assessment = await action()
      return {
        content: [{ type: 'text' as const, text: `${prefix}${describePaper(assessment)}` }],
        structuredContent: { assessment },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Assessment paper request failed'
      return {
        content: [{ type: 'text' as const, text: `Error: ${message}` }],
        structuredContent: { assessment: null },
      }
    }
  }

  const PAPER_WORKFLOW =
    'Assessment papers are written papers (e.g. "Practice B") marked outside lessons; they are NOT the curriculum\'s assessment objectives. '
    + 'Workflow: (1) get_all_los_and_scs_for_curriculum to find the curriculum learning objectives; '
    + '(2) create_assessment_paper; (3) set_assessment_paper_questions; '
    + '(4) list_group_pupils for real pupil ids — never guess ids from names, and tell the user about any pupil you cannot match; '
    + '(5) record_assessment_paper_result once per pupil; (6) get_assessment_paper to verify. '
    + 'Totals and per-objective subtotals are always computed — never send them.'

  srv.registerTool(
    'list_assessment_papers',
    {
      title: 'List assessment papers',
      description: `List active assessment papers, newest first, with question/mark/pupil counts. ${PAPER_WORKFLOW}`,
      inputSchema: {
        group_id: z.string().optional().describe('Only papers set to this group, e.g. "26-10-DT".'),
      },
      outputSchema: {
        assessments: z.array(AssessmentPaperSummarySchema).nullable(),
      },
    },
    async ({ group_id }) => {
      try {
        const assessments = await listAssessments(group_id ?? null)
        return {
          content: [
            {
              type: 'text' as const,
              text: assessments.length > 0
                ? assessments
                  .map((a) => `${a.assessment_id} • ${a.assessed_on} • ${a.title} • ${a.question_count} questions, ${a.total_marks} marks, ${a.pupils_with_results} pupils`)
                  .join('\n')
                : 'No assessment papers found.',
            },
          ],
          structuredContent: { assessments },
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to list assessment papers'
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], structuredContent: { assessments: null } }
      }
    },
  )

  srv.registerTool(
    'get_assessment_paper',
    {
      title: 'Get assessment paper',
      description:
        'Return a paper with its objectives, questions (label, max_marks, objective_code), total marks, and every pupil with at least one mark '
        + '(total, percent, per-objective subtotals). Use it to verify after recording results.',
      inputSchema: { assessment_id: z.string().min(1).describe('Assessment paper id.') },
      outputSchema: { assessment: AssessmentPaperSchema.nullable() },
    },
    async ({ assessment_id }) => paperTool(() => getAssessment(assessment_id)),
  )

  srv.registerTool(
    'get_assessment_paper_result',
    {
      title: 'Get a pupil\'s assessment paper result',
      description:
        'Return one pupil\'s result on a paper: totals, per-objective subtotals, every question with the mark (null if not marked), '
        + 'feedback and provenance ("teacher" = edited by a teacher, never overwritten), plus went_well and targets.',
      inputSchema: {
        assessment_id: z.string().min(1).describe('Assessment paper id.'),
        pupil_id: z.string().min(1).describe('Pupil user id from list_group_pupils.'),
      },
      outputSchema: { result: AssessmentPupilResultSchema.nullable() },
    },
    async ({ assessment_id, pupil_id }) => {
      try {
        const result = await getPupilResult(assessment_id, pupil_id)
        const name = `${result.first_name ?? ''} ${result.last_name ?? ''}`.trim() || pupil_id
        const marked = result.questions.filter((q) => q.awarded !== null).length
        return {
          content: [
            {
              type: 'text' as const,
              text: `${name} on ${result.assessment.title}: ${result.total_awarded}/${result.total_available} (${result.percent}%), ${marked}/${result.questions.length} questions marked.`,
            },
          ],
          structuredContent: { result },
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to read result'
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], structuredContent: { result: null } }
      }
    },
  )

  srv.registerTool(
    'create_assessment_paper',
    {
      title: 'Create assessment paper',
      description:
        `Create a paper with its objectives. Call list_assessment_papers first so you do not create a duplicate. ${PAPER_WORKFLOW} `
        + 'Each objective may link to one curriculum learning objective from the paper\'s curriculum, and each learning objective at most once per paper. '
        + 'Arrays may be sent as JSON strings.',
      inputSchema: {
        title: z.string().min(1).describe('Paper title, e.g. "Practice B".'),
        assessed_on: z.string().min(1).describe('Date sat, YYYY-MM-DD.'),
        curriculum_id: z.string().min(1).describe('Curriculum whose learning objectives the paper links to.'),
        group_ids: jsonArray(z.string()).describe('Groups that sat the paper, e.g. ["26-10-DT"].'),
        objectives: jsonArray(objectiveInput).describe('The paper\'s objectives in printed order: [{code, title, learning_objective_id}].'),
      },
      outputSchema: { assessment: AssessmentPaperSchema.nullable() },
    },
    async ({ title, assessed_on, curriculum_id, group_ids, objectives }) =>
      paperTool(
        () => createAssessment({
          title,
          assessedOn: assessed_on,
          curriculumId: curriculum_id,
          groupIds: group_ids,
          objectives: objectives.map(toObjectiveInput),
        }),
        'Created ',
      ),
  )

  srv.registerTool(
    'set_assessment_paper_objectives',
    {
      title: 'Set assessment paper objectives',
      description:
        'Replace a paper\'s objective list, matched by code; list order becomes position. Omitted title or learning_objective_id keep their current values. '
        + 'A code missing from the list is deleted, unless questions still use it (that is an error naming them). Safe to re-run.',
      inputSchema: {
        assessment_id: z.string().min(1).describe('Assessment paper id.'),
        objectives: jsonArray(objectiveInput.extend({ code: z.string().min(1).describe('Code printed on the paper, e.g. "LO1".') }))
          .describe('Full objective list: [{code, title?, learning_objective_id?}].'),
      },
      outputSchema: { assessment: AssessmentPaperSchema.nullable() },
    },
    async ({ assessment_id, objectives }) =>
      paperTool(() => setAssessmentObjectives(assessment_id, objectives.map(toObjectiveInput)), 'Updated '),
  )

  srv.registerTool(
    'map_assessment_paper_objective',
    {
      title: 'Link a paper objective to the curriculum',
      description:
        'Link one paper objective (by code, e.g. "LO2") to a curriculum learning objective from the paper\'s curriculum, or clear the link with null or "". '
        + 'Links are one-to-one per paper. Questions and marks are unaffected.',
      inputSchema: {
        assessment_id: z.string().min(1).describe('Assessment paper id.'),
        code: z.string().min(1).describe('Paper objective code, e.g. "LO1".'),
        learning_objective_id: z.string().nullable().describe('Curriculum learning objective id, or null / "" to unlink.'),
      },
      outputSchema: { assessment: AssessmentPaperSchema.nullable() },
    },
    async ({ assessment_id, code, learning_objective_id }) =>
      paperTool(() => mapAssessmentObjective(assessment_id, code, learning_objective_id || null), 'Updated '),
  )

  srv.registerTool(
    'set_assessment_paper_questions',
    {
      title: 'Set assessment paper questions',
      description:
        'Replace a paper\'s marked parts, matched by label (e.g. "Q1(iii)"); list order becomes position. Send the FULL list every time: '
        + 'a label left out is deleted, unless pupils already have marks for it (error). max_marks cannot drop below a mark already awarded. '
        + 'objective_code must be one of the paper\'s codes. Omitting correct_answer keeps the stored one. Safe to re-run. Arrays may be sent as JSON strings.',
      inputSchema: {
        assessment_id: z.string().min(1).describe('Assessment paper id.'),
        questions: jsonArray(
          z.object({
            label: z.string().min(1).describe('Label as printed, e.g. "Q1(iii)".'),
            max_marks: z.number().int().min(1).describe('Marks available for this part.'),
            objective_code: z.string().min(1).describe('Paper objective code, e.g. "LO1".'),
            correct_answer: z.string().nullable().optional().describe('Mark-scheme answer (optional).'),
          }),
        ).describe('Every marked part in paper order.'),
      },
      outputSchema: { assessment: AssessmentPaperSchema.nullable() },
    },
    async ({ assessment_id, questions }) =>
      paperTool(
        () => setAssessmentQuestions(
          assessment_id,
          questions.map((q) => ({
            label: q.label,
            maxMarks: q.max_marks,
            objectiveCode: q.objective_code,
            correctAnswer: q.correct_answer,
          })),
        ),
        'Updated ',
      ),
  )

  srv.registerTool(
    'list_group_pupils',
    {
      title: 'List pupils in a group',
      description:
        'Return the pupils (not teachers) in a group with their user ids, sorted by surname. Use these ids for record_assessment_paper_result; '
        + 'never guess an id from a name, and report any pupil on the paper you cannot match to the user.',
      inputSchema: { group_id: z.string().min(1).describe('Group id, e.g. "26-10-DT".') },
      outputSchema: {
        pupils: z.array(GroupPupilSchema).nullable(),
      },
    },
    async ({ group_id }) => {
      try {
        const pupils = await listGroupPupils(group_id)
        return {
          content: [
            {
              type: 'text' as const,
              text: pupils.length > 0
                ? pupils.map((p) => `${p.pupil_id} • ${p.first_name ?? ''} ${p.last_name ?? ''}`.trim()).join('\n')
                : `No pupils in ${group_id}.`,
            },
          ],
          structuredContent: { pupils },
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to list pupils'
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], structuredContent: { pupils: null } }
      }
    },
  )

  srv.registerTool(
    'record_assessment_paper_result',
    {
      title: 'Record a pupil\'s assessment paper result',
      description:
        'Write ONE pupil\'s marks for a paper. Every label must exist on the paper and awarded must be a whole number from 0 to that question\'s max_marks; '
        + 'any problem rejects the whole call and nothing is saved. Do not send totals — they are computed. '
        + 'Re-running is safe: marks are replaced, except marks a teacher has edited, which are kept and listed in skipped_teacher_edited. '
        + 'went_well/targets replace the pupil\'s whole-paper feedback when sent. missing_labels lists questions still unmarked for this pupil. '
        + 'Arrays may be sent as JSON strings.',
      inputSchema: {
        assessment_id: z.string().min(1).describe('Assessment paper id.'),
        pupil_id: z.string().min(1).describe('Pupil user id from list_group_pupils.'),
        marks: jsonArray(
          z.object({
            label: z.string().min(1).describe('Question label, e.g. "Q1(iii)".'),
            awarded: z.number().int().min(0).describe('Marks awarded, 0..max_marks.'),
            why_not_awarded: z.string().nullable().optional().describe('Why marks were lost (omit when full marks).'),
            how_to_improve: z.string().nullable().optional().describe('What the pupil should do to gain them.'),
          }),
        ).describe('One entry per marked question.'),
        went_well: jsonArray(z.string()).optional().describe('Whole-paper strengths.'),
        targets: jsonArray(z.string()).optional().describe('Whole-paper targets.'),
      },
      outputSchema: {
        written: RecordAssessmentResultSchema.shape.written.nullable(),
        skipped_teacher_edited: RecordAssessmentResultSchema.shape.skipped_teacher_edited.nullable(),
        feedback_skipped_teacher_edited: RecordAssessmentResultSchema.shape.feedback_skipped_teacher_edited.nullable(),
        missing_labels: RecordAssessmentResultSchema.shape.missing_labels.nullable(),
        result: AssessmentPupilResultSchema.nullable(),
      },
    },
    async ({ assessment_id, pupil_id, marks, went_well, targets }) => {
      try {
        const outcome = await recordPupilResult({
          assessmentId: assessment_id,
          pupilId: pupil_id,
          marks: marks.map((m) => ({
            label: m.label,
            awarded: m.awarded,
            whyNotAwarded: m.why_not_awarded,
            howToImprove: m.how_to_improve,
          })),
          wentWell: went_well,
          targets,
        })
        const r = outcome.result
        const name = `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || pupil_id
        const notes = [
          outcome.skipped_teacher_edited.length > 0 ? `kept teacher-edited: ${outcome.skipped_teacher_edited.join(', ')}` : '',
          outcome.feedback_skipped_teacher_edited ? 'kept teacher-edited feedback' : '',
          outcome.missing_labels.length > 0 ? `unmarked: ${outcome.missing_labels.join(', ')}` : '',
        ].filter(Boolean)
        return {
          content: [
            {
              type: 'text' as const,
              text: `${name}: ${outcome.written} marks written, ${r.total_awarded}/${r.total_available} (${r.percent}%).${notes.length > 0 ? ` ${notes.join('; ')}.` : ''}`,
            },
          ],
          structuredContent: outcome,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to record result'
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          structuredContent: {
            written: null,
            skipped_teacher_edited: null,
            feedback_skipped_teacher_edited: null,
            missing_labels: null,
            result: null,
          },
        }
      }
    },
  )

  srv.registerTool(
    'attach_assessment_paper_file',
    {
      title: 'Attach a file to an assessment paper',
      description:
        'Store a small file (question paper, mark scheme) against a paper. Content is base64, max 5 MB; uploading the same file_name again replaces it. '
        + 'For scans of pupils\' papers, or any file in your code sandbox, use create_assessment_paper_file_upload_link instead. Downloads are teacher-only.',
      inputSchema: {
        assessment_id: z.string().min(1).describe('Assessment paper id.'),
        file_name: z.string().min(1).describe('File name with extension, no slashes.'),
        base64_content: z.string().min(1).describe('File content, base64-encoded.'),
        content_type: z.string().optional().describe('MIME type, e.g. "application/pdf".'),
      },
      outputSchema: {
        file: AssessmentFileSchema.nullable(),
      },
    },
    async ({ assessment_id, file_name, base64_content, content_type }) => {
      try {
        const file = await attachAssessmentFile(assessment_id, file_name, base64_content, content_type ?? null)
        return {
          content: [{ type: 'text' as const, text: `Attached ${file.file_name} (${file.size_bytes} bytes) at ${file.path}` }],
          structuredContent: { file },
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to attach file'
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], structuredContent: { file: null } }
      }
    },
  )

  srv.registerTool(
    'create_assessment_paper_file_upload_link',
    {
      title: 'Create a one-time upload link for an assessment paper file',
      description: 'Best way to attach scans of pupils\' marked papers (or any PDF/image in your code sandbox) to an assessment paper. '
        + 'Returns a single-use link, valid 15 minutes, that accepts one file (max 25 MB) with a plain curl POST — no credentials, no base64. '
        + 'Call once per file. For one pupil\'s script, pass that pupil\'s pupil_id (get_assessment_paper / list_group_pupils): '
        + 'the pupil can then open it once feedback is released. Omit pupil_id for whole-paper files such as the question paper '
        + 'or mark scheme, which stay teacher-only. Files are listed by list_assessment_paper_files.',
      inputSchema: z.object({
        assessment_id: z.string().min(1).describe('Assessment paper id.'),
        pupil_id: z.string().optional().describe('The pupil whose script this is. Omit for the question paper, mark scheme or other whole-paper files.'),
        file_name: z.string().optional().describe('Name to store the file under, including extension, e.g. "10A scans.pdf". Defaults to the uploaded file\'s name.'),
      }),
      outputSchema: z.object({ link: uploadLinkOutput }),
    },
    async ({ assessment_id, pupil_id, file_name }) => uploadLinkTool({ assessmentId: assessment_id, pupilId: pupil_id ?? null }, file_name),
  )

  srv.registerTool(
    'list_assessment_paper_files',
    {
      title: 'List an assessment paper\'s files',
      description: 'List the files attached to an assessment paper: scans, question papers and mark schemes. Teacher-only.',
      inputSchema: { assessment_id: z.string().min(1).describe('Assessment paper id.') },
      outputSchema: { files: z.array(AssessmentFileSchema).nullable() },
    },
    async ({ assessment_id }) => {
      try {
        const files = await listAssessmentFiles(assessment_id)
        return {
          content: [{
            type: 'text' as const,
            text: files.length > 0
              ? files.map((f) => `${f.file_name} (${f.size_bytes} bytes)${f.pupil_id ? ` — pupil ${f.pupil_id}` : ' — not linked to a pupil'}`).join('\n')
              : 'No files are attached to this paper.',
          }],
          structuredContent: { files },
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to list files'
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], structuredContent: { files: null } }
      }
    },
  )

  srv.registerTool(
    'remove_assessment_paper_file',
    {
      title: 'Remove a file from an assessment paper',
      description: 'Delete a file attached to an assessment paper, and its link to a pupil. This cannot be undone.',
      inputSchema: {
        assessment_id: z.string().min(1).describe('Assessment paper id.'),
        file_name: z.string().min(1).describe('File name exactly as list_assessment_paper_files gives it.'),
      },
      outputSchema: { removed: z.boolean() },
    },
    async ({ assessment_id, file_name }) => {
      try {
        const file = (await listAssessmentFiles(assessment_id)).find((f) => f.file_name === file_name)
        if (!file) throw new Error(`File "${file_name}" is not attached to this paper`)
        await removeAssessmentFile(assessment_id, file_name)
        return { content: [{ type: 'text' as const, text: `Removed ${file_name}` }], structuredContent: { removed: true } }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to remove file'
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], structuredContent: { removed: false } }
      }
    },
  )

  srv.registerTool(
    'link_assessment_paper_file_to_pupil',
    {
      title: 'Link an assessment paper file to a pupil',
      description: 'Say whose script a file attached to a paper is. The pupil can open it once the paper\'s feedback is released; '
        + 'unlinked files stay teacher-only. Pass pupil_id null to unlink.',
      inputSchema: {
        assessment_id: z.string().min(1).describe('Assessment paper id.'),
        file_name: z.string().min(1).describe('File name exactly as list_assessment_paper_files gives it.'),
        pupil_id: z.string().min(1).nullable().describe('The pupil whose script it is, or null to unlink.'),
      },
      outputSchema: { file: AssessmentFileSchema.nullable() },
    },
    async ({ assessment_id, file_name, pupil_id }) => {
      try {
        const file = await linkAssessmentFileToPupil(assessment_id, file_name, pupil_id)
        return {
          content: [{ type: 'text' as const, text: pupil_id ? `Linked ${file.file_name} to pupil ${pupil_id}` : `Unlinked ${file.file_name}` }],
          structuredContent: { file },
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to link file'
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], structuredContent: { file: null } }
      }
    },
  )

  // ---------------------------------------------------------------------------
  // Interventions: a lesson written for one pupil (migration 108).
  // ---------------------------------------------------------------------------

  const InterventionOutput = z.object({
    intervention_id: z.string(),
    lesson_id: z.string(),
    lesson_title: z.string(),
    unit_id: z.string(),
    unit_title: z.string(),
    pupil_id: z.string(),
    pupil_name: z.string(),
    group_id: z.string().nullable(),
    set_by_name: z.string().nullable(),
    set_at: z.string(),
    due_date: z.string().nullable(),
    reason: z.string(),
    source_assessment_id: z.string().nullable(),
    status: z.enum(INTERVENTION_STATUSES),
    overdue: z.boolean(),
    started_at: z.string().nullable(),
    completed_at: z.string().nullable(),
    scorable_activities: z.number(),
    submitted_activities: z.number(),
    scored_activities: z.number(),
    score: z.number().nullable(),
    learning_objectives: z.array(z.object({ learning_objective_id: z.string(), title: z.string() })),
  }).passthrough()

  const describeIntervention = (i: InterventionSummary) =>
    `${i.intervention_id} • ${i.pupil_name} • "${i.lesson_title}" (${i.unit_title}) • ${i.status}${i.overdue ? ' (overdue)' : ''}`
    + ` • ${i.submitted_activities}/${i.scorable_activities} done`
    + (i.score === null ? '' : ` • score ${Math.round(i.score * 100)}%`)
    + ` • lesson ${i.lesson_id}`

  srv.registerTool(
    'get_pupil_gaps',
    {
      title: 'Find where a pupil is scoring low',
      description:
        'Return one pupil\'s results per learning objective, weakest first, to decide what an intervention should target. '
        + 'lesson_work is per-criterion marking on their class lessons (each success criterion listed weakest first); '
        + 'assessments are written papers linked to that objective. Scores are 0-1. Intervention work is excluded. '
        + 'Scope with curriculum_id or unit_id (unit_id narrows lesson work only). Get pupil ids from list_group_pupils.',
      inputSchema: {
        pupil_id: z.string().min(1).describe('Pupil user id from list_group_pupils.'),
        curriculum_id: z.string().optional().describe('Only objectives from this curriculum.'),
        unit_id: z.string().optional().describe('Only lesson work from this unit.'),
      },
      outputSchema: {
        gaps: z.array(z.object({}).passthrough()).nullable(),
      },
    },
    async ({ pupil_id, curriculum_id, unit_id }) => {
      try {
        const gaps = await getPupilGaps(pupil_id, { curriculumId: curriculum_id ?? null, unitId: unit_id ?? null })
        return {
          content: [
            {
              type: 'text' as const,
              text: gaps.length > 0
                ? `${gaps.length} learning objectives with results, weakest first.`
                : 'No marked work or assessment results found for this pupil in that scope.',
            },
          ],
          structuredContent: { gaps },
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to read pupil gaps'
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], structuredContent: { gaps: null } }
      }
    },
  )

  srv.registerTool(
    'get_pupil_lesson_feedback',
    {
      title: 'Read a pupil\'s feedback for a lesson',
      description: 'Return one pupil\'s work and feedback on a lesson\'s marked activities, as the assignment results page shows it: '
        + 'their answer, score and status (override = a teacher set the mark), the overall teacher and automatic feedback, and per success criterion '
        + 'the mark, the AI\'s comment, the teacher\'s comment and provenance ("teacher" = set by a teacher, kept on re-mark). '
        + 'A missing answer counts as 0: it has status "missing" and marks_awarded 0 (submission_id null = not answered; set = answered, not yet marked). '
        + 'totals gives the lesson score on the same baseline as every DINO report: marks over the full max of every marked activity. '
        + 'feedback_visibility says whether the pupil can see feedback yet; pupils see nothing until a teacher switches feedback on for that assignment. '
        + 'Get pupil ids from list_group_pupils.',
      inputSchema: {
        pupil_id: z.string().min(1).describe('Pupil user id.'),
        lesson_id: z.string().min(1).describe('Lesson id.'),
        activity_id: z.string().optional().describe('Only this activity.'),
      },
      outputSchema: {
        feedback: z.object({}).passthrough().nullable(),
      },
    },
    async ({ pupil_id, lesson_id, activity_id }) => {
      try {
        const feedback = await getPupilLessonFeedback(pupil_id, lesson_id, activity_id)
        const submitted = feedback.activities.filter((a) => a.submission_id).length
        return {
          content: [{
            type: 'text' as const,
            text: `${feedback.lesson_title}: ${feedback.totals.marks_awarded}/${feedback.totals.max_marks}`
              + `${feedback.totals.percent === null ? '' : ` (${feedback.totals.percent}%)`}, missing answers counted as 0. `
              + `${submitted} of ${feedback.activities.length} marked activities submitted. `
              + (feedback.feedback_visibility.assigned
                ? `Feedback is ${feedback.feedback_visibility.visible_to_pupil ? 'visible' : 'hidden'} to the pupil.`
                : 'This lesson is not assigned to the pupil.'),
          }],
          structuredContent: { feedback },
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to read feedback'
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], structuredContent: { feedback: null } }
      }
    },
  )

  srv.registerTool(
    'set_pupil_feedback',
    {
      title: 'Set a pupil\'s mark or feedback',
      description: 'Give a pupil feedback on one activity, exactly as a teacher does on the assignment results page. '
        + 'Overall (omit success_criteria_id): the whole-activity override — sets the activity mark (0..max_marks) and the teacher comment; '
        + 'whichever you omit keeps its current value. A pupil with no submission gets one created, as on the results page. '
        + 'Per criterion (pass success_criteria_id): sets that criterion\'s mark (0..available) and/or the teacher\'s comment, which replaces the AI\'s; '
        + 'the row becomes provenance "teacher" and survives a re-mark when marks are set. The activity total is recomputed. '
        + 'Pass feedback "" to clear a comment. Read get_pupil_lesson_feedback first. '
        + 'This does not change whether the pupil can see feedback: if feedback is switched on for the assignment, they see the change straight away.',
      inputSchema: {
        pupil_id: z.string().min(1).describe('Pupil user id.'),
        activity_id: z.string().min(1).describe('Activity id.'),
        success_criteria_id: z.string().optional().describe('Set feedback for this criterion. Omit for overall feedback.'),
        marks: z.number().int().min(0).optional().describe('Marks awarded: for the activity (overall) or the criterion.'),
        feedback: z.string().optional().describe('Teacher comment. "" clears it.'),
      },
      outputSchema: {
        result: z.object({}).passthrough().nullable(),
      },
    },
    async ({ pupil_id, activity_id, success_criteria_id, marks, feedback }) => {
      try {
        const result = await setPupilFeedback(caller.userId, {
          pupilId: pupil_id,
          activityId: activity_id,
          successCriteriaId: success_criteria_id,
          marks,
          feedback,
        })
        const visible = result.feedback_visibility.visible_to_pupil
        return {
          content: [{
            type: 'text' as const,
            text: `Saved ${success_criteria_id ? 'criterion' : 'overall'} feedback for ${pupil_id} on ${activity_id}. `
              + (visible ? 'Feedback is switched on, so the pupil can see this now.' : 'Feedback is hidden from the pupil until it is switched on.'),
          }],
          structuredContent: { result },
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to save feedback'
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], structuredContent: { result: null } }
      }
    },
  )

  srv.registerTool(
    'create_intervention',
    {
      title: 'Create an intervention lesson for one pupil',
      description:
        'Create a lesson written for ONE pupil and assign it to them. It sits in unit_id (the unit whose material it covers) '
        + 'but never appears in the unit\'s lesson list, the planner, class reports or the public browser — only the pupil sees it, '
        + 'under "My interventions". Then build it like any lesson: create_activity with the returned lesson_id, and '
        + 'add_success_criterion_to_activity to link the criteria being targeted (use get_pupil_gaps to choose them). '
        + 'learning_objective_ids are linked to the lesson now and must belong to the unit\'s curriculum. '
        + 'group_id is the class it is set from; if omitted, the pupil\'s only class is used. '
        + 'The pupil sees marks and feedback as soon as each activity is marked. Arrays may be sent as JSON strings.',
      inputSchema: {
        pupil_id: z.string().min(1).describe('Pupil user id from list_group_pupils.'),
        unit_id: z.string().min(1).describe('Unit whose material the intervention covers.'),
        title: z.string().min(1).describe('Lesson title the pupil sees, e.g. "Timbers: hardwood vs softwood".'),
        reason: z.string().optional().describe('Why it was set, for teachers, e.g. "Lost marks on AO2 timber questions in Practice B".'),
        due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD.'),
        group_id: z.string().optional().describe('Class it is set from.'),
        source_assessment_id: z.string().optional().describe('Assessment paper that prompted it, if any.'),
        learning_objective_ids: jsonArray(z.string().min(1)).optional().describe('Learning objectives it targets.'),
      },
      outputSchema: { intervention: InterventionOutput.nullable() },
    },
    async ({ pupil_id, unit_id, title, reason, due_date, group_id, source_assessment_id, learning_objective_ids }) => {
      try {
        const intervention = await createIntervention({
          setBy: caller.method === 'oauth' ? caller.userId : null,
          pupilId: pupil_id,
          unitId: unit_id,
          title,
          reason: reason ?? null,
          dueDate: due_date ?? null,
          groupId: group_id ?? null,
          sourceAssessmentId: source_assessment_id ?? null,
          learningObjectiveIds: learning_objective_ids ?? [],
        })
        return {
          content: [{ type: 'text' as const, text: `Created: ${describeIntervention(intervention)}` }],
          structuredContent: { intervention },
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to create intervention'
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], structuredContent: { intervention: null } }
      }
    },
  )

  srv.registerTool(
    'list_interventions',
    {
      title: 'List interventions',
      description:
        'List intervention lessons with their status and score. status is derived from the pupil\'s work: assigned (nothing handed in), '
        + 'in_progress, completed (every scorable activity handed in) or cancelled. score is the mean of the scored activities, 0-1. '
        + 'Filter by pupil_id, group_id and/or statuses.',
      inputSchema: {
        pupil_id: z.string().optional(),
        group_id: z.string().optional(),
        statuses: jsonArray(z.enum(INTERVENTION_STATUSES)).optional().describe('e.g. ["assigned","in_progress"].'),
      },
      outputSchema: { interventions: z.array(InterventionOutput).nullable() },
    },
    async ({ pupil_id, group_id, statuses }) => {
      try {
        const interventions = await readInterventions({ pupilId: pupil_id, groupId: group_id, statuses })
        return {
          content: [
            {
              type: 'text' as const,
              text: interventions.length > 0 ? interventions.map(describeIntervention).join('\n') : 'No interventions match.',
            },
          ],
          structuredContent: { interventions },
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to list interventions'
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], structuredContent: { interventions: null } }
      }
    },
  )

  srv.registerTool(
    'update_intervention',
    {
      title: 'Update an intervention',
      description:
        'Change an intervention\'s title, due date or reason, switch the pupil\'s feedback on or off (feedback_visible, on by default), '
        + 'lock it so the pupil can view but not change it (locked), '
        + 'or cancel it (cancelled: true) or restore it (cancelled: false). '
        + 'A cancelled intervention disappears from the pupil\'s list; their work is kept. Send due_date "" to clear it. '
        + 'Edit its activities with the normal activity tools on its lesson_id.',
      inputSchema: {
        intervention_id: z.string().min(1),
        title: z.string().optional(),
        due_date: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]).optional().describe('YYYY-MM-DD, or "" to clear.'),
        reason: z.string().optional(),
        cancelled: z.boolean().optional(),
        feedback_visible: z.boolean().optional().describe('Whether the pupil sees marks and feedback as soon as they exist.'),
        locked: z.boolean().optional().describe('Read-only for the pupil: no answers, uploads or downloads.'),
      },
      outputSchema: { intervention: InterventionOutput.nullable() },
    },
    async ({ intervention_id, title, due_date, reason, cancelled, feedback_visible, locked }) => {
      try {
        const intervention = await updateIntervention({
          interventionId: intervention_id,
          title,
          dueDate: due_date === undefined ? undefined : due_date || null,
          reason,
          cancelled,
          feedbackVisible: feedback_visible,
          locked,
        })
        return {
          content: [{ type: 'text' as const, text: `Updated: ${describeIntervention(intervention)}` }],
          structuredContent: { intervention },
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to update intervention'
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], structuredContent: { intervention: null } }
      }
    },
  )

  srv.registerTool(
    'status',
    {
      title: 'Server status',
      description: 'Quick health probe that always returns "ok".',
    },
    async () => ({
      content: [{ type: 'text' as const, text: 'ok' }],
      structuredContent: { status: 'ok', timestamp: new Date().toISOString() },
    }),
  )

  return srv
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/** JSON-RPC notifications have no `id` field and expect no response. */
function isJsonRpcNotification(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    !Array.isArray(body) &&
    !('id' in body)
  )
}

/**
 * The SDK labels every tool schema `$schema: draft-07` (hardcoded in its zod
 * conversion, still so in 1.32), and clients that only accept JSON Schema
 * 2020-12 — Claude Desktop among them — reject every tool on the label alone.
 * Dropping the label leaves the MCP default, 2020-12.
 *
 * That is only honest while the schemas use nothing whose meaning differs
 * between the two drafts: no `definitions`/`$ref` (recursive or reused zod
 * schemas), no array-form `items` (z.tuple). None do today; a tool adding one
 * needs the schema converted, not just relabelled.
 */
function dropDraft07Labels(message: JSONRPCMessage): JSONRPCMessage {
  const tools = (message as { result?: { tools?: unknown } }).result?.tools
  if (!Array.isArray(tools)) return message
  for (const tool of tools as Array<Record<string, { $schema?: string } | undefined>>) {
    for (const schema of [tool.inputSchema, tool.outputSchema]) {
      if (schema?.$schema === 'http://json-schema.org/draft-07/schema#') delete schema.$schema
    }
  }
  return message
}

async function handlePost(request: NextRequest): Promise<Response> {
  const auth = await verifyMcpAuthorization(request)
  if (!auth.authorized) {
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        error: { code: -32001, message: auth.reason },
        id: null,
      },
      { status: 401, headers: mcpChallengeHeaders(request) },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null },
      { status: 400 },
    )
  }

  // Notifications (no `id` field) must return 202 Accepted with no body.
  // Awaiting transport.response() for a notification hangs indefinitely
  // because the SDK never calls send() for fire-and-forget messages.
  if (isJsonRpcNotification(body)) {
    return new NextResponse(null, { status: 202 })
  }

  const srv = createMcpServer(auth, publicOrigin(request.headers))
  const transport = new SingleRequestTransport()
  // Suppress unhandled rejection if connect() throws before send() is called
  transport.response().catch(() => {})

  try {
    await srv.connect(transport)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transport.dispatch(body as any)
    const response = await transport.response()
    return NextResponse.json(dropDraft07Labels(response))
  } catch (error) {
    console.error('[mcp] Error handling request:', error)
    return NextResponse.json(
      { jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null },
      { status: 500 },
    )
  } finally {
    await transport.close()
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  return handlePost(request)
}

/**
 * Claude Code establishes a GET SSE stream before sending POST requests.
 * If we close the stream immediately, Claude Code interprets it as a dropped
 * connection and retries endlessly instead of falling through to POST.
 * We keep the stream alive with periodic comment pings and let the client
 * drive the MCP protocol via POST requests as normal.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const auth = await verifyMcpAuthorization(request)
  if (!auth.authorized) {
    return new NextResponse(null, { status: 401, headers: mcpChallengeHeaders(request) })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      // Acknowledge the SSE connection.
      controller.enqueue(encoder.encode(': connected\n\n'))

      // Keepalive ping every 15 s to prevent proxy/client timeouts.
      const interval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'))
        } catch {
          clearInterval(interval)
        }
      }, 15_000)

      // Clean up when the client disconnects.
      request.signal.addEventListener('abort', () => {
        clearInterval(interval)
        try { controller.close() } catch { /* already closed */ }
      })
    },
  })

  return new NextResponse(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

export async function OPTIONS(): Promise<Response> {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-mcp-service-key',
    },
  })
}
