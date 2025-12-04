import { Pool, type PoolClient, type QueryResult } from "pg"

let pool: Pool | null = null
const MAX_CONNECT_RETRIES = 5
const CONNECT_RETRY_DELAY_MS = 200

function resolveConnectionString() {
  return process.env.POSTSQL_URL ?? process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL ?? null
}

function getPool() {
  if (pool) return pool

  const connectionString = resolveConnectionString()
  if (!connectionString) {
    throw new Error("Database connection is not configured (POSTSQL_URL or SUPABASE_DB_URL missing).")
  }

  pool = new Pool({
    connectionString,
    ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false },
  })
  pool.on("error", (error) => {
    console.error("[db] idle client error:", error)
  })

  return pool
}

function resetPool() {
  if (pool) {
    pool.end().catch((error) => console.error("[db] failed to end pool during reset", error))
  }
  pool = null
}

function isRetryableError(error: unknown) {
  const code = (error as { code?: string })?.code?.toLowerCase?.()
  if (code && (code === "econnreset" || code === "etimedout" || code === "econnrefused")) {
    return true
  }
  const message = (error as { message?: string })?.message?.toLowerCase?.() ?? ""
  return message.includes("econnreset") || message.includes("socket hang up")
}

async function getClientWithRetry(): Promise<PoolClient> {
  const activePool = getPool()
  let lastError: unknown

  for (let attempt = 0; attempt < MAX_CONNECT_RETRIES; attempt += 1) {
    try {
      return await activePool.connect()
    } catch (error) {
      lastError = error
      const retryable = isRetryableError(error)
      const hasAttemptsLeft = attempt < MAX_CONNECT_RETRIES - 1
      if (!retryable || !hasAttemptsLeft) {
        throw error
      }
      resetPool()
      const delay = CONNECT_RETRY_DELAY_MS * (attempt + 1)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  throw lastError ?? new Error("Database connection failed")
}

export async function withDbClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getClientWithRetry()
  try {
    return await fn(client)
  } finally {
    client.release()
  }
}

export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  return withDbClient((client) => client.query<T>(text, params))
}
