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
} from '@/lib/mcp/curriculum'
import { fetchCurriculumLosc } from '@/lib/mcp/losc'
import { listUnits, findUnitsByTitle } from '@/lib/mcp/units'
import { listLessonsForUnit } from '@/lib/mcp/lessons'

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
 * Claude Code may send a GET request to establish an SSE stream for
 * server-to-client push notifications. We don't use server push, so we
 * return an empty SSE stream that closes immediately — signalling to the
 * client to fall back to request/response mode for all communication.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const auth = verifyMcpAuthorization(request)
  if (!auth.authorized) {
    return new NextResponse(null, { status: 401 })
  }

  const stream = new ReadableStream({
    start(controller) {
      controller.close()
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
