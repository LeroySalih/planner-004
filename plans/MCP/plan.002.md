# Plan: Implement LOSC MCP Endpoints

## Context
- New LOSC spec introduces the `get_all_los_and_scs` tool, accepting curriculum identifiers and returning learning objectives plus success criteria.
- Responses must stream JSON (HTTP Streamable) and accept both GET and POST.

## Proposed Steps
1. **Endpoint Design**
   - Decide on REST paths (e.g., `/api/MCP/losc`) and ensure discovery advertises the new tool.
   - Define input contract: handle curriculum id via query/body for GET/POST.
2. **Data Retrieval Logic**
   - Add service functions (e.g., `src/lib/mcp/losc.ts`) that fetch curricula, learning objectives, and related success criteria using the service-role Supabase client.
   - Shape data to match spec: include `learning_objectives`, each with `spec_ref`, `active`, and nested `scs`.
   - Optimise DB access: prefer a single query with joins or batched requests to minimise network round trips.
3. **Handlers & Streaming**
   - Implement route handlers that reuse auth/telemetry helpers, accept GET/POST, and stream chunked JSON via `streamJsonResponse`.
   - Return meaningful errors (bad request, not found, internal).
4. **Discovery Update**
   - Append LOSC tool metadata (`methods`, `path`, `description`) to discovery payload.
5. **Validation**
   - Run TypeScript checks; smoke-test streaming via curl/Postman.
   - Consider adding tests or fixtures to validate nested response shape.
