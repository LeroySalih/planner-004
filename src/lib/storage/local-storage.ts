import { createHash } from "node:crypto"
import { createReadStream, promises as fs } from "node:fs"
import path from "node:path"

import { query, withDbClient } from "@/lib/db"

type StorageError = { message: string }

type StorageFile = {
  name: string
  path: string
  created_at?: string
  updated_at?: string
  last_accessed_at?: string
  metadata?: { size?: number; contentType?: string }
}

type UploadOptions = {
  contentType?: string
  uploadedBy?: string | null
  originalPath?: string | null
}

const BASE_DIR = path.join(process.cwd(), "files")

function timestampSuffix() {
  const now = new Date()
  const pad = (value: number) => value.toString().padStart(2, "0")
  return `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}_${pad(now.getHours())}-${pad(
    now.getMinutes(),
  )}-${pad(now.getSeconds())}`
}

function sanitiseSegment(segment: string) {
  return segment.replace(/(\.\.(\/|\\|$))+/g, "").replace(/[\\]/g, "/").replace(/^\//, "").replace(/\/$/, "")
}

function parseFullPath(fullPath: string) {
  const cleaned = sanitiseSegment(fullPath)
  const parts = cleaned.split("/").filter(Boolean)
  const fileName = parts.pop()
  const scopePath = parts.join("/")
  if (!fileName) {
    throw new Error("Invalid file path")
  }
  return { scopePath, fileName }
}

async function ensureBaseDir(relativePath: string) {
  const dir = path.join(BASE_DIR, relativePath)
  await fs.mkdir(dir, { recursive: true })
  return dir
}

function normalizeScope(bucket: string, scopePath: string) {
  const cleaned = sanitiseSegment(scopePath)
  const prefix = `${bucket}/`
  return cleaned.startsWith(prefix) ? cleaned.slice(prefix.length) : cleaned
}

async function fileExists(targetPath: string) {
  try {
    await fs.stat(targetPath)
    return true
  } catch (error: any) {
    if (error?.code === "ENOENT") return false
    throw error
  }
}

function buildVersionedName(fileName: string) {
  const dotIndex = fileName.lastIndexOf(".")
  const suffix = timestampSuffix()
  if (dotIndex === -1) {
    return `${fileName}_${suffix}`
  }
  const base = fileName.slice(0, dotIndex)
  const extension = fileName.slice(dotIndex)
  return `${base}_${suffix}${extension}`
}

function resolveDiskPath(storedPath: string) {
  return path.join(BASE_DIR, storedPath)
}

async function writeFileToDisk(storedRelativePath: string, buffer: Buffer) {
  const diskPath = resolveDiskPath(storedRelativePath)
  await ensureBaseDir(path.dirname(storedRelativePath))
  await fs.writeFile(diskPath, buffer)
  return diskPath
}

function toStorageFile(row: Record<string, any>): StorageFile {
  return {
    name: row.file_name,
    path: path.join(row.scope_path, row.file_name).replace(/\\/g, "/"),
    created_at: row.created_at ?? undefined,
    updated_at: row.updated_at ?? undefined,
    metadata: {
      size: typeof row.size_bytes === "number" ? row.size_bytes : undefined,
      contentType: typeof row.content_type === "string" ? row.content_type : undefined,
    },
  }
}

async function listFiles(bucket: string, prefix: string, options?: { limit?: number; search?: string }) {
  try {
    const normalizedPrefix = normalizeScope(bucket, prefix)
    const params: unknown[] = [bucket, normalizedPrefix]
    let paramIndex = 3
    const searchClause = options?.search ? `and file_name ilike $${paramIndex++}` : ""
    if (options?.search) {
      params.push(`%${options.search}%`)
    }
    const limitClause = options?.limit ? `limit $${paramIndex++}` : ""
    if (options?.limit) {
      params.push(options.limit)
    }

    const { rows } = await query(
      `
        select file_name, scope_path, created_at, updated_at, size_bytes, content_type
        from stored_files
        where bucket = $1
          and scope_path = $2
          ${searchClause}
        order by updated_at desc
        ${limitClause}
      `,
      params,
    )

    return { data: rows.map(toStorageFile), error: null as StorageError | null }
  } catch (error) {
    console.error("[storage] Failed to list files", { bucket, prefix, error })
    return { data: null, error: { message: "Unable to list files" } }
  }
}

async function uploadFile(bucket: string, fullPath: string, body: ArrayBuffer | Buffer, options?: UploadOptions) {
  const { scopePath, fileName } = parseFullPath(fullPath)
  const normalizedScope = normalizeScope(bucket, scopePath)
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body)

  try {
    await withDbClient(async (client) => {
      await client.query("begin")

      const { rows } = await client.query<{ id: string; stored_path: string; file_name: string }>(
        `
          select id, stored_path, file_name
          from stored_files
          where bucket = $1
            and scope_path = $2
            and file_name = $3
          limit 1
          for update
        `,
        [bucket, normalizedScope, fileName],
      )

      const existing = rows?.[0]
      if (existing) {
        const versionedName = buildVersionedName(existing.file_name)
        const versionedRelative = path.join(bucket, normalizedScope, versionedName).replace(/\\/g, "/")
        const currentDiskPath = resolveDiskPath(existing.stored_path)
        const versionedDiskPath = resolveDiskPath(versionedRelative)
        const currentExists = await fileExists(currentDiskPath)
        if (currentExists) {
          await ensureBaseDir(path.dirname(versionedRelative))
          await fs.rename(currentDiskPath, versionedDiskPath)
        }
        await client.query(
          `
            update stored_files
            set file_name = $1,
                stored_path = $2,
                updated_at = timezone('utc', now())
            where id = $3
          `,
          [versionedName, versionedRelative, existing.id],
        )
      }

      const storedRelativePath = path.join(bucket, normalizedScope, fileName).replace(/\\/g, "/")
      await writeFileToDisk(storedRelativePath, buffer)
      const checksum = createHash("sha256").update(buffer).digest("hex")

      await client.query(
        `
          insert into stored_files (
            bucket, scope_path, file_name, stored_path, size_bytes, content_type, checksum, uploaded_by, original_path, created_at, updated_at
          ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, timezone('utc', now()), timezone('utc', now()))
          on conflict (bucket, scope_path, file_name) do update
          set stored_path = excluded.stored_path,
              size_bytes = excluded.size_bytes,
              content_type = excluded.content_type,
              checksum = excluded.checksum,
              uploaded_by = excluded.uploaded_by,
              original_path = excluded.original_path,
              updated_at = timezone('utc', now())
        `,
        [
          bucket,
          normalizedScope,
          fileName,
          storedRelativePath,
          buffer.byteLength,
          options?.contentType ?? null,
          checksum,
          options?.uploadedBy ?? null,
          options?.originalPath ?? null,
        ],
      )

      await client.query("commit")
    })

    return { data: { path: fullPath }, error: null as StorageError | null }
  } catch (error) {
    console.error("[storage] Failed to upload file", { bucket, fullPath, error })
    return { data: null, error: { message: error instanceof Error ? error.message : "Upload failed" } }
  }
}

async function moveFile(bucket: string, fromPath: string, toPath: string) {
  const { scopePath: rawFromScope, fileName: fromName } = parseFullPath(fromPath)
  const { scopePath: rawToScope, fileName: toName } = parseFullPath(toPath)
  const fromScope = normalizeScope(bucket, rawFromScope)
  const toScope = normalizeScope(bucket, rawToScope)

  try {
    const { rows } = await query<{ id: string; stored_path: string }>(
      `
        select id, stored_path
        from stored_files
        where bucket = $1
          and scope_path = $2
          and file_name = $3
        limit 1
      `,
      [bucket, fromScope, fromName],
    )
    const row = rows?.[0]
    if (!row) {
      return { error: { message: "File not found" } as StorageError }
    }

    const sourceDiskPath = resolveDiskPath(row.stored_path)
    const targetRelative = path.join(bucket, toScope, toName).replace(/\\/g, "/")
    const targetDiskPath = resolveDiskPath(targetRelative)

    const exists = await fileExists(sourceDiskPath)
    if (exists) {
      await ensureBaseDir(path.dirname(targetRelative))
      await fs.rename(sourceDiskPath, targetDiskPath)
    }

    await query(
      `
        update stored_files
        set scope_path = $1,
            file_name = $2,
            stored_path = $3,
            updated_at = timezone('utc', now())
        where id = $4
      `,
      [toScope, toName, targetRelative, row.id],
    )

    return { error: null as StorageError | null }
  } catch (error) {
    console.error("[storage] Failed to move file", { bucket, fromPath, toPath, error })
    return { error: { message: "Unable to move file" } }
  }
}

async function removeFiles(bucket: string, paths: string[]) {
  try {
    for (const fullPath of paths) {
      const { scopePath: rawScopePath, fileName } = parseFullPath(fullPath)
      const scopePath = normalizeScope(bucket, rawScopePath)
      const { rows } = await query<{ id: string; stored_path: string }>(
        `
          delete from stored_files
          where bucket = $1
            and scope_path = $2
            and file_name = $3
          returning stored_path
        `,
        [bucket, scopePath, fileName],
      )
      const removedPath = rows?.[0]?.stored_path
      if (removedPath) {
        const diskPath = resolveDiskPath(removedPath)
        try {
          await fs.unlink(diskPath)
        } catch (error: any) {
          if (error?.code !== "ENOENT") {
            throw error
          }
        }
      }
    }
    return { error: null as StorageError | null }
  } catch (error) {
    console.error("[storage] Failed to remove files", { bucket, error })
    return { error: { message: "Unable to delete files" } }
  }
}

async function getFileMetadata(bucket: string, fullPath: string) {
  const { scopePath: rawScope, fileName } = parseFullPath(fullPath)
  const scopePath = normalizeScope(bucket, rawScope)
  const { rows } = await query(
    `
      select file_name, scope_path, stored_path, content_type, size_bytes, created_at, updated_at
      from stored_files
      where bucket = $1
        and scope_path = $2
        and file_name = $3
      limit 1
    `,
    [bucket, scopePath, fileName],
  )
  return rows?.[0] ?? null
}

export function createLocalStorageClient(bucket: string) {
  return {
    list: (prefix: string, options?: { limit?: number; search?: string }) => listFiles(bucket, prefix, options),
    upload: (fullPath: string, body: ArrayBuffer | Buffer, options?: UploadOptions) =>
      uploadFile(bucket, fullPath, body, options),
    move: (fromPath: string, toPath: string) => moveFile(bucket, fromPath, toPath),
    remove: (paths: string[]) => removeFiles(bucket, paths),
    createSignedUrl: async (fullPath: string) => {
      try {
        const { scopePath: rawScope, fileName } = parseFullPath(fullPath)
        const scopePath = normalizeScope(bucket, rawScope)
        const parts = [
          bucket,
          ...scopePath.split("/").filter(Boolean),
          fileName,
        ].map(encodeURIComponent)
        const urlPath = parts.join("/")
        return { data: { signedUrl: `/api/files/${urlPath}` }, error: null as StorageError | null }
      } catch (error) {
        return { data: null, error: { message: "Invalid path" } }
      }
    },
    stat: (fullPath: string) => getFileMetadata(bucket, fullPath),
    getFileStream: async (fullPath: string) => {
      const metadata = await getFileMetadata(bucket, fullPath)
      if (!metadata) {
        return { stream: null, error: { message: "File not found" } as StorageError }
      }
      const storedPath = (metadata as { stored_path?: string }).stored_path
      if (!storedPath) {
        return { stream: null, error: { message: "File not found" } as StorageError }
      }
      const diskPath = resolveDiskPath(storedPath)
      const exists = await fileExists(diskPath)
      if (!exists) {
        return { stream: null, error: { message: "File not found" } }
      }
      return {
        stream: createReadStream(diskPath),
        metadata,
        error: null as StorageError | null,
      }
    },
  }
}

export type LocalStorageClient = ReturnType<typeof createLocalStorageClient>
