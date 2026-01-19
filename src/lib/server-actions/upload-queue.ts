"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Client } from "pg";

import {
  GroupsSchema,
  LessonsSchema,
  type SubmissionStatus,
  SubmissionStatusSchema,
  UnitsSchema,
  UploadSubmissionFilesSchema,
} from "@/types";
import { requireAuthenticatedProfile, requireTeacherProfile } from "@/lib/auth";
import { withTelemetry } from "@/lib/telemetry";
import { createLocalStorageClient } from "@/lib/storage/local-storage";

const QueueActivitySchema = z.object({
  activity_id: z.string(),
  lesson_id: z.string(),
  title: z.string().nullish().transform((value) => value ?? ""),
  type: z.string().nullish().transform((value) => value ?? ""),
});

const QueueActivitiesSchema = z.array(QueueActivitySchema);

const QueueFiltersSchema = z.object({
  groups: GroupsSchema.default([]),
  units: UnitsSchema.default([]),
  lessons: LessonsSchema.default([]),
  activities: QueueActivitiesSchema.default([]),
});

const QueueFiltersResultSchema = z.object({
  data: QueueFiltersSchema.nullable(),
  error: z.string().nullable(),
});

const QueueItemsResultSchema = z.object({
  data: UploadSubmissionFilesSchema.nullable(),
  error: z.string().nullable(),
});

const QueueAllItemsResultSchema = z.object({
  data: UploadSubmissionFilesSchema.nullable(),
  error: z.string().nullable(),
});

type QueueFiltersResult = z.infer<typeof QueueFiltersResultSchema>;
type QueueItemsResult = z.infer<typeof QueueItemsResultSchema>;
type QueueAllItemsResult = z.infer<typeof QueueAllItemsResultSchema>;
type StorageUpload = {
  fileName: string | null;
  updatedAt: string | null;
  size?: number;
};

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

function formatPupilName(firstName?: string | null, lastName?: string | null) {
  const first = (firstName ?? "").trim();
  const last = (lastName ?? "").trim();
  if (first && last) return `${first} ${last}`;
  if (first) return first;
  if (last) return last;
  return null;
}

function normalizeTimestamp(value?: string | Date | null) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.trim().length > 0) return value;
  return null;
}

function latestTimestamp(a?: string | null, b?: string | null) {
  const parsedA = a ? Date.parse(a) : Number.NaN;
  const parsedB = b ? Date.parse(b) : Number.NaN;

  if (!Number.isNaN(parsedA) && !Number.isNaN(parsedB)) {
    return parsedA >= parsedB ? a : b;
  }
  if (!Number.isNaN(parsedA)) return a ?? null;
  if (!Number.isNaN(parsedB)) return b ?? null;
  return a ?? b ?? null;
}

async function fetchLatestStorageUploadsForActivity(
  client: Client,
  lessonId: string,
  activityId: string,
  pupilIds: string[],
) {
  if (pupilIds.length === 0) return new Map<string, StorageUpload>();

  const { rows } = await client.query(
    `
      with candidate_paths as (
        select
          (case
            when sf.scope_path like 'lessons/%' then sf.scope_path
            else concat('lessons/', sf.scope_path)
          end) || '/' || sf.file_name as full_path,
          sf.size_bytes,
          coalesce(sf.updated_at, sf.created_at) as updated_at
        from stored_files sf
        where sf.bucket = 'lessons'
      ),
      parsed as (
        select
          matches[1] as lesson_id,
          matches[2] as activity_id,
          matches[3] as pupil_id,
          matches[4] as file_name,
          size_bytes,
          updated_at
        from candidate_paths
        cross join lateral regexp_matches(full_path, '^lessons/([^/]+)/activities/([^/]+)/([^/]+)/(.+)$') as matches
        where matches is not null
          and matches[1] = $1
          and matches[2] = $2
          and matches[3] = any($3::text[])
      )
      select lesson_id, activity_id, pupil_id, file_name, size_bytes, updated_at
      from parsed
    `,
    [lessonId, activityId, pupilIds],
  );

  const map = new Map<string, Map<string, StorageUpload>>();

  rows.forEach((row) => {
    const pupilId = row.pupil_id as string;
    if (!map.has(pupilId)) {
      map.set(pupilId, new Map());
    }
    const pupilMap = map.get(pupilId)!;

    const sizeValue = typeof row.size_bytes === "number"
      ? row.size_bytes
      : Number.isFinite(Number(row.size_bytes))
      ? Number(row.size_bytes)
      : undefined;

    pupilMap.set(row.file_name, {
      fileName: row.file_name ?? null,
      updatedAt: normalizeTimestamp(row.updated_at),
      size: typeof sizeValue === "number" && Number.isFinite(sizeValue)
        ? sizeValue
        : undefined,
    });
  });

  return map;
}

async function fetchLatestStorageUploads(
  client: Client,
  lessonIds: string[],
  activityIds: string[],
  pupilIds: string[],
) {
  if (activityIds.length === 0 || pupilIds.length === 0) {
    return new Map<string, StorageUpload>();
  }

  const { rows } = await client.query(
    `
      with candidate_paths as (
        select
          (case
            when sf.scope_path like 'lessons/%' then sf.scope_path
            else concat('lessons/', sf.scope_path)
          end) || '/' || sf.file_name as full_path,
          sf.size_bytes,
          coalesce(sf.updated_at, sf.created_at) as updated_at
        from stored_files sf
        where sf.bucket = 'lessons'
      ),
      parsed as (
        select
          matches[1] as lesson_id,
          matches[2] as activity_id,
          matches[3] as pupil_id,
          matches[4] as file_name,
          size_bytes,
          updated_at
        from candidate_paths
        cross join lateral regexp_matches(full_path, '^lessons/([^/]+)/activities/([^/]+)/([^/]+)/(.+)$') as matches
        where matches is not null
          and matches[2] = any($1::text[])
          and (coalesce(array_length($2::text[], 1), 0) = 0 or matches[1] = any($2::text[]))
          and matches[3] = any($3::text[])
      )
      select lesson_id, activity_id, pupil_id, file_name, size_bytes, updated_at
      from parsed
    `,
    [activityIds, lessonIds, pupilIds],
  );

  const map = new Map<string, Map<string, StorageUpload>>();

  rows.forEach((row) => {
    const key = `${row.lesson_id ?? ""}::${row.activity_id ?? ""}::${
      row.pupil_id ?? ""
    }`;
    if (!map.has(key)) {
      map.set(key, new Map());
    }
    const fileMap = map.get(key)!;

    const sizeValue = typeof row.size_bytes === "number"
      ? row.size_bytes
      : Number.isFinite(Number(row.size_bytes))
      ? Number(row.size_bytes)
      : undefined;

    fileMap.set(row.file_name, {
      fileName: row.file_name ?? null,
      updatedAt: normalizeTimestamp(row.updated_at),
      size: typeof sizeValue === "number" && Number.isFinite(sizeValue)
        ? sizeValue
        : undefined,
    });
  });

  return map;
}

export async function readQueueFiltersAction(
  input?: { unitId?: string | null; lessonId?: string | null },
): Promise<QueueFiltersResult> {
  const routeTag = "/queue";

  return withTelemetry(
    { routeTag, functionName: "readQueueFiltersAction", params: input ?? {} },
    async () => {
      const client = createPgClient();

      try {
        await client.connect();

        const { rows: groupRows } = await client.query(
          "select group_id, coalesce(subject, 'General') as subject, coalesce(join_code, '') as join_code, coalesce(active, true) as active from groups where coalesce(active, true) = true order by subject, group_id",
        );
        const { rows: unitRows } = await client.query(
          "select unit_id, title, subject, active, description, year from units where coalesce(active, true) = true order by title asc",
        );

        const { rows: lessonRows } = await client.query(
          "select lesson_id, unit_id, title, order_by, active from lessons where coalesce(active, true) = true order by unit_id, order_by asc, title asc",
        );

        const { rows: activityRows } = await client.query(
          "select activity_id, lesson_id, title, type from activities where lower(type) like 'upload%' order by lesson_id, order_by asc nulls last, title asc",
        );

        return QueueFiltersResultSchema.parse({
          data: {
            groups: GroupsSchema.parse(groupRows ?? []),
            units: UnitsSchema.parse(unitRows ?? []),
            lessons: LessonsSchema.parse(lessonRows ?? []),
            activities: QueueActivitiesSchema.parse(activityRows ?? []),
          },
          error: null,
        });
      } catch (error) {
        console.error("[queue] Failed to load queue filters:", error);
        return QueueFiltersResultSchema.parse({
          data: null,
          error: "Unable to load queue filters.",
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

export async function readQueueItemsAction(input: {
  groupId: string;
  lessonId: string;
  activityId: string;
}): Promise<QueueItemsResult> {
  const routeTag = "/queue";
  const { groupId, lessonId, activityId } = input;

  if (!groupId || !lessonId || !activityId) {
    return QueueItemsResultSchema.parse({
      data: null,
      error: "Missing selection for group, lesson, or activity.",
    });
  }

  return withTelemetry(
    { routeTag, functionName: "readQueueItemsAction", params: input },
    async () => {
      let client: Client | null = null;
      try {
        client = createPgClient();
        await client.connect();

        const { rows: activityRows } = await client.query(
          "select lesson_id from activities where activity_id = $1 and lower(type) like 'upload%' limit 1",
          [activityId],
        );

        const activityRow = activityRows[0];
        if (!activityRow) {
          return QueueItemsResultSchema.parse({
            data: null,
            error: "Upload activity not found.",
          });
        }

        if (activityRow.lesson_id !== lessonId) {
          return QueueItemsResultSchema.parse({
            data: null,
            error: "Activity does not belong to the selected lesson.",
          });
        }

        const { rows: members } = await client.query(
          `
            select gm.user_id, p.first_name, p.last_name
            from group_membership gm
            left join profiles p on p.user_id = gm.user_id
            where gm.group_id = $1
            order by coalesce(p.last_name, ''), coalesce(p.first_name, ''), gm.user_id
          `,
          [groupId],
        );

        const pupilIds = members.map((member) => member.user_id);

        let submissions: Array<{
          submission_id: string;
          user_id: string;
          submission_status: SubmissionStatus;
          submitted_at: string | Date | null;
          file_name: string;
        }> = [];

        if (pupilIds.length > 0) {
          const { rows } = await client.query(
            `
              select distinct on (user_id)
                submission_id,
                user_id,
                submission_status,
                submitted_at,
                body,
                coalesce(body->>'upload_file_name', '') as file_name,
                body->>'instructions' as instructions,
                 case when body::jsonb ? 'uploaded_files' then body->'uploaded_files' else null end as uploaded_files
              from submissions
              where activity_id = $1 and user_id = any($2::text[])
              order by user_id, submitted_at desc
            `,
            [activityId, pupilIds],
          );
          submissions = rows ?? [];
        }

        const submissionByUser = new Map(
          submissions.map((row) => [
            row.user_id,
            {
              ...row,
              submission_status: SubmissionStatusSchema.parse(
                row.submission_status,
              ),
              submitted_at: typeof row.submitted_at === "string"
                ? row.submitted_at
                : row.submitted_at instanceof Date
                ? row.submitted_at.toISOString()
                : null,
              instructions: (row as any).instructions ?? null,
            },
          ]),
        );

        const storageUploads = await fetchLatestStorageUploadsForActivity(
          client,
          lessonId,
          activityId,
          pupilIds,
        );

        const queueItems = members.flatMap((member) => {
          const submission = submissionByUser.get(member.user_id);
          const pupilStorageMap = storageUploads.get(member.user_id);

          let fileList: {
            name: string;
            status: SubmissionStatus;
            instructions: string | null;
            uploadedAt: string | null;
          }[] = [];

          // 1. Try to read from uploaded_files array
          if (
            submission && (submission as any).uploaded_files &&
            Array.isArray((submission as any).uploaded_files)
          ) {
            fileList = (submission as any).uploaded_files.map((f: any) => ({
              name: f.name,
              status: f.status || submission.submission_status || "inprogress",
              instructions: f.instructions || null,
              uploadedAt: f.uploaded_at || null,
            }));
          } // 2. Fallback to legacy single file
          else if (submission && submission.file_name) {
            fileList.push({
              name: submission.file_name,
              status: submission.submission_status,
              instructions: (submission as any).instructions || null,
              uploadedAt: null,
            });
          }
          // 3. No submission, but maybe valid member? Return 1 placeholder if needed?
          // If no files, we return 1 item with null file so usage still shows up in list if desired.
          // Existing logic returned 1 item per member even if no file.
          if (fileList.length === 0) {
            fileList.push({
              name: "",
              status: submission?.submission_status ?? "inprogress",
              instructions: null,
              uploadedAt: null,
            });
          }

          return fileList.map((fileItem) => {
            const fileName = fileItem.name || null;
            // pupilStorageMap is Map<string, StorageUpload> | undefined
            const storageUpload = fileName && pupilStorageMap instanceof Map
              ? pupilStorageMap.get(fileName)
              : undefined;

            const submittedAt = latestTimestamp(
              fileItem.uploadedAt ??
                (submission?.submitted_at as string | null) ?? null,
              storageUpload?.updatedAt ?? null,
            );

            return {
              submissionId: submission?.submission_id ?? null,
              pupilId: member.user_id,
              groupId,
              lessonId,
              activityId,
              pupilName: formatPupilName(member.first_name, member.last_name),
              fileName,
              filePath: fileName
                ? `lessons/${lessonId}/activities/${activityId}/${member.user_id}/${fileName}`
                : null,
              status: fileItem.status,
              submittedAt,
              size: storageUpload?.size,
              instructions: fileItem.instructions,
            };
          });
        });

        return QueueItemsResultSchema.parse({
          data: UploadSubmissionFilesSchema.parse(queueItems),
          error: null,
        });
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : "Unknown error";
        console.error("[queue] Failed to load queue items:", error);
        return QueueItemsResultSchema.parse({
          data: null,
          error: `Unable to load queue items: ${message}`,
        });
      } finally {
        if (client) {
          try {
            await client.end();
          } catch {
            // ignore close errors
          }
        }
      }
    },
  );
}

export async function readQueueAllItemsAction(): Promise<QueueAllItemsResult> {
  const routeTag = "/queue";

  return withTelemetry(
    { routeTag, functionName: "readQueueAllItemsAction" },
    async () => {
      let client: Client | null = null;
      try {
        client = createPgClient();
        await client.connect();

        const { rows } = await client.query(
          `
            select
              s.submission_id,
              s.user_id,
              s.submission_status,
              s.submitted_at,
              coalesce(s.body->>'upload_file_name', '') as file_name,
              s.body->>'instructions' as instructions,
              case when s.body::jsonb ? 'uploaded_files' then s.body->'uploaded_files' else null end as uploaded_files,
              a.activity_id,
              a.title as activity_title,
              l.lesson_id,
              l.title as lesson_title,
              u.title as unit_title,
              gm.group_id,
              g.subject as group_subject
            from submissions s
            join activities a on a.activity_id = s.activity_id and lower(a.type) like 'upload%'
            left join lessons l on l.lesson_id = a.lesson_id
            left join units u on u.unit_id = l.unit_id
            left join group_membership gm on gm.user_id = s.user_id
            left join groups g on g.group_id = gm.group_id
            join assignments asm on asm.group_id = g.group_id and asm.unit_id = u.unit_id and asm.active = true
            where coalesce(s.body->>'upload_file_name', '') <> ''
            order by s.submitted_at asc nulls last
          `,
        );

        const pupilIds = Array.from(new Set(rows.map((row) => row.user_id)));
        let profileMap = new Map<
          string,
          { first_name?: string | null; last_name?: string | null }
        >();

        if (pupilIds.length > 0) {
          const { rows: profileRows } = await client.query(
            "select user_id, first_name, last_name from profiles where user_id = any($1::text[])",
            [pupilIds],
          );
          profileMap = new Map(profileRows.map((row) => [row.user_id, row]));
        }

        const lessonIds = Array.from(
          new Set(
            rows.map((row) => row.lesson_id).filter((value): value is string =>
              typeof value === "string" && value.length > 0
            ),
          ),
        );
        const activityIds = Array.from(
          new Set(
            rows.map((row) => row.activity_id).filter((
              value,
            ): value is string =>
              typeof value === "string" && value.length > 0
            ),
          ),
        );

        const storageUploads = await fetchLatestStorageUploads(
          client,
          lessonIds,
          activityIds,
          pupilIds,
        );

        const queueItems = rows.flatMap((row) => {
          const profile = profileMap.get(row.user_id) ?? {};
          const storageKey = `${row.lesson_id ?? ""}::${
            row.activity_id ?? ""
          }::${row.user_id ?? ""}`;
          const fileStorageMap = storageUploads.get(storageKey);

          let fileList: {
            name: string;
            status: SubmissionStatus;
            instructions: string | null;
            uploadedAt: string | null;
          }[] = [];

          // Parse loaded files
          // The query now needs to return uploaded_files too. I need to update the query below first!
          // Wait, I updated query in step 3 but this is `readQueueAllItemsAction`.
          // I need to update the query in `readQueueAllItemsAction` as well.

          // Let's assume query will be updated.
          // row.uploaded_files

          if (row.uploaded_files && Array.isArray(row.uploaded_files)) {
            fileList = row.uploaded_files.map((f: any) => ({
              name: f.name,
              status: f.status || row.submission_status || "inprogress",
              instructions: f.instructions || null,
              uploadedAt: f.uploaded_at || null,
            }));
          } else if (row.file_name) {
            fileList.push({
              name: row.file_name,
              status:
                SubmissionStatusSchema.safeParse(row.submission_status).data ??
                  "inprogress",
              instructions: row.instructions || null,
              uploadedAt: null,
            });
          }

          if (fileList.length === 0) {
            // Queue usually filters where "coalesce(upload_file_name) <> ''".
            // If we have an array, checking array length > 0 is equiv.
            return [];
          }

          return fileList.map((fileItem) => {
            const fileName = fileItem.name;
            // fileStorageMap is Map<string, StorageUpload> | undefined
            const storageUpload = fileName && fileStorageMap instanceof Map
              ? fileStorageMap.get(fileName)
              : undefined;

            const submittedAt = latestTimestamp(
              normalizeTimestamp(
                fileItem.uploadedAt ??
                  (row.submitted_at as string | Date | null),
              ),
              storageUpload?.updatedAt ?? null,
            );

            const status =
              SubmissionStatusSchema.safeParse(fileItem.status).data ??
                "inprogress";

            return {
              submissionId: row.submission_id ?? null,
              pupilId: row.user_id,
              activityId: row.activity_id,
              lessonId: row.lesson_id ?? null,
              groupId: row.group_id ?? null,
              pupilName: formatPupilName(profile.first_name, profile.last_name),
              fileName,
              filePath: fileName && row.lesson_id && row.activity_id
                ? `lessons/${row.lesson_id}/activities/${row.activity_id}/${row.user_id}/${fileName}`
                : null,
              status: status,
              submittedAt,
              lessonTitle: row.lesson_title ?? null,
              unitTitle: row.unit_title ?? null,
              activityTitle: row.activity_title ?? null,
              groupName: row.group_subject ?? row.group_id ?? null,
              size: storageUpload?.size,
              instructions: fileItem.instructions,
            };
          });
        });

        return QueueAllItemsResultSchema.parse({
          data: UploadSubmissionFilesSchema.parse(queueItems),
          error: null,
        });
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : "Unknown error";
        console.error("[queue] Failed to load all queue items:", error);
        return QueueAllItemsResultSchema.parse({
          data: null,
          error: `Unable to load queue items: ${message}`,
        });
      } finally {
        if (client) {
          try {
            await client.end();
          } catch {
            // ignore close errors
          }
        }
      }
    },
  );
}

export async function getQueueFileDownloadUrlAction(input: {
  lessonId: string;
  activityId: string;
  pupilId: string;
  fileName: string;
}) {
  const { lessonId, activityId, pupilId, fileName } = input;
  if (!lessonId || !activityId || !pupilId || !fileName) {
    return { success: false, error: "Missing file details." };
  }

  const routeTag = "/queue";

  return withTelemetry(
    {
      routeTag,
      functionName: "getQueueFileDownloadUrlAction",
      params: { lessonId, activityId, pupilId },
    },
    async () => {
      const profile = await requireAuthenticatedProfile();
      if (
        !profile.roles.includes("teacher") &&
        !profile.roles.includes("technician")
      ) {
        return {
          success: false,
          error: "You must be a teacher or technician to download files.",
        };
      }

      try {
        const { resolvePupilStorageKey } = await import(
          "./lesson-activity-files"
        );
        const pupilStorageKey = await resolvePupilStorageKey(pupilId);
        const storage = createLocalStorageClient("lessons");
        const path =
          `lessons/${lessonId}/activities/${activityId}/${pupilStorageKey}/${fileName}`;
        const legacyPath =
          `${lessonId}/activities/${activityId}/${pupilStorageKey}/${fileName}`;

        const candidates = [path, legacyPath].filter((value, index, array) =>
          array.indexOf(value) === index
        );
        let lastError: { message?: string } | null = null;

        for (const candidate of candidates) {
          const { data, error } = await storage.createSignedUrl(candidate);
          if (!error && data?.signedUrl) {
            return { success: true, url: data.signedUrl };
          }

          if (error) {
            const normalized = error.message?.toLowerCase() ?? "";
            if (
              normalized.includes("not found") ||
              normalized.includes("object not found")
            ) {
              lastError = error;
              continue;
            }
            return { success: false, error: error.message };
          }
        }

        return {
          success: false,
          error: lastError?.message ?? "File not found.",
        };
      } catch (error) {
        console.error("[queue] Failed to create signed URL for file", error);
        return { success: false, error: "Unable to download file right now." };
      }
    },
  );
}

export async function updateUploadSubmissionStatusAction(input: {
  lessonId: string;
  activityId: string;
  pupilId: string;
  status: SubmissionStatus;
}) {
  const { lessonId, activityId, pupilId } = input;
  if (!lessonId || !activityId || !pupilId) {
    return { success: false, error: "Missing selection for update." };
  }
  const statusParse = SubmissionStatusSchema.safeParse(input.status);
  if (!statusParse.success) {
    return { success: false, error: "Invalid status." };
  }

  const routeTag = "/queue";
  const targetStatus = statusParse.data;

  return withTelemetry(
    {
      routeTag,
      functionName: "updateUploadSubmissionStatusAction",
      params: { lessonId, activityId, pupilId, status: targetStatus },
    },
    async () => {
      const profile = await requireTeacherProfile();
      if (!profile) {
        return { success: false, error: "You need to sign in as a teacher." };
      }

      const client = createPgClient();

      try {
        await client.connect();

        const { rows: activityRows } = await client.query(
          "select lesson_id from activities where activity_id = $1 and lower(type) like 'upload%' limit 1",
          [activityId],
        );
        const activityRow = activityRows[0];

        if (!activityRow) {
          return { success: false, error: "Upload activity not found." };
        }

        if (activityRow.lesson_id !== lessonId) {
          return {
            success: false,
            error: "Activity does not belong to the selected lesson.",
          };
        }

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
            set submission_status = $1, submitted_at = now()
            from target t
            where s.submission_id = t.submission_id
            returning s.submission_id
          `,
          [targetStatus, activityId, pupilId],
        );

        if (rows.length === 0) {
          return { success: false, error: "No submission found to update." };
        }

        revalidatePath("/queue");
        return { success: true };
      } catch (error) {
        console.error("[queue] Failed to update submission status:", error);
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
