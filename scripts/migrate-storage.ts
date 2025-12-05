/**
 * Migration helper to copy Supabase storage objects into the local FS-backed storage.
 * Run with: npx tsx scripts/migrate-storage.ts
 */
import { Buffer } from "node:buffer"

import { createLocalStorageClient } from "@/lib/storage/local-storage"
import { query } from "@/lib/db"
import dotenv from "dotenv"

dotenv.config({ path: ".env" })

type StorageObject = {
  path: string
  size?: number
  contentType?: string | null
}

const BUCKETS = ["lessons", "units"]
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function getSupabaseServiceClient() {
  const module = await import("@/lib/supabase/server")
  return module.createSupabaseServiceClient()
}

async function resolveEmail(userId: string, cache: Map<string, string | null>) {
  if (cache.has(userId)) {
    return cache.get(userId)
  }
  const { rows } = await query<{ email: string | null }>(
    `
      select email
      from profiles
      where user_id = $1
      limit 1
    `,
    [userId],
  )
  const email = rows?.[0]?.email ?? null
  cache.set(userId, email)
  return email
}

async function transformPath(path: string, emailCache: Map<string, string | null>) {
  const segments = path.split("/").filter(Boolean)
  const mapped: string[] = []
  for (const segment of segments) {
    if (UUID_REGEX.test(segment)) {
      const email = await resolveEmail(segment, emailCache)
      mapped.push(email ?? segment)
    } else {
      mapped.push(segment)
    }
  }
  return mapped.join("/")
}

async function migrateBucket(bucketName: string) {
  const supabase = await getSupabaseServiceClient()
  const storage = createLocalStorageClient(bucketName)
  const bucket = supabase.storage.from(bucketName)
  const emailCache = new Map<string, string | null>()
  let imported = 0
  let skipped = 0
  let failed = 0
  const queue = [""]

  while (queue.length > 0) {
    const prefix = queue.pop() ?? ""
    const { data, error } = await bucket.list(prefix, { limit: 100 })

    if (error) {
      console.error(`[migrate-storage] Failed to list ${bucketName}/${prefix}`, error)
      continue
    }
    console.log(`[migrate-storage] Listed prefix ${bucketName}/${prefix || "(root)"} with ${(data ?? []).length} entries`)

    for (const entry of data ?? []) {
      const entryPath = prefix ? `${prefix}/${entry.name}` : entry.name
      const isFile = Boolean((entry as any).id) || Boolean(entry.metadata)
      if (!isFile) {
        queue.push(entryPath)
        continue
      }

      console.log(
        `[migrate-storage] Processing ${bucketName}/${entryPath} (size=${entry.metadata?.size ?? "?"})`,
      )

      try {
        const { data: fileData, error: downloadError } = await bucket.download(entryPath)
        if (downloadError || !fileData) {
          console.warn("[migrate-storage] Skipping download due to error", {
            bucket: bucketName,
            path: entryPath,
            error: downloadError,
          })
          skipped += 1
          continue
        }

        const mappedPath = await transformPath(entryPath, emailCache)
        const buffer = Buffer.from(await fileData.arrayBuffer())
        console.log(`[migrate-storage] Downloaded ${entryPath} (${buffer.byteLength} bytes)`)
        const { error: uploadError } = await storage.upload(mappedPath, buffer, {
          contentType:
            (entry.metadata as any)?.mimetype ?? (entry.metadata as any)?.contentType ?? "application/octet-stream",
          originalPath: `${bucketName}/${entryPath}`,
        })

        if (uploadError) {
          failed += 1
          console.error("[migrate-storage] Failed to import file", {
            bucket: bucketName,
            sourcePath: entryPath,
            targetPath: mappedPath,
            error: uploadError,
          })
        } else {
          imported += 1
          console.log(`[migrate-storage] Imported ${bucketName}/${entryPath} -> ${mappedPath}`)
        }
      } catch (err) {
        failed += 1
        console.error("[migrate-storage] Unexpected failure importing file", {
          bucket: bucketName,
          path: entryPath,
          error: err,
        })
      }
    }
  }

  console.log(
    `[migrate-storage] Bucket ${bucketName} summary: imported=${imported}, skipped=${skipped}, failed=${failed}`,
  )
}

async function main() {
  const missing: string[] = []
  if (!process.env.SUPABASE_URL) missing.push("SUPABASE_URL")
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY")
  const dbUrl = process.env.POSTSQL_URL ?? process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL
  if (!dbUrl) missing.push("POSTSQL_URL|SUPABASE_DB_URL|DATABASE_URL")

  if (missing.length > 0) {
    console.error("[migrate-storage] Missing required environment variables:", missing.join(", "))
    console.error("[migrate-storage] Aborting migration until environment is configured.")
    process.exit(1)
  }

  // Ensure stored_files table exists before attempting inserts
  try {
    const { rows } = await query<{ exists: boolean }>(
      `select exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'stored_files') as exists`,
    )
    if (!rows?.[0]?.exists) {
      console.error("[migrate-storage] Table public.stored_files does not exist. Run the migration first.")
      process.exit(1)
    }
  } catch (error) {
    console.error("[migrate-storage] Unable to verify stored_files table", error)
    process.exit(1)
  }

  for (const bucket of BUCKETS) {
    console.log(`[migrate-storage] Migrating bucket: ${bucket}`)
    await migrateBucket(bucket)
  }
  console.log("[migrate-storage] Migration complete.")
}

void main()
