const { Pool } = require("pg")

function resolveConnectionString() {
  return process.env.POSTSQL_URL ?? process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL ?? null
}

function getPoolOptions(connectionString) {
  return {
    connectionString,
    ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false },
  }
}

async function main() {
  const connectionString = resolveConnectionString()
  if (!connectionString) {
    console.error("No database URL provided (POSTSQL_URL, SUPABASE_DB_URL, or DATABASE_URL)")
    process.exitCode = 1
    return
  }

  const pool = new Pool(getPoolOptions(connectionString))

  try {
    const { rows } = await pool.query("select now() as now")
    console.log("✅ pg connection test succeeded:", rows[0])
  } catch (error) {
    console.error("❌ pg connection test failed", error instanceof Error ? error.message : error)
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}

void main()
