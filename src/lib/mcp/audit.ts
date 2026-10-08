import { query } from '@/lib/db'
import type { McpCaller } from '@/lib/mcp/auth'

// Reads are logged too, but flagged so the changes can be filtered out.
const isReadTool = (tool: string) => tool === 'status' || tool.startsWith('get_') || tool.startsWith('list_')

// File bodies arrive base64-encoded and run to megabytes; the log keeps their
// size, not their bytes. Any other oversized string is capped for the same reason.
const OMITTED_KEYS = new Set(['base64_content'])
const MAX_STRING = 20_000

function redact(value: unknown, key = ''): unknown {
  if (typeof value === 'string') {
    if (OMITTED_KEYS.has(key) || value.length > MAX_STRING) return `[omitted: ${value.length} chars]`
    return value
  }
  if (Array.isArray(value)) return value.map((item) => redact(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)]))
  }
  return value
}

export type McpAuditEntry = {
  tool: string
  args: unknown
  error: string | null
  durationMs: number
}

/**
 * Records one MCP call. Never throws: a failed log write is reported to the
 * server log rather than failing the call it describes.
 */
export async function recordMcpCall(caller: McpCaller, entry: McpAuditEntry): Promise<void> {
  try {
    await query(
      `insert into mcp_audit_log
         (auth_method, user_id, user_name, user_email, oauth_client_id, oauth_client_name,
          tool, is_write, arguments, outcome, error, duration_ms)
       select $1, p.user_id, nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.email,
              $3::text, c.client_name, $4, $5, $6::jsonb, $7, $8, $9
         from (select 1) one
         left join profiles p on p.user_id = $2
         left join oauth_clients c on c.client_id = $3`,
      [
        caller.method,
        caller.userId,
        caller.clientId,
        entry.tool,
        !isReadTool(entry.tool),
        JSON.stringify(redact(entry.args ?? {})),
        entry.error ? 'error' : 'ok',
        entry.error,
        Math.round(entry.durationMs),
      ],
    )
  } catch (error) {
    console.error('[mcp] failed to write audit log entry', entry.tool, error)
  }
}
