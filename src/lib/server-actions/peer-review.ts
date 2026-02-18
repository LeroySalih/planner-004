"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Client } from "pg";

import {
  PeerReviewCommentsSchema,
  ShareMyWorkSubmissionBodySchema,
} from "@/types";
import { query } from "@/lib/db";
import { requireAuthenticatedProfile } from "@/lib/auth";
import { createLocalStorageClient } from "@/lib/storage/local-storage";
import { withTelemetry } from "@/lib/telemetry";

const LESSON_FILES_BUCKET = "lessons";

const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

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

async function resolvePupilStorageKey(userId: string): Promise<string> {
  const { rows } = await query<{ email: string }>(
    `SELECT email FROM profiles WHERE user_id = $1 LIMIT 1`,
    [userId],
  );
  return rows[0]?.email?.trim() ?? userId;
}

function buildSubmissionPath(
  lessonId: string,
  activityId: string,
  pupilStorageKey: string,
  fileName: string,
) {
  return `lessons/${lessonId}/activities/${activityId}/${pupilStorageKey}/${fileName}`;
}

// ─── Upload Image to Share-My-Work Submission ───

export async function uploadShareMyWorkImageAction(formData: FormData) {
  const lessonId = formData.get("lessonId");
  const activityId = formData.get("activityId");
  const file = formData.get("file");

  const routeTag = "/pupil-lessons";

  return withTelemetry(
    {
      routeTag,
      functionName: "uploadShareMyWorkImageAction",
      params: { lessonId, activityId },
    },
    async () => {
      if (typeof lessonId !== "string" || lessonId.trim() === "") {
        return { success: false, error: "Missing lesson identifier" };
      }
      if (typeof activityId !== "string" || activityId.trim() === "") {
        return { success: false, error: "Missing activity identifier" };
      }
      if (!(file instanceof File)) {
        return { success: false, error: "No file provided" };
      }
      if (!ALLOWED_MIME_TYPES.has(file.type)) {
        return {
          success: false,
          error: "Only PNG, JPEG, GIF, and WebP images are allowed",
        };
      }
      if (file.size > MAX_FILE_SIZE) {
        return { success: false, error: "File exceeds 5MB limit" };
      }

      const profile = await requireAuthenticatedProfile();
      const userId = profile.userId;
      const pupilStorageKey =
        profile.email?.trim() ?? (await resolvePupilStorageKey(userId));

      const storage = createLocalStorageClient(LESSON_FILES_BUCKET);
      const fileName = file.name;
      const path = buildSubmissionPath(
        lessonId,
        activityId,
        pupilStorageKey,
        fileName,
      );

      const arrayBuffer = await file.arrayBuffer();
      const { error: uploadError } = await storage.upload(path, arrayBuffer, {
        contentType: file.type,
        uploadedBy: userId,
        originalPath: path,
      });

      if (uploadError) {
        console.error("[peer-review] Failed to upload image:", uploadError);
        return { success: false, error: uploadError.message };
      }

      // Upsert submission with files array
      const fileId = crypto.randomUUID();
      const client = createPgClient();
      try {
        await client.connect();

        const { rows: existingRows } = await client.query(
          `SELECT submission_id, body
           FROM submissions
           WHERE activity_id = $1 AND user_id = $2
           ORDER BY submitted_at DESC
           LIMIT 1`,
          [activityId, userId],
        );

        const existing = existingRows[0];
        let files: Array<{
          fileId: string;
          fileName: string;
          mimeType: string;
          order: number;
        }> = [];

        if (existing?.body?.files && Array.isArray(existing.body.files)) {
          files = existing.body.files;
        }

        // Add new file
        files.push({
          fileId,
          fileName,
          mimeType: file.type,
          order: files.length,
        });

        const body = { files };
        const submittedAt = new Date().toISOString();

        let submissionId: string;

        if (existing) {
          submissionId = existing.submission_id;
          await client.query(
            `UPDATE submissions
             SET body = $1, submitted_at = $2
             WHERE submission_id = $3`,
            [JSON.stringify(body), submittedAt, submissionId],
          );
        } else {
          const { rows: insertRows } = await client.query<{ submission_id: string }>(
            `INSERT INTO submissions (submission_id, activity_id, user_id, body, submitted_at)
             VALUES (gen_random_uuid(), $1, $2, $3, $4)
             RETURNING submission_id`,
            [activityId, userId, JSON.stringify(body), submittedAt],
          );
          submissionId = insertRows[0].submission_id;
        }

        return { success: true, data: { fileId, fileName, submissionId } };
      } catch (error) {
        console.error("[peer-review] Failed to upsert submission:", error);
        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to save submission",
        };
      } finally {
        try {
          await client.end();
        } catch {
          // ignore
        }
      }
    },
  );
}

// ─── Remove Image from Share-My-Work Submission ───

export async function removeShareMyWorkImageAction(
  lessonId: string,
  activityId: string,
  fileName: string,
) {
  const routeTag = "/pupil-lessons";

  return withTelemetry(
    {
      routeTag,
      functionName: "removeShareMyWorkImageAction",
      params: { lessonId, activityId, fileName },
    },
    async () => {
      const profile = await requireAuthenticatedProfile();
      const userId = profile.userId;
      const pupilStorageKey =
        profile.email?.trim() ?? (await resolvePupilStorageKey(userId));

      // Delete from storage
      const storage = createLocalStorageClient(LESSON_FILES_BUCKET);
      const path = buildSubmissionPath(
        lessonId,
        activityId,
        pupilStorageKey,
        fileName,
      );
      await storage.remove([path]);

      // Update submission body
      const client = createPgClient();
      try {
        await client.connect();

        const { rows } = await client.query(
          `SELECT submission_id, body
           FROM submissions
           WHERE activity_id = $1 AND user_id = $2
           ORDER BY submitted_at DESC
           LIMIT 1`,
          [activityId, userId],
        );

        const submission = rows[0];
        if (!submission) return { success: true };

        let files: Array<{
          fileId: string;
          fileName: string;
          mimeType: string;
          order: number;
        }> = [];
        if (submission.body?.files && Array.isArray(submission.body.files)) {
          files = submission.body.files;
        }

        files = files.filter((f) => f.fileName !== fileName);
        // Reindex order
        files.forEach((f, i) => {
          f.order = i;
        });

        await client.query(
          `UPDATE submissions
           SET body = $1, submitted_at = $2
           WHERE submission_id = $3`,
          [
            JSON.stringify({ files }),
            new Date().toISOString(),
            submission.submission_id,
          ],
        );

        return { success: true };
      } catch (error) {
        console.error("[peer-review] Failed to remove image:", error);
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Failed to remove image",
        };
      } finally {
        try {
          await client.end();
        } catch {
          // ignore
        }
      }
    },
  );
}

// ─── Reorder Images in Share-My-Work Submission ───

export async function reorderShareMyWorkImagesAction(
  activityId: string,
  orderedFileNames: string[],
) {
  const routeTag = "/pupil-lessons";

  return withTelemetry(
    {
      routeTag,
      functionName: "reorderShareMyWorkImagesAction",
      params: { activityId },
    },
    async () => {
      const profile = await requireAuthenticatedProfile();
      const userId = profile.userId;

      const client = createPgClient();
      try {
        await client.connect();

        const { rows } = await client.query(
          `SELECT submission_id, body
           FROM submissions
           WHERE activity_id = $1 AND user_id = $2
           ORDER BY submitted_at DESC
           LIMIT 1`,
          [activityId, userId],
        );

        const submission = rows[0];
        if (!submission?.body?.files) {
          return { success: false, error: "No submission found" };
        }

        const files: Array<{
          fileId: string;
          fileName: string;
          mimeType: string;
          order: number;
        }> = submission.body.files;

        const fileMap = new Map(files.map((f) => [f.fileName, f]));
        const reordered: typeof files = [];

        for (let i = 0; i < orderedFileNames.length; i++) {
          const file = fileMap.get(orderedFileNames[i]);
          if (file) {
            reordered.push({ ...file, order: i });
          }
        }

        // Add any files not in the ordered list (shouldn't happen but safety)
        for (const file of files) {
          if (!orderedFileNames.includes(file.fileName)) {
            reordered.push({ ...file, order: reordered.length });
          }
        }

        await client.query(
          `UPDATE submissions
           SET body = $1, submitted_at = $2
           WHERE submission_id = $3`,
          [
            JSON.stringify({ files: reordered }),
            new Date().toISOString(),
            submission.submission_id,
          ],
        );

        return { success: true };
      } catch (error) {
        console.error("[peer-review] Failed to reorder images:", error);
        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to reorder images",
        };
      } finally {
        try {
          await client.end();
        } catch {
          // ignore
        }
      }
    },
  );
}

// ─── Read Share Activity Submissions (anonymous for pupils) ───

export async function readShareActivitySubmissionsAction(
  shareActivityId: string,
  viewerUserId: string,
) {
  const routeTag = "/pupil-lessons";

  return withTelemetry(
    {
      routeTag,
      functionName: "readShareActivitySubmissionsAction",
      params: { shareActivityId, viewerUserId },
    },
    async () => {
      const profile = await requireAuthenticatedProfile();
      const currentUserId = profile.userId;

      const { rows } = await query<{
        submission_id: string;
        user_id: string;
        body: unknown;
      }>(
        `SELECT s.submission_id, s.user_id, s.body
         FROM submissions s
         WHERE s.activity_id = $1
         ORDER BY s.submitted_at ASC`,
        [shareActivityId],
      );

      // Filter out submissions with no files
      const withFiles = rows.filter((row) => {
        const body = row.body as { files?: unknown[] } | null;
        return body?.files && Array.isArray(body.files) && body.files.length > 0;
      });

      let index = 0;
      const submissions = withFiles
        .filter((row) => {
          // Always exclude the current user's own work
          if (row.user_id === currentUserId) return false;
          return true;
        })
        .map((row) => {
          index++;
          const body = row.body as { files: Array<{ fileId: string; fileName: string; mimeType: string; order: number }> };
          const files = body.files.sort((a, b) => a.order - b.order);

          const images = files.map((f, i) => ({
            url: `/api/peer-review/image/${row.submission_id}/${i}`,
            mimeType: f.mimeType,
          }));

          return {
            submissionId: row.submission_id,
            label: `Submission ${index}`,
            images,
          };
        });

      return { success: true, data: submissions };
    },
  );
}

// ─── Create Peer Review Comment ───

export async function createPeerReviewCommentAction({
  reviewActivityId,
  shareSubmissionId,
  commentText,
}: {
  reviewActivityId: string;
  shareSubmissionId: string;
  commentText: string;
}) {
  const routeTag = "/pupil-lessons";

  return withTelemetry(
    {
      routeTag,
      functionName: "createPeerReviewCommentAction",
      params: { reviewActivityId, shareSubmissionId },
    },
    async () => {
      if (!commentText.trim()) {
        return { success: false, error: "Comment cannot be empty" };
      }

      const profile = await requireAuthenticatedProfile();
      const authorUserId = profile.userId;

      // Look up submission owner (target user)
      const { rows: subRows } = await query<{ user_id: string }>(
        `SELECT user_id FROM submissions WHERE submission_id = $1 LIMIT 1`,
        [shareSubmissionId],
      );
      if (subRows.length === 0) {
        return { success: false, error: "Submission not found" };
      }
      const targetUserId = subRows[0].user_id;

      // Cannot comment on own work
      if (authorUserId === targetUserId) {
        return {
          success: false,
          error: "You cannot comment on your own work",
        };
      }

      const { rows } = await query<{ comment_id: string }>(
        `INSERT INTO peer_review_comments
           (comment_id, review_activity_id, author_user_id, target_user_id, comment_text)
         VALUES (gen_random_uuid(), $1, $2, $3, $4)
         RETURNING comment_id`,
        [reviewActivityId, authorUserId, targetUserId, commentText.trim()],
      );

      return {
        success: true,
        data: { commentId: rows[0]?.comment_id ?? null },
      };
    },
  );
}

// ─── Read Peer Review Comments ───

export async function readPeerReviewCommentsAction(
  reviewActivityId: string,
  shareSubmissionId: string,
) {
  const routeTag = "/pupil-lessons";

  return withTelemetry(
    {
      routeTag,
      functionName: "readPeerReviewCommentsAction",
      params: { reviewActivityId, shareSubmissionId },
    },
    async () => {
      const profile = await requireAuthenticatedProfile();
      const currentUserId = profile.userId;

      // Look up submission owner
      const { rows: subRows } = await query<{ user_id: string }>(
        `SELECT user_id FROM submissions WHERE submission_id = $1 LIMIT 1`,
        [shareSubmissionId],
      );
      if (subRows.length === 0) {
        return { success: true, data: [] };
      }
      const targetUserId = subRows[0].user_id;

      // Only show the current user's own comments (uninfluenced reviewing)
      const { rows } = await query<{
        comment_id: string;
        comment_text: string;
        is_flagged: boolean;
        created_at: string;
      }>(
        `SELECT c.comment_id, c.comment_text, c.is_flagged, c.created_at
         FROM peer_review_comments c
         WHERE c.review_activity_id = $1
           AND c.target_user_id = $2
           AND c.author_user_id = $3
         ORDER BY c.created_at ASC`,
        [reviewActivityId, targetUserId, currentUserId],
      );

      const comments = rows.map((row) => ({
        commentId: row.comment_id,
        commentText: row.comment_text,
        isFlagged: row.is_flagged,
        createdAt: row.created_at,
        authorLabel: "You",
      }));

      return { success: true, data: comments };
    },
  );
}

// ─── Flag Peer Review Comment ───

export async function flagPeerReviewCommentAction(commentId: string) {
  const routeTag = "/pupil-lessons";

  return withTelemetry(
    {
      routeTag,
      functionName: "flagPeerReviewCommentAction",
      params: { commentId },
    },
    async () => {
      const profile = await requireAuthenticatedProfile();
      const userId = profile.userId;

      // Only the work author (target_user_id) can flag
      const { rows } = await query<{ target_user_id: string }>(
        `SELECT target_user_id FROM peer_review_comments WHERE comment_id = $1`,
        [commentId],
      );

      if (rows.length === 0) {
        return { success: false, error: "Comment not found" };
      }

      if (rows[0].target_user_id !== userId) {
        return {
          success: false,
          error: "Only the work author can flag comments",
        };
      }

      await query(
        `UPDATE peer_review_comments
         SET is_flagged = true, flagged_at = NOW()
         WHERE comment_id = $1`,
        [commentId],
      );

      return { success: true };
    },
  );
}

// ─── Read Comments Received on My Work (for work author) ───

export async function readReceivedCommentsAction(
  shareActivityId: string,
  targetUserId?: string,
) {
  const routeTag = "/pupil-lessons";

  return withTelemetry(
    {
      routeTag,
      functionName: "readReceivedCommentsAction",
      params: { shareActivityId, targetUserId },
    },
    async () => {
      const profile = await requireAuthenticatedProfile();
      // Use the explicit targetUserId if provided, otherwise fall back to
      // the current user (pupil viewing their own page).
      const resolvedTargetId = targetUserId || profile.userId;

      try {
        // Find all review activities that reference this share activity,
        // then load comments where the target user is the work author.
        const { rows } = await query<{
          comment_id: string;
          comment_text: string;
          is_flagged: boolean;
          flagged_at: string | null;
          created_at: string;
        }>(
          `SELECT c.comment_id, c.comment_text, c.is_flagged,
                  c.flagged_at, c.created_at
           FROM peer_review_comments c
           JOIN activities a ON a.activity_id = c.review_activity_id
           WHERE c.target_user_id = $1
             AND (a.body_data->>'shareActivityId') = $2
           ORDER BY c.created_at ASC`,
          [resolvedTargetId, shareActivityId],
        );

        const comments = rows.map((row, index) => ({
          commentId: row.comment_id,
          commentText: row.comment_text,
          isFlagged: row.is_flagged,
          createdAt: row.created_at,
          authorLabel: `Reviewer ${index + 1}`,
        }));

        return { success: true, data: comments };
      } catch (error) {
        console.error("[peer-review] Failed to load received comments:", error);
        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to load comments",
        };
      }
    },
  );
}

// ─── Read Flagged Comments (Teacher only) ───

export async function readFlaggedCommentsAction(reviewActivityId: string) {
  const routeTag = "/lessons";

  return withTelemetry(
    {
      routeTag,
      functionName: "readFlaggedCommentsAction",
      params: { reviewActivityId },
    },
    async () => {
      const profile = await requireAuthenticatedProfile();
      if (!profile.roles.includes("teacher")) {
        return { success: false, error: "Teacher access required" };
      }

      const { rows } = await query<{
        comment_id: string;
        comment_text: string;
        is_flagged: boolean;
        flagged_at: string | null;
        created_at: string;
        author_user_id: string;
        target_user_id: string;
        author_first_name: string | null;
        author_last_name: string | null;
        target_first_name: string | null;
        target_last_name: string | null;
      }>(
        `SELECT c.comment_id, c.comment_text, c.is_flagged,
                c.flagged_at, c.created_at,
                c.author_user_id, c.target_user_id,
                pa.first_name AS author_first_name,
                pa.last_name AS author_last_name,
                pt.first_name AS target_first_name,
                pt.last_name AS target_last_name
         FROM peer_review_comments c
         LEFT JOIN profiles pa ON pa.user_id = c.author_user_id
         LEFT JOIN profiles pt ON pt.user_id = c.target_user_id
         WHERE c.review_activity_id = $1
           AND c.is_flagged = true
         ORDER BY c.flagged_at DESC`,
        [reviewActivityId],
      );

      const comments = rows.map((row) => ({
        commentId: row.comment_id,
        commentText: row.comment_text,
        flaggedAt: row.flagged_at,
        createdAt: row.created_at,
        authorName:
          `${row.author_first_name ?? ""} ${row.author_last_name ?? ""}`.trim() || "Unknown",
        targetName:
          `${row.target_first_name ?? ""} ${row.target_last_name ?? ""}`.trim() || "Unknown",
        authorUserId: row.author_user_id,
        targetUserId: row.target_user_id,
      }));

      return { success: true, data: comments };
    },
  );
}

// ─── Read All Peer Review Comments for a Lesson (Teacher admin) ───

export async function readAllPeerReviewCommentsForLessonAction(lessonId: string) {
  const routeTag = "/feedback/peer-review";

  return withTelemetry(
    {
      routeTag,
      functionName: "readAllPeerReviewCommentsForLessonAction",
      params: { lessonId },
    },
    async () => {
      const profile = await requireAuthenticatedProfile();
      if (!profile.roles.includes("teacher")) {
        return { success: false, error: "Teacher access required" };
      }

      const { rows } = await query<{
        comment_id: string;
        comment_text: string;
        is_flagged: boolean;
        flagged_at: string | null;
        created_at: string;
        author_user_id: string;
        target_user_id: string;
        review_activity_id: string;
        author_first_name: string | null;
        author_last_name: string | null;
        target_first_name: string | null;
        target_last_name: string | null;
        activity_title: string | null;
      }>(
        `SELECT c.comment_id, c.comment_text, c.is_flagged,
                c.flagged_at, c.created_at,
                c.author_user_id, c.target_user_id,
                c.review_activity_id,
                pa.first_name AS author_first_name,
                pa.last_name AS author_last_name,
                pt.first_name AS target_first_name,
                pt.last_name AS target_last_name,
                a.title AS activity_title
         FROM peer_review_comments c
         JOIN activities a ON a.activity_id = c.review_activity_id
         LEFT JOIN profiles pa ON pa.user_id = c.author_user_id
         LEFT JOIN profiles pt ON pt.user_id = c.target_user_id
         WHERE a.lesson_id = $1
         ORDER BY c.created_at DESC`,
        [lessonId],
      );

      const comments = rows.map((row) => ({
        commentId: row.comment_id,
        commentText: row.comment_text,
        isFlagged: row.is_flagged,
        flaggedAt: row.flagged_at,
        createdAt: row.created_at,
        reviewActivityId: row.review_activity_id,
        activityTitle: row.activity_title,
        authorName:
          `${row.author_first_name ?? ""} ${row.author_last_name ?? ""}`.trim() || "Unknown",
        targetName:
          `${row.target_first_name ?? ""} ${row.target_last_name ?? ""}`.trim() || "Unknown",
        authorUserId: row.author_user_id,
        targetUserId: row.target_user_id,
      }));

      return { success: true, data: comments };
    },
  );
}

// ─── Peer Review Admin Filter Options (only items with comments) ───

export async function readPeerReviewFilterOptionsAction(options?: {
  groupId?: string;
  unitId?: string;
}) {
  const routeTag = "/feedback/peer-review";

  return withTelemetry(
    {
      routeTag,
      functionName: "readPeerReviewFilterOptionsAction",
      params: { groupId: options?.groupId, unitId: options?.unitId },
    },
    async () => {
      const profile = await requireAuthenticatedProfile();
      if (!profile.roles.includes("teacher")) {
        return { success: false, error: "Teacher access required" };
      }

      // Groups that have at least one peer review comment
      const { rows: groupRows } = await query<{ group_id: string }>(
        `SELECT DISTINCT g.group_id
         FROM groups g
         JOIN assignments a ON a.group_id = g.group_id AND a.active = true
         JOIN lessons l ON l.unit_id = a.unit_id AND l.active = true
         JOIN activities act ON act.lesson_id = l.lesson_id AND act.type = 'review-others-work'
         JOIN peer_review_comments c ON c.review_activity_id = act.activity_id
         WHERE g.active = true
         ORDER BY g.group_id ASC`,
        [],
      );

      // Units for selected group (only those with comments)
      let unitRows: Array<{ unit_id: string; title: string | null }> = [];
      if (options?.groupId) {
        const result = await query<{ unit_id: string; title: string | null }>(
          `SELECT DISTINCT u.unit_id, u.title
           FROM units u
           JOIN assignments a ON a.unit_id = u.unit_id AND a.group_id = $1 AND a.active = true
           JOIN lessons l ON l.unit_id = u.unit_id AND l.active = true
           JOIN activities act ON act.lesson_id = l.lesson_id AND act.type = 'review-others-work'
           JOIN peer_review_comments c ON c.review_activity_id = act.activity_id
           WHERE u.active = true
           ORDER BY u.title ASC`,
          [options.groupId],
        );
        unitRows = result.rows;
      }

      // Lessons for selected unit (only those with comments)
      let lessonRows: Array<{ lesson_id: string; title: string; order_by: number }> = [];
      if (options?.unitId) {
        const result = await query<{ lesson_id: string; title: string; order_by: number }>(
          `SELECT DISTINCT l.lesson_id, l.title, l.order_by
           FROM lessons l
           JOIN activities act ON act.lesson_id = l.lesson_id AND act.type = 'review-others-work'
           JOIN peer_review_comments c ON c.review_activity_id = act.activity_id
           WHERE l.unit_id = $1 AND l.active = true
           ORDER BY l.order_by ASC`,
          [options.unitId],
        );
        lessonRows = result.rows;
      }

      return {
        success: true,
        data: {
          groups: groupRows.map((r) => ({ groupId: r.group_id })),
          units: unitRows.map((r) => ({ unitId: r.unit_id, title: r.title })),
          lessons: lessonRows.map((r) => ({
            lessonId: r.lesson_id,
            title: r.title,
            orderBy: r.order_by,
          })),
        },
      };
    },
  );
}
