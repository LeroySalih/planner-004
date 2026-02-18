"use server";

import { performance } from "node:perf_hooks";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Client } from "pg";

import { SubmissionStatusSchema } from "@/types";
import { query } from "@/lib/db";
import { requireAuthenticatedProfile } from "@/lib/auth";
import { emitSubmissionEvent, emitUploadEvent } from "@/lib/sse/topics";
import { logActivitySubmissionEvent } from "@/lib/activity-logging";
import { createLocalStorageClient } from "@/lib/storage/local-storage";
import { withTelemetry } from "@/lib/telemetry";

const LESSON_FILES_BUCKET = "lessons";

const ActivityFileSchema = z.object({
  name: z.string(),
  path: z.string(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  last_accessed_at: z.string().optional(),
  size: z.number().optional(),
  submission_id: z.string().nullable().optional(),
  status: SubmissionStatusSchema.default("inprogress"),
  submitted_at: z.string().nullable().optional(),
  instructions: z.string().nullable().optional(),
  uploaded_at: z.string().optional(),
});

const UploadedFileSchema = z.object({
  name: z.string(),
  path: z.string(),
  size: z.number().optional(),
  status: SubmissionStatusSchema.default("inprogress"),
  instructions: z.string().nullable().optional(),
  uploaded_at: z.string().optional(),
});

const ActivityFilesReturnValue = z.object({
  data: z.array(ActivityFileSchema).nullable(),
  error: z.string().nullable(),
});

function resolvePgConnectionString() {
  return process.env.DATABASE_URL ?? null;
}

function createPgClient() {
  const connectionString = resolvePgConnectionString();
  if (!connectionString) {
    throw new Error(
      "Database connection is not configured (DATABASE_URL missing).",
    );
  }

  return new Client({
    connectionString,
    ssl: connectionString.includes("localhost")
      ? false
      : { rejectUnauthorized: false },
  });
}

function buildDirectory(lessonId: string, activityId: string) {
  return `lessons/${lessonId}/activities/${activityId}`;
}

function buildLegacyDirectory(lessonId: string, activityId: string) {
  return `${lessonId}/activities/${activityId}`;
}

function buildFilePath(lessonId: string, activityId: string, fileName: string) {
  return `${buildDirectory(lessonId, activityId)}/${fileName}`;
}

function buildSubmissionDirectory(
  lessonId: string,
  activityId: string,
  pupilId: string,
) {
  return `${buildDirectory(lessonId, activityId)}/${pupilId}`;
}

function buildLegacySubmissionDirectory(
  lessonId: string,
  activityId: string,
  pupilId: string,
) {
  return `${buildLegacyDirectory(lessonId, activityId)}/${pupilId}`;
}

function buildSubmissionPath(
  lessonId: string,
  activityId: string,
  pupilId: string,
  fileName: string,
) {
  return `${
    buildSubmissionDirectory(lessonId, activityId, pupilId)
  }/${fileName}`;
}

function buildLegacySubmissionPath(
  lessonId: string,
  activityId: string,
  pupilId: string,
  fileName: string,
) {
  return `${
    buildLegacySubmissionDirectory(lessonId, activityId, pupilId)
  }/${fileName}`;
}

function isStorageNotFoundError(error: { message?: string } | null): boolean {
  if (!error?.message) {
    return false;
  }
  const normalized = error.message.toLowerCase();
  return normalized.includes("not found") ||
    normalized.includes("object not found");
}

const pupilStorageKeyCache = new Map<string, string>();

function normaliseTimestamp(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return undefined;
}

export async function resolvePupilStorageKey(pupilId: string) {
  if (pupilStorageKeyCache.has(pupilId)) {
    return pupilStorageKeyCache.get(pupilId) as string;
  }

  try {
    const { rows } = await query<{ email: string | null }>(
      `
        select email
        from profiles
        where user_id = $1
        limit 1
      `,
      [pupilId],
    );

    const email = rows?.[0]?.email?.trim();
    const resolved = email && email.length > 0 ? email : pupilId;
    pupilStorageKeyCache.set(pupilId, resolved);
    return resolved;
  } catch (error) {
    console.error(
      "[lesson-activity-files] Failed to resolve pupil email for storage path",
      error,
      { pupilId },
    );
    pupilStorageKeyCache.set(pupilId, pupilId);
    return pupilId;
  }
}

export async function listActivityFilesAction(
  lessonId: string,
  activityId: string,
) {
  const directory = buildDirectory(lessonId, activityId);
  const storage = createLocalStorageClient(LESSON_FILES_BUCKET);

  const { data, error } = await storage.list(directory, { limit: 100 });

  if (error) {
    if (error.message?.toLowerCase().includes("not found")) {
      return ActivityFilesReturnValue.parse({ data: [], error: null });
    }
    console.error("[v0] Failed to list activity files:", error);
    return ActivityFilesReturnValue.parse({ data: null, error: error.message });
  }

  const normalized = (data ?? [])
    .map((file) =>
      ActivityFileSchema.parse({
        name: file.name,
        path: buildFilePath(lessonId, activityId, file.name),
        created_at: normaliseTimestamp(file.created_at),
        updated_at: normaliseTimestamp(file.updated_at),
        last_accessed_at: normaliseTimestamp(file.last_accessed_at),
        size: file.metadata?.size ?? undefined,
      })
    )
    .sort((a, b) => {
      const aTime = Date.parse(a.updated_at ?? a.created_at ?? "0");
      const bTime = Date.parse(b.updated_at ?? b.created_at ?? "0");
      return bTime - aTime;
    });

  return ActivityFilesReturnValue.parse({ data: normalized, error: null });
}

export async function uploadActivityFileAction(formData: FormData) {
  const authStart = performance.now();
  const profile = await requireAuthenticatedProfile({
    refreshSessionCookie: true,
  });
  const authEnd = performance.now();

  const unitId = formData.get("unitId");
  const lessonId = formData.get("lessonId");
  const activityId = formData.get("activityId");
  const file = formData.get("file");

  if (typeof unitId !== "string" || unitId.trim() === "") {
    return { success: false, error: "Missing unit identifier" };
  }

  if (typeof lessonId !== "string" || lessonId.trim() === "") {
    return { success: false, error: "Missing lesson identifier" };
  }

  if (typeof activityId !== "string" || activityId.trim() === "") {
    return { success: false, error: "Missing activity identifier" };
  }

  if (!(file instanceof File)) {
    return { success: false, error: "No file provided" };
  }

  if (file.size > 5 * 1024 * 1024) {
    return { success: false, error: "File exceeds 5MB limit" };
  }

  return withTelemetry(
    {
      routeTag: "/lessons:activity-files",
      functionName: "uploadActivityFileAction",
      params: { unitId, lessonId, activityId, fileName: file.name },
      authEndTime: authEnd,
    },
    async () => {
      const storage = createLocalStorageClient(LESSON_FILES_BUCKET);
      const fileName = file.name;
      const fullPath = buildFilePath(lessonId, activityId, fileName);

      const arrayBuffer = await file.arrayBuffer();
      const { error } = await storage.upload(fullPath, arrayBuffer, {
        contentType: file.type || "application/octet-stream",
        uploadedBy: profile.userId,
        originalPath: fullPath,
      });

      if (error) {
        console.error("[v0] Failed to upload activity file:", error);
        return { success: false, error: error.message };
      }

      await emitUploadEvent("upload.activity.file_added", {
        unitId,
        lessonId,
        activityId,
        fileName,
        submittedBy: profile.userId,
      });

      revalidatePath(`/units/${unitId}`);
      return { success: true };
    },
  );
}

export async function deleteActivityFileAction(
  unitId: string,
  lessonId: string,
  activityId: string,
  fileName: string,
) {
  const storage = createLocalStorageClient(LESSON_FILES_BUCKET);
  const { error } = await storage.remove([
    buildFilePath(lessonId, activityId, fileName),
  ]);

  if (error) {
    console.error("[v0] Failed to delete activity file:", error);
    return { success: false, error: error.message };
  }

  revalidatePath(`/units/${unitId}`);
  return { success: true };
}

export async function getActivityFileDownloadUrlAction(
  lessonId: string,
  activityId: string,
  fileName: string,
) {
  const storage = createLocalStorageClient(LESSON_FILES_BUCKET);
  const { data, error } = await storage.createSignedUrl(
    buildFilePath(lessonId, activityId, fileName),
  );

  if (error) {
    const message = error.message ?? "";
    const normalized = message.toLowerCase();
    if (
      normalized.includes("not found") ||
      normalized.includes("object not found")
    ) {
      return { success: false, error: "NOT_FOUND" };
    }
    console.error(
      "[v0] Failed to create download URL for activity file:",
      error,
    );
    return { success: false, error: message };
  }

  return { success: true, url: data?.signedUrl ?? null };
}

export async function listPupilActivitySubmissionsAction(
  lessonId: string,
  activityId: string,
  pupilId: string,
) {
  const routeTag = "/pupil-lessons";

  return withTelemetry(
    {
      routeTag,
      functionName: "listPupilActivitySubmissionsAction",
      params: { lessonId, activityId, pupilId },
    },
    async () => {
      const storage = createLocalStorageClient(LESSON_FILES_BUCKET);
      const client = createPgClient();

      try {
        await client.connect();

        const { rows } = await client.query(
          `
            select submission_id, submission_status, submitted_at, body, coalesce(body->>'upload_file_name', '') as file_name, coalesce(body->>'instructions', '') as instructions, case when body::jsonb ? 'uploaded_files' then body->'uploaded_files' else null end as uploaded_files
            from submissions
            where activity_id = $1 and user_id = $2
            order by submitted_at desc
            limit 1
          `,
          [activityId, pupilId],
        );

        const row = rows[0];

        if (!row) {
          return ActivityFilesReturnValue.parse({ data: [], error: null });
        }

        const uploadedFiles = Array.isArray(row.uploaded_files)
          ? row.uploaded_files
          : row.file_name
          ? [{
            name: row.file_name,
            // We'll construct path dynamically below for legacy
            path: "",
            uploaded_at: typeof row.submitted_at === "string"
              ? row.submitted_at
              : row.submitted_at?.toISOString() ?? new Date().toISOString(),
            status:
              SubmissionStatusSchema.safeParse(row.submission_status).data ??
                "inprogress",
            instructions: row.instructions || null,
          }]
          : [];

        const pupilStorageKey = await resolvePupilStorageKey(pupilId);

        // Helper to check existence in storage
        const checkStorage = async (fileList: any[]) => {
          const results = [];
          for (const fileItem of fileList) {
            const directories = [
              buildSubmissionDirectory(lessonId, activityId, pupilStorageKey),
              buildLegacySubmissionDirectory(
                lessonId,
                activityId,
                pupilStorageKey,
              ),
            ].filter((value, index, array) => array.indexOf(value) === index);

            let matchedPath: string | null = null;
            let metadata: {
              created_at?: string;
              updated_at?: string;
              last_accessed_at?: string;
              size?: number;
            } = {};
            let lastError: { message?: string } | null = null;

            // If we already have a path stored and it looks valid, try that first?
            // Actually, legacy didn't store full path in DB usually, just filename.
            // New items will store path.

            // Try to find the file in known directories
            for (const directory of directories) {
              // Optimization: we could list once per directory, but for now loop is safe for small # of files
              const { data, error } = await storage.list(directory, {
                limit: 100,
                search: fileItem.name,
              });

              if (error) {
                if (isStorageNotFoundError(error)) {
                  lastError = error;
                  continue;
                }
                // Log but continue
                console.error("[v0] Storage list error:", error);
              }

              const match = (data ?? []).find((f) => f.name === fileItem.name);
              if (match) {
                matchedPath = `${directory}/${match.name}`;
                metadata = {
                  created_at: normaliseTimestamp(match.created_at),
                  updated_at: normaliseTimestamp(match.updated_at),
                  last_accessed_at: normaliseTimestamp(match.last_accessed_at),
                  size: match.metadata?.size ?? undefined,
                };
                break;
              }
            }

            if (matchedPath) {
              results.push(ActivityFileSchema.parse({
                name: fileItem.name,
                path: matchedPath,
                ...metadata,
                submission_id: row?.submission_id ?? null,
                status: fileItem.status,
                submitted_at: fileItem.uploaded_at, // Use uploaded_at as submitted_at for file
                instructions: fileItem.instructions,
                size: metadata.size ?? fileItem.size,
              }));
            } else if (fileItem.path) {
              // If we have a stored path but couldn't verify it with list, return it anyway?
              // Maybe it's better to return it so user sees it exists in DB even if storage is missing
              results.push(ActivityFileSchema.parse({
                name: fileItem.name,
                path: fileItem.path,
                submission_id: row?.submission_id ?? null,
                status: fileItem.status,
                submitted_at: fileItem.uploaded_at,
                instructions: fileItem.instructions,
                size: fileItem.size,
              }));
            }
          }
          return results;
        };

        const normalizedFiles = await checkStorage(uploadedFiles);

        return ActivityFilesReturnValue.parse({
          data: normalizedFiles,
          error: null,
        });
      } catch (error) {
        console.error(
          "[v0] Unexpected error listing pupil submissions:",
          error,
        );
        return ActivityFilesReturnValue.parse({
          data: null,
          error: "Unable to load pupil submissions.",
        });
      } finally {
        try {
          await client.end();
        } catch {
          // ignore close errors
        }
      }
    },
  );
}

export async function uploadPupilActivitySubmissionAction(formData: FormData) {
  const lessonId = formData.get("lessonId");
  const activityId = formData.get("activityId");
  const pupilId = formData.get("pupilId");
  const file = formData.get("file");

  const routeTag = "/pupil-lessons";

  return withTelemetry(
    {
      routeTag,
      functionName: "uploadPupilActivitySubmissionAction",
      params: { lessonId, activityId, pupilId },
    },
    async () => {
      if (typeof lessonId !== "string" || lessonId.trim() === "") {
        return { success: false, error: "Missing lesson identifier" };
      }

      if (typeof activityId !== "string" || activityId.trim() === "") {
        return { success: false, error: "Missing activity identifier" };
      }

      if (typeof pupilId !== "string" || pupilId.trim() === "") {
        return { success: false, error: "Missing pupil identifier" };
      }

      if (!(file instanceof File)) {
        return { success: false, error: "No file provided" };
      }

      if (file.size > 5 * 1024 * 1024) {
        return { success: false, error: "File exceeds 5MB limit" };
      }

      const profile = await requireAuthenticatedProfile();

      if (profile.userId !== pupilId) {
        return {
          success: false,
          error: "You can only upload files for your own account.",
        };
      }

      const userId = profile.userId;
      const storage = createLocalStorageClient(LESSON_FILES_BUCKET);
      const pupilStorageKey = profile.email?.trim() ??
        (await resolvePupilStorageKey(userId));

      const fileName = file.name;
      const path = buildSubmissionPath(
        lessonId,
        activityId,
        pupilStorageKey,
        fileName,
      );

      const arrayBuffer = await file.arrayBuffer();
      const { error: uploadError } = await storage.upload(path, arrayBuffer, {
        contentType: file.type || "application/octet-stream",
        uploadedBy: userId,
        originalPath: path,
      });

      if (uploadError) {
        console.error("[v0] Failed to upload pupil submission:", uploadError);
        return { success: false, error: uploadError.message };
      }

      const submittedAt = new Date().toISOString();
      let submissionId: string | null = null;
      const client = createPgClient();

      try {
        await client.connect();

        // Sync logic for multiple files
        try {
          // 1. Get existing submission
          const { rows: existingRows } = await client.query(
            `
              select submission_id, body
              from submissions
              where activity_id = $1 and user_id = $2
              order by submitted_at desc
              limit 1
            `,
            [activityId, userId],
          );

          const existing = existingRows[0];
          let uploadedFiles: z.infer<typeof UploadedFileSchema>[] = [];

          if (existing?.body) {
            const body = existing.body;
            if (Array.isArray(body.uploaded_files)) {
              uploadedFiles = body.uploaded_files;
            } else if (body.upload_file_name) {
              // Convert legacy
              uploadedFiles.push({
                name: body.upload_file_name,
                path: "", // Legacy didn't store path
                status: "inprogress",
                instructions: body.instructions || null,
                uploaded_at: existing.submitted_at?.toISOString() ??
                  new Date().toISOString(),
              });
            }
          }

          // 2. Check for duplicate name
          const duplicateIndex = uploadedFiles.findIndex((f) =>
            f.name === fileName
          );

          if (duplicateIndex !== -1) {
            const oldFile = uploadedFiles[duplicateIndex];
            // Generate versioned name
            const pad = (n: number) => n.toString().padStart(2, "0");
            const now = new Date();
            const timestamp = `${pad(now.getDate())}-${
              pad(now.getMonth() + 1)
            }-${now.getFullYear()}_${pad(now.getHours())}-${
              pad(now.getMinutes())
            }-${pad(now.getSeconds())}`;

            const dotIndex = oldFile.name.lastIndexOf(".");
            const versionedName = dotIndex === -1
              ? `${oldFile.name}_${timestamp}`
              : `${oldFile.name.slice(0, dotIndex)}_${timestamp}${
                oldFile.name.slice(dotIndex)
              }`;

            const oldPath = oldFile.path ||
              buildSubmissionPath(
                lessonId,
                activityId,
                pupilStorageKey,
                oldFile.name,
              );
            const newVersionedPath = buildSubmissionPath(
              lessonId,
              activityId,
              pupilStorageKey,
              versionedName,
            );

            // Move file in storage
            const { error: moveError } = await storage.move(
              oldPath,
              newVersionedPath,
            );
            if (moveError) {
              console.error(
                "[pupil-upload] Failed to move old version:",
                moveError,
              );
              // We proceed anyway, maybe storage file doesn't exist?
            }

            // Update the entry in list
            uploadedFiles[duplicateIndex] = {
              ...oldFile,
              name: versionedName,
              path: newVersionedPath,
            };
          }

          // 3. Add new file to list
          uploadedFiles.unshift({
            name: fileName,
            path: path,
            size: file.size,
            status: "inprogress",
            instructions: null,
            uploaded_at: submittedAt,
          });

          const submissionPayload = {
            submission_type: "upload-file",
            upload_submission: true,
            uploaded_files: uploadedFiles,
            // Keep legacy fields for a bit or just overwrite?
            // Let's keep them synced to the *latest* file for safety
            upload_file_name: fileName,
            upload_updated_at: submittedAt,
            success_criteria_scores: {},
          };

          if (existing?.submission_id) {
            await client.query(
              `
                 update submissions
                 set body = $1, submitted_at = $2, submission_status = 'inprogress', is_flagged = false, resubmit_requested = false, resubmit_note = NULL
                 where submission_id = $3
               `,
              [submissionPayload, submittedAt, existing.submission_id],
            );
            submissionId = existing.submission_id;
          } else {
            const { rows: newRows } = await client.query(
              `
                 insert into submissions (activity_id, user_id, body, submitted_at, submission_status)
                 values ($1, $2, $3, $4, 'inprogress')
                 returning submission_id
               `,
              [activityId, userId, submissionPayload, submittedAt],
            );
            submissionId = newRows[0]?.submission_id;
          }

          await logActivitySubmissionEvent({
            submissionId,
            activityId,
            lessonId,
            pupilId: userId,
            fileName,
            submittedAt,
          });
        } catch (error) {
          console.error(
            "[v0] Failed to upsert upload submission record:",
            error,
          );
          await storage.remove([path]);
          return { success: false, error: "Unable to record submission." };
        }
      } finally {
        try {
          await client.end();
        } catch {
          // ignore close errors
        }
      }

      console.log("[realtime-debug] Upload submission stored", {
        activityId,
        pupilId: userId,
        lessonId,
        fileName,
        submittedAt,
      });

      await emitSubmissionEvent("submission.uploaded", {
        submissionId,
        activityId,
        pupilId: userId,
        submittedAt,
        fileName,
        submissionStatus: "inprogress",
        isFlagged: false,
      });

      deferRevalidate(
        `/pupil-lessons/${encodeURIComponent(userId)}/lessons/${
          encodeURIComponent(lessonId)
        }`,
      );
      return { success: true };
    },
  );
}

export async function deletePupilActivitySubmissionAction(
  lessonId: string,
  activityId: string,
  pupilId: string,
  fileName: string,
) {
  const routeTag = "/pupil-lessons";

  return withTelemetry(
    {
      routeTag,
      functionName: "deletePupilActivitySubmissionAction",
      params: { lessonId, activityId, pupilId },
    },
    async () => {
      const client = createPgClient();
      try {
        await client.connect();

        // 1. Get submission
        const { rows } = await client.query(
          `
            select submission_id, body
            from submissions
            where activity_id = $1 and user_id = $2
            order by submitted_at desc
            limit 1
          `,
          [activityId, pupilId],
        );

        const submission = rows[0];
        if (!submission) {
          return { success: true }; // Nothing to delete
        }

        let uploadedFiles: z.infer<typeof UploadedFileSchema>[] = [];
        if (submission.body?.uploaded_files) {
          uploadedFiles = submission.body.uploaded_files;
        } else if (submission.body?.upload_file_name) {
          uploadedFiles.push({
            name: submission.body.upload_file_name,
            path: "",
            status: "inprogress",
          });
        }

        // 2. Remove file from array
        const initialLength = uploadedFiles.length;
        uploadedFiles = uploadedFiles.filter((f) => f.name !== fileName);

        if (uploadedFiles.length === initialLength) {
          // File not in list? Check storage anyway just in case
        }

        // 3. Delete from storage
        const storage = createLocalStorageClient(LESSON_FILES_BUCKET);
        const pupilStorageKey = await resolvePupilStorageKey(pupilId);
        const paths = [
          buildSubmissionPath(lessonId, activityId, pupilStorageKey, fileName),
          buildLegacySubmissionPath(
            lessonId,
            activityId,
            pupilStorageKey,
            fileName,
          ),
        ].filter((value, index, array) => array.indexOf(value) === index);

        for (const path of paths) {
          await storage.remove([path]);
        }

        // 4. Update DB
        const latestFile = uploadedFiles.length > 0 ? uploadedFiles[0] : null;

        await client.query(
          `
            update submissions
            set body = jsonb_set(
                jsonb_set(body::jsonb, '{uploaded_files}', $1::jsonb, true),
                '{upload_file_name}', $2::jsonb, true
            ),
            submission_status = 'inprogress' -- Reset to inprogress on edit? Or keep?
            where submission_id = $3
          `,
          [
            JSON.stringify(uploadedFiles),
            JSON.stringify(latestFile?.name ?? null),
            submission.submission_id,
          ],
        );

        await emitSubmissionEvent("submission.deleted", {
          submissionId: submission.submission_id,
          activityId,
          pupilId,
          fileName,
          submittedAt: new Date().toISOString(),
          submissionStatus: "inprogress", // Changed from missing since other files might exist
        });
      } finally {
        try {
          await client.end();
        } catch {
          // ignore close errors
        }
      }

      deferRevalidate(
        `/pupil-lessons/${encodeURIComponent(pupilId)}/lessons/${
          encodeURIComponent(lessonId)
        }`,
      );
      return { success: true };
    },
  );
}

export async function getPupilActivitySubmissionUrlAction(
  lessonId: string,
  activityId: string,
  pupilId: string,
  fileName: string,
) {
  const storage = createLocalStorageClient(LESSON_FILES_BUCKET);
  const pupilStorageKey = await resolvePupilStorageKey(pupilId);
  const paths = [
    buildSubmissionPath(lessonId, activityId, pupilStorageKey, fileName),
    buildLegacySubmissionPath(lessonId, activityId, pupilStorageKey, fileName),
  ].filter((value, index, array) => array.indexOf(value) === index);

  let lastError: { message?: string } | null = null;

  for (const path of paths) {
    const { data, error } = await storage.createSignedUrl(path);
    if (!error) {
      return { success: true, url: data?.signedUrl ?? null };
    }

    if (isStorageNotFoundError(error)) {
      lastError = error;
      continue;
    }

    console.error(
      "[v0] Failed to create signed URL for pupil submission:",
      error,
      { path },
    );
    return { success: false, error: error.message };
  }

  return { success: false, error: lastError?.message ?? "NOT_FOUND" };
}

export async function updatePupilSubmissionInstructionsAction(input: {
  lessonId: string;
  activityId: string;
  pupilId: string;
  instructions: string;
  fileName?: string; // Added
}) {
  const { lessonId, activityId, pupilId, instructions, fileName } = input;
  const routeTag = "/pupil-lessons";

  return withTelemetry(
    {
      routeTag,
      functionName: "updatePupilSubmissionInstructionsAction",
      params: { lessonId, activityId, pupilId },
    },
    async () => {
      const profile = await requireAuthenticatedProfile();

      if (profile.userId !== pupilId) {
        return {
          success: false,
          error: "You can only update your own submission instructions.",
        };
      }

      const client = createPgClient();
      try {
        await client.connect();

        const { rows } = await client.query(
          `
            with target as (
              select submission_id
              from submissions
              where activity_id = $2 and user_id = $3
              order by submitted_at desc
              limit 1
            )
            update submissions s
            set body = jsonb_set(body::jsonb, '{instructions}', to_jsonb($1::text), true), submitted_at = now()
            from target t
            where s.submission_id = t.submission_id
            returning s.submission_id
          `,
          [instructions, activityId, profile.userId],
        );

        // New logic supporting array of files
        // We'll use a transaction for safety or just smart SQL jsonb updates.
        // Updating a specific item in jsonb array is tricky in raw SQL without helper function.
        // Easier to fetch, modify, save.

        // 1. Fetch
        const { rows: rowsV2 } = await client.query(
          `select submission_id, body from submissions where activity_id = $1 and user_id = $2 order by submitted_at desc limit 1`,
          [activityId, profile.userId],
        );

        if (rowsV2.length > 0 && fileName) {
          const sub = rowsV2[0];
          let uploadedFiles: z.infer<typeof UploadedFileSchema>[] =
            sub.body?.uploaded_files ?? [];
          // Fallback to legacy
          if (uploadedFiles.length === 0 && sub.body?.upload_file_name) {
            uploadedFiles = [{
              name: sub.body.upload_file_name,
              path: "",
              status: "inprogress",
              instructions: sub.body.instructions,
            }];
          }

          const fileIdx = uploadedFiles.findIndex((f) => f.name === fileName);
          if (fileIdx !== -1) {
            uploadedFiles[fileIdx].instructions = instructions;

            await client.query(
              `update submissions set body = jsonb_set(body::jsonb, '{uploaded_files}', $1::jsonb, true) where submission_id = $2`,
              [JSON.stringify(uploadedFiles), sub.submission_id],
            );

            revalidatePath(
              `/pupil-lessons/${encodeURIComponent(pupilId)}/lessons/${
                encodeURIComponent(lessonId)
              }`,
            );
            return { success: true };
          }
        }

        // Fallback for legacy calls without fileName or if file not found in array (shouldn't happen with new UI)
        if (rows.length === 0) { // original check using legacy update
          return { success: false, error: "No submission to update yet." };
        }

        revalidatePath(
          `/pupil-lessons/${encodeURIComponent(pupilId)}/lessons/${
            encodeURIComponent(lessonId)
          }`,
        );
        return { success: true };
      } catch (error) {
        console.error(
          "[pupil-lessons] Failed to update submission instructions:",
          error,
        );
        return {
          success: false,
          error: "Unable to update instructions right now.",
        };
      } finally {
        try {
          await client.end();
        } catch {
          // ignore close errors
        }
      }
    },
  );
}

export async function updatePupilSubmissionStatusAction(input: {
  lessonId: string;
  activityId: string;
  pupilId: string;
  status: z.infer<typeof SubmissionStatusSchema>;
  fileName?: string; // Added
}) {
  const { lessonId, activityId, pupilId, status, fileName } = input;
  const routeTag = "/pupil-lessons";

  const parsedStatus = SubmissionStatusSchema.safeParse(status);
  if (!parsedStatus.success) {
    return { success: false, error: "Invalid status." };
  }

  const normalizedStatus = parsedStatus.data;
  if (normalizedStatus === "completed" || normalizedStatus === "rejected") {
    return {
      success: false,
      error: "Only teachers can mark uploads as completed or rejected.",
    };
  }

  return withTelemetry(
    {
      routeTag,
      functionName: "updatePupilSubmissionStatusAction",
      params: { lessonId, activityId, pupilId, status },
    },
    async () => {
      const profile = await requireAuthenticatedProfile();

      if (profile.userId !== pupilId) {
        return {
          success: false,
          error: "You can only update your own submission status.",
        };
      }

      const client = createPgClient();
      try {
        await client.connect();

        const { rows } = await client.query(
          `
            with target as (
              select submission_id
              from submissions
              where activity_id = $2 and user_id = $3
              order by submitted_at desc
              limit 1
            )
            update submissions s
            set submission_status = $1, submitted_at = case when $1 = 'submitted' then now() else s.submitted_at end
            from target t
            where s.submission_id = t.submission_id
            returning s.submission_id
          `,
          [normalizedStatus, activityId, profile.userId],
        );

        // New logic supporting array of files
        const { rows: rowsV2 } = await client.query(
          `select submission_id, body from submissions where activity_id = $1 and user_id = $2 order by submitted_at desc limit 1`,
          [activityId, profile.userId],
        );

        if (rowsV2.length > 0 && fileName) {
          const sub = rowsV2[0];
          let uploadedFiles: z.infer<typeof UploadedFileSchema>[] =
            sub.body?.uploaded_files ?? [];
          if (uploadedFiles.length === 0 && sub.body?.upload_file_name) {
            uploadedFiles = [{
              name: sub.body.upload_file_name,
              path: "",
              status: sub.submission_status ?? "inprogress",
            }];
          }

          const fileIdx = uploadedFiles.findIndex((f) => f.name === fileName);
          if (fileIdx !== -1) {
            uploadedFiles[fileIdx].status = normalizedStatus;

            // Determine global status?
            // If ANY file is submitted -> submitted? Or ALL?
            // Requirement: "Each file uploaded needs to have a status"
            // For now, let's update the file status. The global status update (above in original code)
            // might still set everything to 'submitted' or 'inprogress'.
            // Let's refine global status: if at least one file is submitted -> global submitted??
            // OR allow mixed.
            // We'll just update the file status in the JSON.

            await client.query(
              `update submissions set body = jsonb_set(body::jsonb, '{uploaded_files}', $1::jsonb, true) where submission_id = $2`,
              [JSON.stringify(uploadedFiles), sub.submission_id],
            );

            revalidatePath(
              `/pupil-lessons/${encodeURIComponent(pupilId)}/lessons/${
                encodeURIComponent(lessonId)
              }`,
            );
            return { success: true };
          }
        }

        if (rows.length === 0) {
          return { success: false, error: "No submission to update yet." };
        }

        revalidatePath(
          `/pupil-lessons/${encodeURIComponent(pupilId)}/lessons/${
            encodeURIComponent(lessonId)
          }`,
        );
        return { success: true };
      } catch (error) {
        console.error(
          "[pupil-lessons] Failed to update submission status:",
          error,
        );
        return { success: false, error: "Unable to update status right now." };
      } finally {
        try {
          await client.end();
        } catch {
          // ignore close errors
        }
      }
    },
  );
}

type UploadSubmissionSyncParams = {
  client: Client;
  activityId: string;
  pupilId: string;
  fileName: string;
  submittedAt: string;
};

type UploadSubmissionCleanupParams = {
  client: Client;
  activityId: string;
  pupilId: string;
};

const cleanupUploadSubmissionRecord = async ({
  client,
  activityId,
  pupilId,
}: UploadSubmissionCleanupParams) => {
  const { rows } = await client.query(
    `
      select submission_id, body
      from submissions
      where activity_id = $1 and user_id = $2
      order by submitted_at desc
      limit 1
    `,
    [activityId, pupilId],
  );

  const data = rows[0];

  if (!data) {
    return { success: true, submissionId: null };
  }

  const record = data.body && typeof data.body === "object"
    ? { ...(data.body as Record<string, unknown>) }
    : {};
  const hasOverride = typeof record.teacher_override_score === "number" &&
    Number.isFinite(record.teacher_override_score);

  if (hasOverride) {
    await client.query(
      `
        update submissions
        set body = $1, submission_status = 'inprogress'
        where submission_id = $2
      `,
      [
        {
          ...record,
          upload_submission: false,
          upload_file_name: null,
          upload_updated_at: null,
        },
        data.submission_id,
      ],
    );
    return { success: true, submissionId: data.submission_id ?? null };
  }

  // Instead of deleting (which triggers realtime DELETE), reset the upload flags.
  await client.query(
    `
      update submissions
      set body = jsonb_set(
        jsonb_set(body::jsonb, '{upload_submission}', 'false'::jsonb, true),
        '{upload_file_name}', 'null'::jsonb,
        true
      ),
      submission_status = 'inprogress'
      where submission_id = $1
    `,
    [data.submission_id],
  );

  return { success: true, submissionId: data.submission_id ?? null };
};

async function upsertUploadSubmissionRecord({
  client,
  activityId,
  pupilId,
  fileName,
  submittedAt,
}: UploadSubmissionSyncParams) {
  const payload = {
    submission_type: "upload-file",
    upload_submission: true,
    upload_file_name: fileName,
    upload_updated_at: submittedAt,
    success_criteria_scores: {},
  };

  const { rows: existingRows } = await client.query(
    `
      select submission_id
      from submissions
      where activity_id = $1 and user_id = $2
      order by submitted_at desc
      limit 1
    `,
    [activityId, pupilId],
  );

  const existing = existingRows[0] ?? null;

  if (existing?.submission_id) {
    await client.query(
      `
        update submissions
        set body = $1, submitted_at = $2, submission_status = 'inprogress', is_flagged = false, resubmit_requested = false, resubmit_note = NULL
        where submission_id = $3
      `,
      [payload, submittedAt, existing.submission_id],
    );
    return { success: true, submissionId: existing.submission_id };
  }

  const { rows } = await client.query(
    `
      insert into submissions (activity_id, user_id, body, submitted_at, submission_status)
      values ($1, $2, $3, $4, 'inprogress')
      returning submission_id
    `,
    [activityId, pupilId, payload, submittedAt],
  );

  return { success: true, submissionId: rows[0]?.submission_id ?? null };
}

const deferRevalidate = (path: string) => {
  if (path.includes("/lessons/")) {
    return;
  }
  queueMicrotask(() => revalidatePath(path));
};

// --- Lesson-level submission files (teacher view) ---

export interface LessonSubmissionFile {
  pupilId: string;
  pupilName: string | null;
  activityId: string;
  activityTitle: string;
  fileName: string;
  submittedAt: string | null;
  status: z.infer<typeof SubmissionStatusSchema>;
}

export async function listLessonSubmissionFilesAction(
  lessonId: string,
): Promise<{ data: LessonSubmissionFile[] | null; error: string | null }> {
  return withTelemetry(
    {
      routeTag: "/lessons/[lessonId]",
      functionName: "listLessonSubmissionFilesAction",
      params: { lessonId },
    },
    async () => {
      const client = createPgClient();
      try {
        await client.connect();

        // 1. Get file-bearing activities for this lesson (upload and file-download types)
        const { rows: activityRows } = await client.query(
          `select activity_id, title from activities where lesson_id = $1 and (lower(type) like 'upload%' or lower(type) = 'file-download')`,
          [lessonId],
        );

        if (activityRows.length === 0) {
          return { data: [], error: null };
        }

        const activityIds = activityRows.map((r) => r.activity_id);
        const activityTitleMap = new Map<string, string>(
          activityRows.map((r) => [r.activity_id, r.title ?? ""]),
        );

        // 2. Query stored_files for files under these activity directories
        //    Matches both legacy paths ({lessonId}/activities/{activityId}/...)
        //    and new paths (lessons/{lessonId}/activities/{activityId}/...)
        const { rows: fileRows } = await client.query(
          `
            select
              sf.file_name,
              sf.scope_path,
              sf.size_bytes,
              coalesce(sf.updated_at, sf.created_at) as file_date
            from stored_files sf
            where sf.bucket = 'lessons'
              and (
                sf.scope_path like $1 || '/activities/%'
                or sf.scope_path like 'lessons/' || $1 || '/activities/%'
              )
          `,
          [lessonId],
        );

        // 3. Parse file rows to extract activity_id and optional pupil storage key
        const results: LessonSubmissionFile[] = [];
        // Collect pupil storage keys that need profile lookup
        const pupilKeySet = new Set<string>();

        interface ParsedFile {
          activityId: string;
          activityTitle: string;
          fileName: string;
          fileDate: string | null;
          pupilStorageKey: string | null; // null = teacher resource
        }
        const parsedFiles: ParsedFile[] = [];

        for (const row of fileRows) {
          const scopePath = row.scope_path as string;
          const fileName = row.file_name as string;
          if (!fileName) continue;

          // Extract activity_id from scope_path
          // Patterns: "{lessonId}/activities/{activityId}" or "lessons/{lessonId}/activities/{activityId}"
          //           "{lessonId}/activities/{activityId}/{pupilKey}" or "lessons/{lessonId}/activities/{activityId}/{pupilKey}"
          const activityMatch = scopePath.match(
            /(?:^|lessons\/)([^/]+)\/activities\/([^/]+)(?:\/(.+))?$/,
          );
          if (!activityMatch) continue;

          const matchedActivityId = activityMatch[2];
          if (!activityIds.includes(matchedActivityId)) continue;

          const pupilStorageKey = activityMatch[3] ?? null;
          const fileDate =
            typeof row.file_date === "string"
              ? row.file_date
              : row.file_date instanceof Date
                ? row.file_date.toISOString()
                : null;

          if (pupilStorageKey) {
            pupilKeySet.add(pupilStorageKey);
          }

          parsedFiles.push({
            activityId: matchedActivityId,
            activityTitle: activityTitleMap.get(matchedActivityId) ?? "",
            fileName,
            fileDate,
            pupilStorageKey,
          });
        }

        // 4. Resolve pupil storage keys to profile names
        //    Keys can be either emails or user_ids
        const pupilKeys = Array.from(pupilKeySet);
        const keyToProfile = new Map<
          string,
          { userId: string; name: string | null }
        >();

        if (pupilKeys.length > 0) {
          const { rows: profileRows } = await client.query(
            `select user_id, email, first_name, last_name from profiles where user_id = any($1::text[]) or email = any($1::text[])`,
            [pupilKeys],
          );
          for (const p of profileRows) {
            const name = formatPupilName(p.first_name, p.last_name);
            keyToProfile.set(p.user_id, { userId: p.user_id, name });
            if (p.email) {
              keyToProfile.set(p.email, { userId: p.user_id, name });
            }
          }
        }

        // 5. Build results
        for (const pf of parsedFiles) {
          const profile = pf.pupilStorageKey
            ? keyToProfile.get(pf.pupilStorageKey)
            : null;

          results.push({
            pupilId: profile?.userId ?? pf.pupilStorageKey ?? "",
            pupilName: pf.pupilStorageKey
              ? (profile?.name ?? pf.pupilStorageKey)
              : null,
            activityId: pf.activityId,
            activityTitle: pf.activityTitle,
            fileName: pf.fileName,
            submittedAt: pf.fileDate,
            status: "submitted",
          });
        }

        return { data: results, error: null };
      } catch (error) {
        console.error(
          "[lesson-activity-files] Failed to list lesson submission files:",
          error,
        );
        return { data: null, error: "Unable to load activity submission files." };
      } finally {
        try {
          await client.end();
        } catch {
          // ignore close errors
        }
      }
    },
  );
}

function formatPupilName(
  firstName?: string | null,
  lastName?: string | null,
): string | null {
  const first = (firstName ?? "").trim();
  const last = (lastName ?? "").trim();
  if (first && last) return `${first} ${last}`;
  if (first) return first;
  if (last) return last;
  return null;
}
