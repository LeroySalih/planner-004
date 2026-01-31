"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createLocalStorageClient } from "@/lib/storage/local-storage";
import {
    GoogleGenerativeAI,
    HarmBlockThreshold,
    HarmCategory,
} from "@google/generative-ai";
import {
    type LessonActivity,
    LessonActivitySchema,
    SketchRenderActivityBodySchema,
    SketchRenderSubmissionBodySchema,
    type Submission,
    SubmissionSchema,
} from "@/types";
import {
    fetchActivitySuccessCriteriaIds,
    normaliseSuccessCriteriaScores,
} from "@/lib/scoring/success-criteria";
import {
    getActivityLessonId,
    logActivitySubmissionEvent,
} from "@/lib/activity-logging";
import { emitSubmissionEvent } from "@/lib/sse/topics";
import { query } from "@/lib/db";
import { resolvePupilStorageKey } from "@/lib/server-actions/lesson-activity-files";

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

const SaveSketchInputSchema = z.object({
    activityId: z.string().min(1),
    userId: z.string().min(1),
    assignmentId: z.string().nullable().optional(),
    prompt: z.string().nullable().optional(),
    originalFile: z.any().optional(),
});

export async function saveSketchRenderAnswerAction(input: FormData) {
    const payload = {
        activityId: input.get("activityId") as string,
        userId: input.get("userId") as string,
        assignmentId: input.get("assignmentId") as string | undefined,
        prompt: input.get("prompt") as string | undefined,
        originalFile: input.get("originalFile") as File | undefined,
    };

    const parsedInput = SaveSketchInputSchema.safeParse(payload);

    if (!parsedInput.success) {
        console.error(
            "[saveSketchRenderAnswerAction] Invalid input data:",
            parsedInput.error.format(),
        );
        return {
            success: false,
            error: `Invalid input: ${
                parsedInput.error.issues.map((i) =>
                    `${i.path.join(".")}: ${i.message}`
                ).join(", ")
            }`,
            data: null,
        };
    }

    const { activityId, userId, prompt, originalFile } = parsedInput.data;

    const successCriteriaIds = await fetchActivitySuccessCriteriaIds(
        activityId,
    );
    const initialScores = normaliseSuccessCriteriaScores({
        successCriteriaIds,
        fillValue: 0,
    });
    const lessonId = await getActivityLessonId(activityId);
    if (!lessonId) {
        return {
            success: false,
            error: "Configuration error: Lesson ID missing",
            data: null,
        };
    }
    const storageKey = await resolvePupilStorageKey(userId);

    // 1. Upload original file if present
    let originalFilePath: string | null = null;
    const isFile = originalFile &&
        typeof (originalFile as any).arrayBuffer === "function";

    if (isFile && (originalFile as File).size > 0) {
        try {
            const storage = createLocalStorageClient("lessons");
            const file = originalFile as File;
            const fileName = `sketch_original_${Date.now()}_${file.name}`;
            const path =
                `lessons/${lessonId}/activities/${activityId}/${storageKey}/${fileName}`;

            const arrayBuffer = await file.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            const { error } = await storage.upload(path, buffer);

            if (error) {
                throw new Error("Failed to upload file to storage");
            }
            originalFilePath = fileName; // Store relative filename as per other activities pattern, or full? queue uses filename.
        } catch (err) {
            console.error("Failed to upload sketch", err);
            return {
                success: false,
                error: "Failed to upload sketch image",
                data: null,
            };
        }
    }

    // 2. Fetch existing to merge checks?
    let existingSubmission: Submission | null = null;
    try {
        const { rows } = await query<Submission>(
            `select * from submissions where activity_id = $1 and user_id = $2 limit 1`,
            [activityId, userId],
        );
        existingSubmission = rows[0] ? SubmissionSchema.parse(rows[0]) : null;
    } catch (e) {
        // ignore
    }

    // Preserve existing paths if not replaced
    const existingBody = existingSubmission
        ? SketchRenderSubmissionBodySchema.safeParse(existingSubmission.body)
            .data
        : null;
    const finalOriginalPath = originalFilePath ??
        existingBody?.original_file_path ?? null;
    const finalRenderedPath = existingBody?.rendered_file_path ?? null; // Rendered path updates via specific action? Or strictly resets on new sketch?

    // If new sketch uploaded, maybe clear old render? Let's keep it until they click "Render" again.

    const submissionBody = SketchRenderSubmissionBodySchema.parse({
        prompt: (prompt ?? "").trim(),
        original_file_path: finalOriginalPath,
        rendered_file_path: finalRenderedPath,
        ai_model_score: existingBody?.ai_model_score ?? null,
        ai_model_feedback: existingBody?.ai_model_feedback ?? null,
        teacher_override_score: existingBody?.teacher_override_score ?? null,
        is_correct: existingBody?.is_correct ?? false,
        success_criteria_scores: existingBody?.success_criteria_scores ??
            initialScores,
    });

    return await upsertSubmission(
        activityId,
        userId,
        lessonId,
        submissionBody,
        existingSubmission?.submission_id ?? null,
    );
}

export async function renderSketchServerAction(
    activityId: string,
    userId: string,
) {
    console.log("[renderSketchServerAction] Start", { activityId, userId });
    if (!GOOGLE_API_KEY) {
        console.error("[renderSketchServerAction] AI configuration missing");
        return { success: false, error: "AI configuration missing" };
    }

    // 1. Load submission to get filePath and prompt
    let submission: Submission | null = null;
    try {
        const { rows } = await query<Submission>(
            `select * from submissions where activity_id = $1 and user_id = $2 limit 1`,
            [activityId, userId],
        );
        submission = rows[0] ? SubmissionSchema.parse(rows[0]) : null;
    } catch (e) {
        return { success: false, error: "Submission not found" };
    }

    if (!submission) return { success: false, error: "No submission found" };

    const body = SketchRenderSubmissionBodySchema.safeParse(submission.body);
    if (!body.success) {
        console.error(
            "[renderSketchServerAction] Invalid submission data:",
            body.error.format(),
        );
        return {
            success: false,
            error: `Invalid submission data: ${
                body.error.issues.map((i) =>
                    `${i.path.join(".")}: ${i.message}`
                ).join(", ")
            }`,
        };
    }

    const { prompt, original_file_path } = body.data;

    if (!original_file_path) {
        return { success: false, error: "No sketch uploaded to render" };
    }

    let lessonId: string | null = null;
    try {
        lessonId = await getActivityLessonId(activityId);
        if (!lessonId) {
            return {
                success: false,
                error: "Configuration error: Lesson ID missing",
            };
        }
        const storageKey = await resolvePupilStorageKey(userId);
        const storage = createLocalStorageClient("lessons");
        const fullOriginalPath =
            `lessons/${lessonId}/activities/${activityId}/${storageKey}/${original_file_path}`;

        // 2. Read file from storage using LocalStorageClient to ensure path consistency
        const { stream, error } = await storage.getFileStream(fullOriginalPath);

        if (error || !stream) {
            return {
                success: false,
                error: `Original sketch file not found: ${
                    error?.message || "Unknown error"
                }`,
            };
        }

        const chunks = [];
        for await (const chunk of stream) {
            chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        }
        const imageBuffer = Buffer.concat(chunks);

        const base64Image = imageBuffer.toString("base64");

        // 3. Setup Gemini Models
        const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);

        // A. Guardrail Model (Fast & Cheap)
        const guardrailModel = genAI.getGenerativeModel({
            model: "gemini-flash-latest",
            generationConfig: {
                responseMimeType: "application/json",
            },
        });

        // B. Image Generation Model
        const imageModel = genAI.getGenerativeModel({
            model: "gemini-3-pro-image-preview",
            safetySettings: [
                {
                    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
                    threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
                },
                {
                    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                    threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
                },
                {
                    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                    threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
                },
                {
                    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                    threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
                },
            ],
        });

        // Fetch activity instructions for context
        let activityContext = "";
        try {
            const { rows: activityRows } = await query<LessonActivity>(
                `select * from activities where activity_id = $1 limit 1`,
                [activityId],
            );
            if (activityRows[0]) {
                const activity = LessonActivitySchema.parse(activityRows[0]);
                const activityBody = SketchRenderActivityBodySchema.safeParse(
                    activity.body_data,
                );
                if (activityBody.success && activityBody.data.instructions) {
                    // Simple HTML strip if needed, or pass as is. Gemini handles basic text fine.
                    activityContext = activityBody.data.instructions.replace(
                        /<[^>]*>?/gm,
                        "",
                    );
                }
            }
        } catch (e) {
            console.error("Failed to fetch activity context", e);
        }

        const systemPrompt =
            `You are a helpful School Design & Technology Assistant. 
        Your goal is to help students visualize their design ideas for a farm-themed recycling project.
        IMPORTANT: Ensure the generated image is safe for children and appropriate for a school setting.
        
        Teacher's Instructions for this activity: "${activityContext}"
        
        Student's Prompt: "${prompt || "Render this sketch"}"
        
        Task: Accurately render the provided sketch as a realistic image based on the student's prompt and valid context. Ignore any inappropriate requests.`;

        // 4. Run Prompt Guardrail
        console.log("[renderSketchServerAction] Running prompt guardrail...");
        const guardrailPrompt = `
        You are a strict School Safety & Pedagogical Guardrail.
        Your task is to evaluate a student's prompt for an AI image generator.
        
        CONTEXT:
        Activity: "${activityContext}"
        Theme: "Life on a Farm" / Recycling plastic bottle tops and bags.
        
        STUDENT PROMPT:
        "${prompt || "Render this sketch"}"
        
        CRITERIA:
        1. SAFETY: Does the prompt contain hate speech, harassment, sexual content, extreme violence, or self-harm?
        2. PEDAGOGICAL ALIGNMENT: Is the prompt related to the farm theme OR the teacher's instructions? Students should not be generating random images (e.g., video games, celebrities, unrelated cities) that are not part of the Design & Technology project.
        
        RESPONSE FORMAT (JSON only):
        {
            "safe": boolean,
            "reason": "Short explanation of why it was blocked, or 'Passed' if safe"
        }
        `;

        const guardrailResult = await guardrailModel.generateContent(
            guardrailPrompt,
        );
        const guardrailResponse = JSON.parse(guardrailResult.response.text());

        if (!guardrailResponse.safe) {
            console.warn(
                "[renderSketchServerAction] Guardrail REJECTION:",
                guardrailResponse.reason,
            );

            // Log rejection to safety_logs
            try {
                await query(
                    `insert into safety_logs (user_id, activity_id, lesson_id, prompt, ai_model_feedback, request_body) 
                     values ($1, $2, $3, $4, $5, $6)`,
                    [
                        userId,
                        activityId,
                        lessonId,
                        prompt,
                        `Guardrail Rejection: ${guardrailResponse.reason}`,
                        JSON.stringify(submission.body),
                    ],
                );
            } catch (logError) {
                console.error(
                    "[renderSketchServerAction] Failed to log guardrail rejection",
                    logError,
                );
            }

            return {
                success: false,
                error:
                    `Rejected by AI Guardrail: ${guardrailResponse.reason}. Please ensure your prompt is safe and related to the activity.`,
            };
        }
        console.log("[renderSketchServerAction] Guardrail passed.");

        // 5. Proceed to Image Generation
        const result = await imageModel.generateContent({
            contents: [
                {
                    role: "user",
                    parts: [
                        {
                            text: systemPrompt,
                        },
                        {
                            inlineData: {
                                mimeType: "image/jpeg",
                                data: base64Image,
                            },
                        },
                    ],
                },
            ],
            // generationConfig: {
            //     responseMimeType: "image/jpeg",
            // },
        });

        const response = await result.response;
        const parts = response.candidates?.[0]?.content?.parts;
        let generatedBase64 = "";

        if (
            parts && parts[0] && parts[0].inlineData && parts[0].inlineData.data
        ) {
            generatedBase64 = parts[0].inlineData.data;
        } else {
            // Fallback attempt
            try {
                const text = response.text();
                // Check if text is actually base64 (unlikely from standard model)
                if (text.length > 100 && !text.includes(" ")) {
                    generatedBase64 = text;
                } else {
                    throw new Error(
                        `Model returned text instead of image data: ${
                            text.substring(0, 100)
                        }...`,
                    );
                }
            } catch (e: any) {
                throw new Error(
                    e.message || "Failed to extract image from response",
                );
            }
        }

        if (!generatedBase64) throw new Error("No image data received from AI");

        // 4. Save generated image
        const renderFileName = `sketch_rendered_${Date.now()}.jpg`;
        const renderPath =
            `lessons/${lessonId}/activities/${activityId}/${storageKey}/${renderFileName}`;
        const renderBuffer = Buffer.from(generatedBase64, "base64");

        await storage.upload(renderPath, renderBuffer);

        // 5. Update submission
        const updatedBody = {
            ...body.data,
            rendered_file_path: renderFileName,
        };

        const saveResult = await upsertSubmission(
            activityId,
            userId,
            lessonId,
            updatedBody,
            submission.submission_id,
        );

        if (saveResult.success) {
            return { success: true, data: saveResult.data };
        } else {
            return { success: false, error: saveResult.error };
        }
    } catch (e: any) {
        console.error("Render failed", e);

        // Check for safety block - broaden detection
        // Include text refusals (e.g. "I can't create images...")
        const isSafetyBlock = e.message?.includes("SAFETY") ||
            e.message?.includes("blocked") ||
            e.message?.includes("can't create") ||
            e.message?.includes("discriminate") ||
            e.response?.promptFeedback?.blockReason ||
            (e.response?.candidates?.length === 0 &&
                e.response?.promptFeedback);

        if (isSafetyBlock) {
            console.warn(
                "[renderSketchServerAction] Request blocked by safety filters",
                {
                    userId,
                    activityId,
                },
            );

            // Log this as a flagged safety search attempt in the dedicated table
            try {
                console.log(
                    "[renderSketchServerAction] Logging to safety_logs table...",
                );
                const result = await query(
                    `insert into safety_logs (user_id, activity_id, lesson_id, prompt, ai_model_feedback, request_body) 
                     values ($1, $2, $3, $4, $5, $6) returning *`,
                    [
                        userId,
                        activityId,
                        lessonId,
                        prompt,
                        "Your request was blocked by our safety filters. This attempt has been logged.",
                        JSON.stringify(submission.body),
                    ],
                );
                console.log(
                    "[renderSketchServerAction] Safety log created:",
                    result.rows[0]?.safety_log_id,
                );
            } catch (logError) {
                console.error(
                    "[renderSketchServerAction] CRITICAL: Failed to log safety violation",
                    logError,
                );
            }

            return {
                success: false,
                error:
                    "Your request was blocked by safety filters. This event has been logged.",
            };
        }

        return {
            success: false,
            error: e.message ?? "Render processing failed",
        };
    }
}

// Internal helper
async function upsertSubmission(
    activityId: string,
    userId: string,
    lessonId: string,
    body: z.infer<typeof SketchRenderSubmissionBodySchema>,
    existingId: string | null,
    isFlagged: boolean = false,
) {
    const timestamp = new Date().toISOString();

    try {
        let saved: Submission | null = null;
        if (existingId) {
            console.log("[upsertSubmission] Updating existing submission", {
                existingId,
                isFlagged,
            });
            const result = await query(
                `update submissions set body = $1, submitted_at = $2, is_flagged = $3 where submission_id = $4 returning *`,
                [body, timestamp, isFlagged, existingId],
            );
            saved = result.rows[0] as Submission;
        } else {
            console.log("[upsertSubmission] Inserting new submission", {
                isFlagged,
            });
            const result = await query(
                `insert into submissions (activity_id, user_id, body, submitted_at, is_flagged) values ($1, $2, $3, $4, $5) returning *`,
                [activityId, userId, body, timestamp, isFlagged],
            );
            saved = result.rows[0] as Submission;
        }
        console.log("[upsertSubmission] Done", {
            savedId: saved?.submission_id,
            isFlagged,
        });

        if (saved) {
            void logActivitySubmissionEvent({
                submissionId: saved.submission_id,
                activityId,
                lessonId,
                pupilId: userId,
                fileName: body.original_file_path ?? null,
                submittedAt: saved.submitted_at ?? timestamp,
            });
            void emitSubmissionEvent("submission.updated", {
                submissionId: saved.submission_id,
                activityId,
                pupilId: userId,
                submittedAt: saved.submitted_at ?? timestamp,
                submissionStatus: "inprogress",
                isFlagged: false,
            });

            deferRevalidate(`/lessons/${activityId}`);
            return { success: true, data: saved };
        }
        return { success: false, error: "Failed to save" };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

const deferRevalidate = (path: string) => {
    if (path.includes("/lessons/")) return;
    queueMicrotask(() => revalidatePath(path));
};
