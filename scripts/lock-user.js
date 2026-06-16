#!/usr/bin/env node
// Usage: node scripts/lock-user.js "First" "Last"
// Inserts 5 failed sign-in attempts to simulate a lockout.

require("dotenv").config({ path: ".env" })
const { Pool } = require("pg")

const [, , firstName, lastName] = process.argv
if (!firstName || !lastName) {
  console.error("Usage: node scripts/lock-user.js <firstName> <lastName>")
  process.exit(1)
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

async function run() {
  const { rows } = await pool.query(
    "SELECT user_id, email FROM profiles WHERE first_name ILIKE $1 AND last_name ILIKE $2",
    [firstName, lastName],
  )

  if (!rows.length) {
    console.error(`No profile found for "${firstName} ${lastName}"`)
    process.exit(1)
  }

  const { user_id, email } = rows[0]
  console.log(`Found: ${user_id} <${email}>`)

  for (let i = 0; i < 5; i++) {
    await pool.query(
      `INSERT INTO sign_in_attempts (email, ip, user_id, success, reason, attempted_at)
       VALUES ($1, NULL, $2, false, 'invalid-password', now() - interval '30 seconds')`,
      [email, user_id],
    )
  }

  console.log(`Inserted 5 failed attempts — account is now locked.`)
  await pool.end()
}

run().catch((e) => {
  console.error(e.message)
  pool.end()
  process.exit(1)
})
