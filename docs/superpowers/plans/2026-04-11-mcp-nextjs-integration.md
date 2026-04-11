# MCP Next.js Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the standalone `MCP/` Express server with a proper MCP protocol route handler inside the Next.js app, then delete `MCP/`.

**Architecture:** Module-level `McpServer` singleton with all 8 tools registered at startup. Each HTTP request creates a new `SingleRequestTransport` — a custom `Transport` implementation that bridges Next.js's Fetch API (which Route Handlers use) to the MCP SDK (which expects Node.js HTTP objects). The singleton must be module-level so initialization state persists: Claude Code sends `initialize` once on first connection; a per-request server would be uninitialized when tool calls arrive. `StreamableHTTPServerTransport` from the spec cannot be used in Next.js Route Handlers — this custom transport replaces it.

**Tech Stack:** `@modelcontextprotocol/sdk@^1.21.1`, Next.js 15 App Router Route Handlers, `pg` via `src/lib/db.ts`, TypeScript, zod

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `src/lib/mcp/transport.ts` | `SingleRequestTransport` — Transport interface bridge |
| Create | `src/lib/mcp/units.ts` | `listUnits()`, `findUnitsByTitle()` |
| Create | `src/lib/mcp/lessons.ts` | `listLessonsForUnit()` |
| Modify | `src/lib/mcp/curriculum.ts` | Add `findCurriculumIdsByTitle()` |
| Create | `src/app/api/mcp/route.ts` | McpServer singleton + route handler |
| Create | `.mcp.json` | MCP client config for Claude Code |
| Modify | `.claude/launch.json` | Remove `mcp-dev` entry |
| Modify | `package.json` | Add `@modelcontextprotocol/sdk` |
| Delete | `MCP/` | Entire standalone server directory |

---

### Task 1: Install dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the MCP SDK**

```bash
pnpm add @modelcontextprotocol/sdk
```

Expected output includes: `@modelcontextprotocol/sdk` added to `dependencies` in `package.json`.

- [ ] **Step 2: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add @modelcontextprotocol/sdk"
```

---

### Task 2: Create `SingleRequestTransport`

The MCP SDK's `Transport` interface is the contract between `McpServer` and the HTTP layer. `StreamableHTTPServerTransport` implements it for Node.js HTTP, but Next.js Route Handlers use the Fetch API. This file provides an implementation that works in that context.

For each request, the route handler will:
1. Create a `SingleRequestTransport`
2. Call `server.connect(transport)` (sets `transport.onmessage` to the server's handler)
3. Call `transport.dispatch(body)` to push the incoming JSON-RPC message to the server
4. Await `transport.response()` which resolves when the server calls `transport.send()`
5. Return the resolved message as JSON

**Files:**
- Create: `src/lib/mcp/transport.ts`

- [ ] **Step 1: Write `src/lib/mcp/transport.ts`**

```typescript
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

/**
 * Single-request transport for Next.js Route Handlers.
 *
 * StreamableHTTPServerTransport (the standard MCP transport) requires Node.js
 * IncomingMessage / ServerResponse, which Next.js App Router Route Handlers
 * don't expose. This transport implements the Transport interface using
 * a promise-based request/response cycle compatible with the Fetch API.
 *
 * Concurrency note: the module-level McpServer singleton sets _transport per
 * request. Concurrent requests can cause _transport to point to the wrong
 * transport when the server calls send(). This is acceptable for a
 * single-user dev tool where concurrent MCP requests are extremely unlikely.
 */
export class SingleRequestTransport implements Transport {
  private readonly _responsePromise: Promise<JSONRPCMessage>
  private _resolveResponse!: (msg: JSONRPCMessage) => void
  private _rejectResponse!: (err: Error) => void

  onmessage?: (message: JSONRPCMessage) => void
  onclose?: () => void
  onerror?: (error: Error) => void

  constructor() {
    this._responsePromise = new Promise<JSONRPCMessage>((resolve, reject) => {
      this._resolveResponse = resolve
      this._rejectResponse = reject
    })
  }

  async start(): Promise<void> {
    // no-op: no connection setup needed
  }

  async close(): Promise<void> {
    this.onclose?.()
  }

  /** Called by McpServer to send a response back to the client. */
  async send(message: JSONRPCMessage): Promise<void> {
    this._resolveResponse(message)
  }

  /** Push an incoming JSON-RPC message from the HTTP request to the server. */
  dispatch(message: JSONRPCMessage): void {
    this.onmessage?.(message)
  }

  /** Resolves when the server calls send() with the response. */
  response(): Promise<JSONRPCMessage> {
    return this._responsePromise
  }
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors. If `@modelcontextprotocol/sdk` types are not found, verify Task 1 completed.

- [ ] **Step 3: Commit**

```bash
git add src/lib/mcp/transport.ts
git commit -m "feat: add SingleRequestTransport for Next.js MCP integration"
```

---

### Task 3: Add `findCurriculumIdsByTitle` to `src/lib/mcp/curriculum.ts`

The standalone server had this on the Supabase client. This ports it to raw SQL: wildcard patterns use `ILIKE`, regex patterns (wrapped in `/…/`) use PostgreSQL's `~*` operator (case-insensitive regex).

**Files:**
- Modify: `src/lib/mcp/curriculum.ts`

- [ ] **Step 1: Add the type and function to `src/lib/mcp/curriculum.ts`**

Append after the last export in the file:

```typescript
export type CurriculumTitleMatch = {
  curriculum_id: string
  curriculum_title: string
}

export async function findCurriculumIdsByTitle(queryStr: string): Promise<CurriculumTitleMatch[]> {
  const normalized = queryStr.trim()
  if (!normalized) return []

  const isRegex =
    normalized.startsWith('/') && normalized.endsWith('/') && normalized.length > 2

  let sql: string
  let param: string

  if (isRegex) {
    // Strip surrounding slashes, use PostgreSQL case-insensitive regex
    const pattern = normalized.slice(1, -1)
    sql =
      'SELECT curriculum_id, title FROM curricula WHERE title ~* $1 ORDER BY title ASC LIMIT 200'
    param = pattern
  } else {
    // Convert glob wildcards (* → %, ? → _), wrap bare terms in %…%
    const escaped = normalized.replace(/[%_]/g, (m) => `\\${m}`)
    const replaced = escaped.replace(/\*/g, '%').replace(/\?/g, '_')
    const pattern =
      replaced.includes('%') || replaced.includes('_') ? replaced : `%${replaced}%`
    sql =
      'SELECT curriculum_id, title FROM curricula WHERE title ILIKE $1 ORDER BY title ASC LIMIT 200'
    param = pattern
  }

  const { rows } = await query(sql, [param])

  return (rows ?? []).map((row) => ({
    curriculum_id: typeof row.curriculum_id === 'string' ? row.curriculum_id : String(row.curriculum_id ?? ''),
    curriculum_title: typeof row.title === 'string' ? row.title : '',
  }))
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/mcp/curriculum.ts
git commit -m "feat: add findCurriculumIdsByTitle to MCP curriculum service"
```

---

### Task 4: Create `src/lib/mcp/units.ts`

**Files:**
- Create: `src/lib/mcp/units.ts`

- [ ] **Step 1: Write `src/lib/mcp/units.ts`**

```typescript
import { query } from '@/lib/db'

export type UnitSummary = {
  unit_id: string
  title: string
  is_active: boolean
}

export type UnitTitleMatch = {
  unit_id: string
  unit_title: string
}

export async function listUnits(): Promise<UnitSummary[]> {
  const { rows } = await query(
    'SELECT unit_id, title, active FROM units ORDER BY title ASC',
  )

  return (rows ?? []).map((row) => ({
    unit_id: typeof row.unit_id === 'string' ? row.unit_id : String(row.unit_id ?? ''),
    title: typeof row.title === 'string' ? row.title : '',
    is_active: row.active === true,
  }))
}

export async function findUnitsByTitle(queryStr: string): Promise<UnitTitleMatch[]> {
  const normalized = queryStr.trim()
  if (!normalized) return []

  const isRegex =
    normalized.startsWith('/') && normalized.endsWith('/') && normalized.length > 2

  let sql: string
  let param: string

  if (isRegex) {
    const pattern = normalized.slice(1, -1)
    sql = 'SELECT unit_id, title FROM units WHERE title ~* $1 ORDER BY title ASC LIMIT 200'
    param = pattern
  } else {
    const escaped = normalized.replace(/[%_]/g, (m) => `\\${m}`)
    const replaced = escaped.replace(/\*/g, '%').replace(/\?/g, '_')
    const pattern =
      replaced.includes('%') || replaced.includes('_') ? replaced : `%${replaced}%`
    sql = 'SELECT unit_id, title FROM units WHERE title ILIKE $1 ORDER BY title ASC LIMIT 200'
    param = pattern
  }

  const { rows } = await query(sql, [param])

  return (rows ?? []).map((row) => ({
    unit_id: typeof row.unit_id === 'string' ? row.unit_id : String(row.unit_id ?? ''),
    unit_title: typeof row.title === 'string' ? row.title : '',
  }))
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/mcp/units.ts
git commit -m "feat: add MCP units data service"
```

---

### Task 5: Create `src/lib/mcp/lessons.ts`

**Files:**
- Create: `src/lib/mcp/lessons.ts`

- [ ] **Step 1: Write `src/lib/mcp/lessons.ts`**

```typescript
import { query } from '@/lib/db'

export type LessonSummary = {
  lesson_id: string
  unit_id: string
  title: string
  is_active: boolean
  order_index: number
}

export async function listLessonsForUnit(unitId: string): Promise<LessonSummary[]> {
  const { rows } = await query(
    `SELECT lesson_id, unit_id, title, active, order_by
     FROM lessons
     WHERE unit_id = $1
     ORDER BY order_by ASC NULLS LAST, title ASC`,
    [unitId],
  )

  return (rows ?? []).map((row, index) => {
    const rawOrder = row.order_by
    const numericOrder =
      typeof rawOrder === 'number'
        ? rawOrder
        : typeof rawOrder === 'string'
          ? Number.parseInt(rawOrder, 10)
          : null

    return {
      lesson_id: typeof row.lesson_id === 'string' ? row.lesson_id : String(row.lesson_id ?? ''),
      unit_id: typeof row.unit_id === 'string' ? row.unit_id : String(row.unit_id ?? ''),
      title: typeof row.title === 'string' ? row.title : '',
      is_active: row.active === true,
      order_index: Number.isFinite(numericOrder) ? (numericOrder as number) : index,
    }
  })
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/mcp/lessons.ts
git commit -m "feat: add MCP lessons data service"
```

---

### Task 6: Create the MCP route handler

This is the main deliverable. The file creates a module-level `McpServer` singleton, registers all 8 tools, and exports a `POST` handler that connects the singleton to a per-request `SingleRequestTransport`.

`GET` is exported to handle the optional SSE stream probe that Claude Code may send when establishing a connection — it returns an empty SSE response that closes immediately, signalling that push notifications are not available and the client should use request/response mode.

**Files:**
- Create: `src/app/api/mcp/route.ts`

- [ ] **Step 1: Write `src/app/api/mcp/route.ts`**

```typescript
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
// McpServer singleton — tools registered once at module load.
//
// The singleton is required so that initialization state (from the JSON-RPC
// `initialize` handshake) persists across requests. Claude Code sends
// `initialize` once on first connection; subsequent requests are tool calls
// and expect the server to already be initialized.
// ---------------------------------------------------------------------------

const server = new McpServer(
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

server.registerTool(
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

server.registerTool(
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
        isError: true,
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

server.registerTool(
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

server.registerTool(
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
        isError: true,
      }
    }
    return {
      content: [
        {
          type: 'text' as const,
          text: `${curriculum.title} (${curriculum.curriculum_id}) • ${curriculum.learning_objectives.length} learning objectives.\n${JSON.stringify(curriculum, null, 2)}`,
        },
      ],
      structuredContent: { learning_objectives: curriculum.learning_objectives },
    }
  },
)

server.registerTool(
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

server.registerTool(
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

server.registerTool(
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

server.registerTool(
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

  const transport = new SingleRequestTransport()

  try {
    await server.connect(transport)
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
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors. If the MCP SDK types aren't resolving, check that `pnpm install` was run after Task 1.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/mcp/route.ts
git commit -m "feat: add MCP protocol handler to Next.js app"
```

---

### Task 7: Add `.mcp.json`

This file registers the MCP server with Claude Code. It lives at the project root so Claude Code picks it up automatically when opened in this directory.

**Files:**
- Create: `.mcp.json`

- [ ] **Step 1: Write `.mcp.json`**

```json
{
  "mcpServers": {
    "planner": {
      "type": "http",
      "url": "http://localhost:3000/api/mcp"
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add .mcp.json
git commit -m "chore: add .mcp.json for Claude Code MCP registration"
```

---

### Task 8: Remove `mcp-dev` from `.claude/launch.json`

**Files:**
- Modify: `.claude/launch.json`

- [ ] **Step 1: Update `.claude/launch.json`**

Remove the `mcp-dev` entry. The file should contain only the `next-dev` configuration:

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "next-dev",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["dev"],
      "port": 3000
    }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add .claude/launch.json
git commit -m "chore: remove mcp-dev launch config (server now in Next.js)"
```

---

### Task 9: Delete the standalone `MCP/` directory

**Files:**
- Delete: `MCP/` (entire directory)

- [ ] **Step 1: Remove the directory**

```bash
rm -rf MCP/
```

- [ ] **Step 2: Commit the deletion**

```bash
git add -A
git commit -m "chore: delete standalone MCP server (integrated into Next.js)"
```

---

### Task 10: Smoke test

With the Next.js dev server running (`pnpm dev`), verify the MCP endpoint responds correctly.

- [ ] **Step 1: Verify the dev server is running**

```bash
curl -s http://localhost:3000/api/mcp -o /dev/null -w "%{http_code}"
```

Expected: `405` (GET without Accept: text/event-stream returns method allowed, but without SSE headers it may 405 — acceptable). If the server isn't running, start it with `pnpm dev` in another terminal.

- [ ] **Step 2: Test MCP initialize handshake**

```bash
curl -s -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": { "name": "smoke-test", "version": "1.0.0" }
    }
  }' | python3 -m json.tool
```

Expected: JSON response with `result.serverInfo.name = "planner-mcp-server"` and a `capabilities` object listing tools.

- [ ] **Step 3: Test tools/list**

```bash
curl -s -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | python3 -m json.tool
```

Expected: JSON with `result.tools` array containing 8 tools: `get_all_curriculum`, `get_curriculum`, `get_curriculum_id_from_title`, `get_all_los_and_scs_for_curriculum`, `get_all_units`, `get_unit_by_title`, `get_lessons_for_unit`, `status`.

- [ ] **Step 4: Test a tool call**

```bash
curl -s -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": { "name": "status", "arguments": {} }
  }' | python3 -m json.tool
```

Expected: JSON with `result.content[0].text = "ok"` and `result.structuredContent.status = "ok"`.

- [ ] **Step 5: Test a database-backed tool call**

```bash
curl -s -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 4,
    "method": "tools/call",
    "params": { "name": "get_all_curriculum", "arguments": {} }
  }' | python3 -m json.tool
```

Expected: JSON with `result.structuredContent.curricula` array containing curriculum objects. If the array is empty, the database might be empty — that's fine. Any error indicates a database connectivity or SQL issue.

- [ ] **Step 6: Verify type-check and lint pass**

```bash
npx tsc --noEmit && pnpm lint
```

Expected: no TypeScript errors, no lint errors.

---

## Self-Review

**Spec coverage:**
- ✅ `@modelcontextprotocol/sdk` added to root `package.json` (Task 1)
- ✅ All 8 tools implemented in `route.ts` (Task 6)
- ✅ `pg` used for all data access (Tasks 3–5, existing curriculum/losc files)
- ✅ `verifyMcpAuthorization` applied to all handlers (Task 6)
- ✅ Module-level `McpServer` singleton (Task 6)
- ✅ `.mcp.json` added (Task 7)
- ✅ `mcp-dev` removed from `launch.json` (Task 8)
- ✅ `MCP/` directory deleted (Task 9)
- ✅ Existing `/api/MCP/*` REST routes untouched (no task touches them)
- ✅ `findCurriculumIdsByTitle` ported: wildcard → ILIKE, regex → `~*` (Task 3)

**Deviation from spec noted:** The spec references `StreamableHTTPServerTransport` but this transport requires Node.js `IncomingMessage`/`ServerResponse` which Next.js App Router Route Handlers don't expose. `SingleRequestTransport` (Task 2) is the necessary adaptation — it implements the same `Transport` interface and achieves the same stateless request/response contract.
