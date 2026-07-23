import "server-only";

import { query } from "@/lib/db";
import { convertToPdfViaGotenberg } from "@/lib/pdf/gotenberg";
import { rasterizePdfToJpegs } from "@/lib/pdf/rasterize-pdf";
import { createLocalStorageClient } from "@/lib/storage/local-storage";
import { emitLessonEvent } from "@/lib/sse/topics";
import { MarkWorksheetActivityBodySchema } from "@/types";
import type { ExternalJob } from "../external-jobs";

const LESSON_FILES_BUCKET = "lessons";
const MAX_PDF_PAGES = 20;

interface DocConvertPayload {
  lessonId: string;
  activityId: string;
  group: "worksheet" | "answer";
  rawFilePath: string;
  fileName: string;
  uploadedBy: string;
}

/**
 * Convert a teacher-uploaded Word document (already stored at `rawFilePath`) to
 * a PDF via Gotenberg, rasterize it to JPEGs, store the pages, and append them
 * to the mark-worksheet activity's `body_data` (worksheetImages / answerImages).
 * The transient raw document is removed afterwards.
 */
export async function handleDocConvert(job: ExternalJob): Promise<{ images: Array<{ filePath: string; fileName: string }> }> {
  const payload = job.payload as unknown as DocConvertPayload;
  const { lessonId, activityId, group, rawFilePath, fileName, uploadedBy } = payload;
  if (!lessonId || !activityId || !group || !rawFilePath || !fileName) {
    throw new Error("doc_convert payload is missing required fields");
  }

  const storage = createLocalStorageClient(LESSON_FILES_BUCKET);

  // 1. Read the stored raw document.
  const { stream, error: streamError } = await storage.getFileStream(rawFilePath);
  if (streamError || !stream) {
    throw new Error(`Failed to read document at ${rawFilePath}: ${streamError?.message ?? "no stream"}`);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const buffer = Buffer.concat(chunks);

  // 2. docx/doc -> PDF (Gotenberg) -> JPEG pages (poppler).
  const { pdf, error: convertError } = await convertToPdfViaGotenberg(buffer, fileName);
  if (convertError || !pdf) {
    throw new Error(convertError ?? "Document conversion failed.");
  }
  const { pages, error: rasterError } = await rasterizePdfToJpegs(pdf, { maxPages: MAX_PDF_PAGES });
  if (rasterError) throw new Error(rasterError);

  // 3. Store one JPEG per page.
  const base = fileName.replace(/\.docx?$/i, "").replace(/[^a-z0-9-]/gi, "_");
  const stamp = Date.now();
  const stored: Array<{ filePath: string; fileName: string }> = [];
  for (let i = 0; i < pages.length; i += 1) {
    const storedName = `${group}-${stamp}-${base}-${i + 1}.jpg`;
    const fullPath = `${LESSON_FILES_BUCKET}/${lessonId}/activities/${activityId}/${storedName}`;
    const { error: uploadError } = await storage.upload(fullPath, pages[i], {
      contentType: "image/jpeg",
      uploadedBy,
      originalPath: fullPath,
    });
    if (uploadError) throw new Error(uploadError.message);
    stored.push({ filePath: fullPath, fileName: storedName });
  }

  // 4. Append the pages to the activity's body_data (read-modify-write).
  const { rows } = await query<{ body_data: unknown }>(
    `select body_data from activities where activity_id = $1 limit 1`,
    [activityId],
  );
  const parsed = MarkWorksheetActivityBodySchema.safeParse(rows[0]?.body_data);
  const body = parsed.success
    ? parsed.data
    : { worksheetImages: [], answerImages: [], markingGuidance: "", markingGuidanceId: undefined };

  const nextBody = {
    ...body,
    worksheetImages: group === "worksheet" ? [...body.worksheetImages, ...stored] : body.worksheetImages,
    answerImages: group === "answer" ? [...body.answerImages, ...stored] : body.answerImages,
  };

  await query(
    `update activities set body_data = $2::jsonb where activity_id = $1`,
    [activityId, JSON.stringify(nextBody)],
  );

  // 5. Notify the open lesson designer so the pages appear without a refresh.
  void emitLessonEvent("activity.images-updated", {
    lessonId,
    activityId,
    worksheetImages: nextBody.worksheetImages,
    answerImages: nextBody.answerImages,
  });

  // 6. Remove the transient raw document.
  try {
    await storage.remove([rawFilePath]);
  } catch (err) {
    console.error(`[doc-convert] Failed to remove raw file ${rawFilePath}`, err);
  }

  return { images: stored };
}
