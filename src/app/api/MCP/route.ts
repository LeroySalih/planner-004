import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import { verifyMcpAuthorization } from '@/lib/mcp/auth'
import { SingleRequestTransport } from '@/lib/mcp/transport'
import {
  listCurriculumSummaries,
  getCurriculumSummary,
  findCurriculumIdsByTitle,
  createCurriculum,
} from '@/lib/mcp/curriculum'
import {
  fetchCurriculumLosc,
  createAssessmentObjective,
  createLearningObjective,
  createSuccessCriterion,
} from '@/lib/mcp/losc'
import { listUnits, findUnitsByTitle, createUnit } from '@/lib/mcp/units'
import { listLessonsForUnit, createLesson, addSuccessCriterionToLesson } from '@/lib/mcp/lessons'
import { ACTIVITY_TYPES, listActivitiesForLesson, createActivity, removeActivity, uploadActivityFile } from '@/lib/mcp/activities'

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

function createMcpServer(): McpServer {
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
      description: 'Create a new unit. Units are always created inactive so the teacher can review before activating.',
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
      description: 'Create a new activity under a lesson.',
      inputSchema: {
        lesson_id: z.string().min(1).describe('Lesson identifier.'),
        type: z.enum(ACTIVITY_TYPES).describe(
          'Activity type. Scorable: multiple-choice-question, short-text-question, text-question, long-text-question, upload-file, upload-url, feedback, sketch-render, do-flashcards. Non-scorable: text, display-image, display-flashcards, file-download, show-video, voice, share-my-work, review-others-work, display-section.',
        ),
        title: z.string().optional().describe('Optional activity title.'),
        body_data: z.record(z.string(), z.unknown()).optional().describe('Optional activity body JSON.'),
        is_summative: z.boolean().optional().describe('Mark as summative assessment (scorable types only).'),
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
        }).nullable(),
      },
    },
    async ({ lesson_id, type, title, body_data, is_summative }) => {
      try {
        const activity = await createActivity(lesson_id, type, title ?? null, body_data ?? null, is_summative)
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
    'upload_activity_file',
    {
      title: 'Upload file to file-download activity',
      description: 'Uploads a base64-encoded file to a file-download activity so pupils can download it. The unit must be inactive.',
      inputSchema: z.object({
        lesson_id: z.string().describe('UUID of the lesson'),
        activity_id: z.string().describe('UUID of the file-download activity'),
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

async function handlePost(request: NextRequest): Promise<Response> {
  const auth = verifyMcpAuthorization(request)
  if (!auth.authorized) {
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        error: { code: -32001, message: auth.reason ?? 'Unauthorized' },
        id: null,
      },
      { status: 401 },
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

  const srv = createMcpServer()
  const transport = new SingleRequestTransport()
  // Suppress unhandled rejection if connect() throws before send() is called
  transport.response().catch(() => {})

  try {
    await srv.connect(transport)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transport.dispatch(body as any)
    const response = await transport.response()
    return NextResponse.json(response)
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
  const auth = verifyMcpAuthorization(request)
  if (!auth.authorized) {
    return new NextResponse(null, { status: 401 })
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
