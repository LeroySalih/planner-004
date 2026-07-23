import { NextResponse } from "next/server";

import {
  processNextJobs,
  pruneDoneJobs,
  recoverStuckJobs,
} from "@/lib/jobs/external-jobs";

export const dynamic = "force-dynamic";

/**
 * Processor for the generalized external-service job queue. Auth via the shared
 * MARKING_QUEUE_SECRET. Runs housekeeping, processes a batch, and self-chains
 * while jobs remain.
 */
export async function POST(request: Request) {
  const secret = process.env.MARKING_QUEUE_SECRET;
  const authHeader = request.headers.get("Authorization");

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let remaining = 0;
  try {
    await recoverStuckJobs();
    await pruneDoneJobs();

    const result = await processNextJobs();
    remaining = result.remaining;

    return NextResponse.json({ success: true, processed: result.processed, remaining });
  } catch (error) {
    console.error("[api/jobs/process] Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  } finally {
    if (remaining > 0) {
      const baseUrl = process.env.AI_MARKING_CALLBACK_URL
        ? new URL(process.env.AI_MARKING_CALLBACK_URL).origin
        : new URL(request.url).origin;
      void fetch(`${baseUrl}/api/jobs/process`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` },
      }).catch((err) => console.error("[api/jobs/process] Failed to self-chain:", err));
    }
  }
}
