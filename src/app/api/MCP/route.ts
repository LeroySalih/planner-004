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
import { listUnits, findUnitsByTitle, createUnit } from '@/lib/mcp/units'
import { listLessonsForUnit, getLessonObjectives, createLesson, addSuccessCriterionToLesson, removeSuccessCriterionFromLesson, uploadLessonFile } from '@/lib/mcp/lessons'
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
import { ACTIVITY_TYPES, listActivitiesForLesson, createActivity, updateActivity, addSuccessCriterionToActivity, removeSuccessCriterionFromActivity, removeActivity, uploadActivityFile } from '@/lib/mcp/activities'

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
    'get_lessons_for_unit',
    {
      title: 'List lessons for a unit',
      description: 'Return the lessons associated with a given unit.',
      inputSchema: {
        unit_id: z.string().min(1).describe('Unit identifier.'),
      },
      outputSchema: {
        lessons: z.array(
          z.object({
            lesson_id: z.string(),
            unit_id: z.string(),
            title: z.string(),
            is_active: z.boolean(),
            order_index: z.number(),
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
    'get_lesson_objectives',
    {
      title: 'Get lesson objectives and success criteria',
      description: 'Return everything linked to a lesson: its learning objectives, the success criteria under each, and which of the lesson\'s activities use each criterion. '
        + 'Use it to check links after add_success_criterion_to_lesson / add_success_criterion_to_activity, or to find stale ones to remove. '
        + 'linked_to_lesson is false for an LO or SC that only reaches the lesson through a criterion or activity, rather than being linked to the lesson itself.',
      inputSchema: {
        lesson_id: z.string().min(1).describe('Lesson identifier.'),
      },
      outputSchema: {
        lesson: z.object({
          lesson_id: z.string(),
          unit_id: z.string(),
          title: z.string(),
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

  srv.registerTool(
    'create_lesson',
    {
      title: 'Create lesson',
      description: 'Create a new lesson under a unit. Appended at the end of the unit\'s lesson order.',
      inputSchema: {
        unit_id: z.string().min(1).describe('Unit identifier.'),
        title: z.string().min(1).describe('Lesson title.'),
      },
      outputSchema: {
        lesson: z.object({
          lesson_id: z.string(),
          unit_id: z.string(),
          title: z.string(),
          is_active: z.boolean(),
          order_index: z.number(),
        }).nullable(),
      },
    },
    async ({ unit_id, title }) => {
      try {
        const lesson = await createLesson(unit_id, title)
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
      description: 'Update a success criterion. Omitted fields keep their current value.',
      inputSchema: {
        success_criteria_id: z.string().min(1).describe('Success criterion identifier.'),
        description: z.string().min(1).optional().describe('New description.'),
        level: z.number().int().min(1).max(9).optional().describe('New level (1–9).'),
        active: z.boolean().optional().describe('Set false to deactivate, true to reactivate.'),
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
    async ({ success_criteria_id, description, level, active }) => {
      try {
        const success_criterion = await updateSuccessCriterion(success_criteria_id, { description: description ?? null, level: level ?? null, active: active ?? null })
        return {
          content: [{ type: 'text' as const, text: `Updated success criterion ${success_criterion.success_criteria_id} (level ${success_criterion.level})` }],
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
    'create_activity',
    {
      title: 'Create activity',
      description: `Create a new activity under a lesson. Type-specific requirements:
- short-text-question: provide question and model_answer (required).
- multiple-choice-question: provide question, mcq_options (2–4 items), and correct_option_id matching one option id (required).
- text: body_data must be { "text": "<markdown content>", "displayType"?: "default" | "exam-tip" }.
- All other types: use body_data for any extra JSON payload.`,
      inputSchema: z.object({
        lesson_id: z.string().min(1).describe('Lesson identifier.'),
        type: z.enum(ACTIVITY_TYPES).describe(
          'Activity type. Scorable: multiple-choice-question, short-text-question, text-question, long-text-question, upload-file, upload-url, feedback, sketch-render, do-flashcards. Non-scorable: text, display-image, display-flashcards, file-download, show-video, voice, share-my-work, review-others-work, display-section.',
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
      }),
    },
    async ({ lesson_id, type, title, question, model_answer, mcq_options, correct_option_id, body_data, is_summative }) => {
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

        const activity = await createActivity(lesson_id, type, title ?? null, resolvedBodyData, is_summative)
        return {
          content: [{ type: 'text' as const, text: `Created activity ${activity.activity_id} • ${activity.type}${activity.title ? ` — ${activity.title}` : ''}` }],
          structuredContent: { activity },
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to create activity'
        return {
          content: [{ type: 'text' as const, text: message }],
          structuredContent: { activity: null },
        }
      }
    },
  )

  srv.registerTool(
    'update_activity',
    {
      title: 'Update activity',
      description: 'Update title, body_data, or is_summative on an existing activity. At least one field must be provided.',
      inputSchema: z.object({
        activity_id: z.string().describe('UUID of the activity to update'),
        title: z.string().nullable().optional().describe('New title (pass null to clear)'),
        body_data: z.record(z.string(), z.unknown()).nullable().optional().describe('New body data (pass null to clear)'),
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
      }),
    },
    async ({ activity_id, title, body_data, is_summative }) => {
      try {
        const fields: Record<string, unknown> = {}
        if (title !== undefined) fields.title = title
        if (body_data !== undefined) fields.bodyData = body_data
        if (is_summative !== undefined) fields.isSummative = is_summative

        const activity = await updateActivity(activity_id, fields)
        return {
          content: [{ type: 'text' as const, text: `Updated activity ${activity_id}${activity.is_summative ? ' (summative)' : ''}` }],
          structuredContent: { activity },
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {
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
      description: 'Returns the URL and form fields needed to upload a file directly to a file-download or display-image activity via multipart POST — no base64 encoding required.',
      inputSchema: z.object({
        lesson_id: z.string().describe('UUID of the lesson'),
        activity_id: z.string().describe('UUID of the file-download or display-image activity'),
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
        instructions: `Send a multipart/form-data POST to upload_url. Authenticate with the same Authorization header you use for this MCP connection (the service key or your OAuth access token). Add the form_fields as form fields. Include the file under the field name "file". Max file size 5 MB. Activity must be type file-download or display-image.`,
      }
      return {
        content: [{ type: 'text' as const, text: `Upload to: POST ${uploadUrl}\nForm fields: lesson_id=${lesson_id}, activity_id=${activity_id}\nFile field name: file` }],
        structuredContent: result,
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
        const file = await uploadLessonFile(lesson_id, file_name, base64_content, content_type ?? null)
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
      title: 'Upload file to file-download or display-image activity',
      description: 'Uploads a base64-encoded file to a file-download activity (so pupils can download it) or a display-image activity (to set its image).',
      inputSchema: z.object({
        lesson_id: z.string().describe('UUID of the lesson'),
        activity_id: z.string().describe('UUID of the file-download or display-image activity'),
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
        const file = await uploadActivityFile(lesson_id, activity_id, file_name, base64_content, content_type ?? null)
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
        'Store a file (question paper, mark scheme, scan) against a paper. Content is base64, max 5 MB; uploading the same file_name again replaces it. '
        + 'Downloads are teacher-only.',
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
