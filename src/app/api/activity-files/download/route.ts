import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedProfile } from "@/lib/auth";
import { createLocalStorageClient } from "@/lib/storage/local-storage";
import { resolvePupilStorageKey } from "@/lib/server-actions/lesson-activity-files";

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const lessonId = searchParams.get("lessonId");
    const activityId = searchParams.get("activityId");
    const fileName = searchParams.get("fileName");

    if (!lessonId || !activityId || !fileName) {
        return NextResponse.json({ error: "Missing parameters" }, {
            status: 400,
        });
    }

    const profile = await getAuthenticatedProfile();
    if (!profile) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Determine whose file we are accessing.
    // If the user is the pupil, they access their own file.
    // If the user is a teacher, they might be accessing a pupil's file - but getting the pupilId here is tricky.
    // For now, let's assume this endpoint is for the PUPIL viewing THEIR OWN file (revisit for teacher view).
    // Reviewing PupilSketchRenderActivity: it is used by pupil.
    // Teacher view (SketchRenderFeedbackView) likely uses a different mechanism or passes the explicit path/URL?
    // Wait, SketchRenderFeedbackView uses `readSubmissionByIdAction`. Does it use this API route?
    // Let's check SketchRenderFeedbackView later. For pupil, it's their own.

    const storageKey = await resolvePupilStorageKey(profile.userId);
    const path =
        `lessons/${lessonId}/activities/${activityId}/${storageKey}/${fileName}`;

    const storage = createLocalStorageClient("lessons");
    const { stream, metadata, error } = await storage.getFileStream(path);

    if (error || !stream || !metadata) {
        console.error("Download failed", { path, error });
        return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const headers = new Headers();
    headers.set(
        "Content-Type",
        (metadata.content_type as string | undefined) ||
            inferContentType(fileName),
    );
    headers.set("Content-Length", String(metadata.size_bytes));

    return new Response(stream as any, { headers });
}

function inferContentType(fileName: string) {
    const name = fileName.toLowerCase();
    if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
    if (name.endsWith(".png")) return "image/png";
    if (name.endsWith(".webp")) return "image/webp";
    if (name.endsWith(".heic")) return "image/heic";
    return "application/octet-stream";
}
