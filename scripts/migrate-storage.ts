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

async function listAllObjects(bucketName: string) {
  const supabase = await getSupabaseServiceClient()
  const bucket = supabase.storage.from(bucketName)
  const queue = [""]
  const results: StorageObject[] = []

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
      if (!entry.metadata) {
        queue.push(entryPath)
      } else {
        results.push({
          path: entryPath,
          size: entry.metadata?.size,
          contentType: (entry.metadata as any)?.mimetype ?? (entry.metadata as any)?.contentType ?? null,
        })
      }
    }
  }

  return results
}

async function migrateBucket(bucketName: string) {
  const supabase = await getSupabaseServiceClient()
  const storage = createLocalStorageClient(bucketName)
  const bucket = supabase.storage.from(bucketName)
  const objects = await listAllObjects(bucketName)
  const emailCache = new Map<string, string | null>()

  for (const object of objects) {
    const { data, error } = await bucket.download(object.path)
    if (error || !data) {
      console.warn("[migrate-storage] Skipping download due to error", { bucket: bucketName, path: object.path, error })
      continue
    }

    const mappedPath = await transformPath(object.path, emailCache)
    const buffer = Buffer.from(await data.arrayBuffer())
    const { error: uploadError } = await storage.upload(mappedPath, buffer, {
      contentType: object.contentType ?? "application/octet-stream",
      originalPath: `${bucketName}/${object.path}`,
    })

    if (uploadError) {
      console.error("[migrate-storage] Failed to import file", {
        bucket: bucketName,
        sourcePath: object.path,
        targetPath: mappedPath,
        error: uploadError,
      })
    } else {
      console.log(`[migrate-storage] Imported ${bucketName}/${object.path} -> ${mappedPath}`)
    }
  }
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

  for (const bucket of BUCKETS) {
    console.log(`[migrate-storage] Migrating bucket: ${bucket}`)
    await migrateBucket(bucket)
  }
  console.log("[migrate-storage] Migration complete.")
}

void main()
