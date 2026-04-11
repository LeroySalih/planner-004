# MCP Server — Next.js Integration Design

**Date:** 2026-04-11
**Status:** Approved

## Goal

Replace the standalone `MCP/` Express server with a proper MCP protocol handler inside the Next.js app, then delete the `MCP/` directory. The result is one server to run instead of two.

## Approach

Module-level `McpServer` singleton in a Next.js Route Handler. All 8 tools are registered once at module load. Each HTTP request gets its own stateless `StreamableHTTPServerTransport` (`sessionIdGenerator: undefined`). This mirrors exactly what the standalone server does — minus Express, minus Supabase, minus the separate process.

## Architecture

```
src/
├── app/api/mcp/
│   └── route.ts          ← NEW: MCP protocol handler (GET, POST, DELETE, OPTIONS)
├── lib/mcp/
│   ├── auth.ts           ← unchanged
│   ├── curriculum.ts     ← unchanged (listCurriculumSummaries, getCurriculumSummary)
│   ├── losc.ts           ← unchanged (fetchCurriculumLosc)
│   ├── stream.ts         ← unchanged (still used by existing REST routes)
│   ├── units.ts          ← NEW: listUnits, findUnitsByTitle
│   └── lessons.ts        ← NEW: listLessonsForUnit
```

Existing `/api/MCP/*` REST routes are untouched — they serve REST consumers and don't conflict with `/api/mcp`.

## Dependencies

Add `@modelcontextprotocol/sdk` to root `package.json` dependencies.

## Data Layer

All data functions use the existing `query()` helper from `src/lib/db.ts`. No new database connections.

| Tool | Function | File | Status |
|---|---|---|---|
| `get_all_curriculum` | `listCurriculumSummaries()` | `src/lib/mcp/curriculum.ts` | exists |
| `get_curriculum` | `getCurriculumSummary(id)` | `src/lib/mcp/curriculum.ts` | exists |
| `get_curriculum_id_from_title` | `findCurriculumIdsByTitle(query)` | `src/lib/mcp/curriculum.ts` | new |
| `get_all_los_and_scs_for_curriculum` | `fetchCurriculumLosc(id)` | `src/lib/mcp/losc.ts` | exists |
| `get_all_units` | `listUnits()` | `src/lib/mcp/units.ts` | new |
| `get_unit_by_title` | `findUnitsByTitle(query)` | `src/lib/mcp/units.ts` | new |
| `get_lessons_for_unit` | `listLessonsForUnit(id)` | `src/lib/mcp/lessons.ts` | new |
| `status` | inline | `src/app/api/mcp/route.ts` | new |

### `findCurriculumIdsByTitle` SQL port

The standalone server uses Supabase `.ilike()` and `.filter('title', 'regex', …)`. The `pg` port:
- Wildcard patterns (`*`, `?`) → `WHERE title ILIKE $1` (with `*`→`%`, `?`→`_` substitution)
- `/regex/` patterns → `WHERE title ~ $1` (PostgreSQL regex, case-insensitive via `~*`)

## Route Handler — `src/app/api/mcp/route.ts`

```
module load:
  McpServer instantiated
  all 8 tools registered

per request (GET / POST / DELETE / OPTIONS):
  1. verifyMcpAuthorization(request) → 401 if rejected
  2. new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  3. res.on('close') → transport.close()
  4. server.connect(transport)
  5. transport.handleRequest(req, res, body)
```

## Auth

`verifyMcpAuthorization()` from `src/lib/mcp/auth.ts` is called before the transport handles the request. Accepts `Authorization: Bearer <key>` or `x-mcp-service-key: <key>` headers. Controlled by `MCP_SERVICE_KEY` env var (if unset, all requests pass through).

## CORS

Not needed. Claude Code connects directly over localhost. Next.js does not require explicit CORS headers for same-origin local connections.

## MCP Client Config

Add `.mcp.json` to the project root so Claude Code registers the server automatically:

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

## Cleanup

**Delete:**
- `MCP/` directory (entire tree: src, dist, package.json, tsconfig.json, package-lock.json)
- `mcp-dev` entry from `.claude/launch.json`

**Keep:**
- `src/app/api/MCP/*` REST routes — untouched
- `src/lib/mcp/auth.ts`, `curriculum.ts`, `losc.ts`, `stream.ts` — untouched

## Out of Scope

- Migrating or removing the existing `/api/MCP/*` REST routes
- Session-based stateful MCP transport
- Edge runtime support (MCP SDK requires Node.js runtime)
