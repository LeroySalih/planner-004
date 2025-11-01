# Plan: Implement Curriculum MCP Service

## Context
- New MCP specifications describe a curriculum-focused service with two endpoints:
  - `get_all_curriculum` returning an array of `{ curriculum_id, title }`.
  - `get_curriculum` accepting an ID and returning a single `{ curriculum_id, title }`.
- Requests must include `MCP_SERVICE_KEY` for authorization.

## Proposed Steps
1. **Server Scaffold**
   - Introduce an MCP service module (e.g., `src/mcp/curriculum.ts`) handling request routing.
   - Wire authentication middleware/config to validate `MCP_SERVICE_KEY`.
2. **Data Access Layer**
   - Reuse existing curriculum data access or create lightweight helpers (likely in `src/lib/server-actions/curricula.ts`) to fetch curriculum lists/details.
   - Ensure responses match spec shape and only expose required fields.
3. **Endpoint Implementation**
   - Implement `get_all_curriculum` honoring authorization, returning sorted minimal payloads.
   - Implement `get_curriculum` validating the provided ID, returning 404-style errors when missing.
4. **Integration & Registration**
   - Register the MCP handlers with the service host (CLI/server config).
   - Update `src/lib/server-updates.ts` or equivalent export barrel if needed.
5. **Testing & Docs**
   - Add focused tests (unit or integration) covering auth failures and happy paths.
   - Update specs or README snippets if invocation details shift.
