# Plan: Align MCP Curriculum Service with Updated Specs

## Context
- MCP spec now specifies the service surfaces at `/api/MCP`.
- Curriculum responses must include `is_active` alongside `curriculum_id` and `title`.

## Proposed Steps
1. **Routing Alignment**
   - Ensure MCP routes are exposed under `/api/MCP` (including curriculum endpoints).
   - Update any references or docs pointing to old paths/ports.
2. **Data Shape Updates**
   - Extend Supabase queries to select the `active` column.
   - Map the boolean to `is_active` in list and single responses.
3. **API Adjustments**
   - Update handler typings and payload structures to include `is_active`.
   - Accept both `GET` and `POST` for discovery and curriculum endpoints with consistent responses.
   - Verify Supabase service-role usage remains intact through `SUPABASE_SERVICE_ROLE_KEY`.
4. **Validation**
   - Exercise the endpoints (curl/Postman) to confirm the new paths and payload shape.
   - Add test coverage where practical to lock in the schema.
