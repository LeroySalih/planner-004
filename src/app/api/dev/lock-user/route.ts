import { NextResponse } from "next/server"
import { query } from "@/lib/db"

// DEV ONLY — remove after testing
export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 403 })
  }

  const { firstName, lastName } = await request.json()

  const { rows } = await query<{ user_id: string; email: string }>(
    "SELECT user_id, email FROM profiles WHERE first_name ILIKE $1 AND last_name ILIKE $2",
    [firstName, lastName],
  )

  if (!rows.length) {
    return NextResponse.json({ error: `No profile found for "${firstName} ${lastName}"` }, { status: 404 })
  }

  const { user_id, email } = rows[0]

  for (let i = 0; i < 5; i++) {
    await query(
      `INSERT INTO sign_in_attempts (email, ip, user_id, success, reason, attempted_at)
       VALUES ($1, NULL, $2, false, 'invalid-password', now() - interval '30 seconds')`,
      [email, user_id],
    )
  }

  return NextResponse.json({ ok: true, userId: user_id, email, message: `Account locked for ${firstName} ${lastName}` })
}
