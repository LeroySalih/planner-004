/**
 * Standalone environment verification: `pnpm check:env`
 *
 * Loads .env and validates it against the same startup manifest the server uses
 * (src/lib/env/required-env.ts), without booting Next. Exits 0 when all required
 * variables are present, 1 otherwise. Variable VALUES are never printed.
 */
import "dotenv/config"

import { checkRequiredEnv } from "../src/lib/env/required-env"

const { ok, missing, missingGroups } = checkRequiredEnv()

if (ok) {
  console.log("✓ all required environment variables are present")
  process.exit(0)
}

console.error(`FATAL: ${missing.length + missingGroups.length} environment problem(s):`)
for (const name of missing) console.error(`  - MISSING: ${name}`)
for (const group of missingGroups) {
  console.error(`  - MISSING: at least one of [${group.join(", ")}]`)
}
process.exit(1)
