import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedProfile } from "@/lib/auth";
import { createLocalStorageClient } from "@/lib/storage/local-storage";
import { resolvePupilStorageKey } from "@/lib/server-actions/lesson-activity-files";

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const lessonId = searchParams.get("lessonId");
    const activityId = searchParams.get("activityId");
    const fileName = searchParams.get("fileName");
    const userId = searchParams.get("userId");

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
    // If userId is provided (teacher viewing pupil's file), use that.
    // Otherwise, use the authenticated user's ID (pupil viewing their own file).
    const targetUserId = userId || profile.userId;

    const storageKey = await resolvePupilStorageKey(targetUserId);
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
