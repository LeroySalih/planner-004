import { NextResponse } from "next/server";
import {
  logQueueEvent,
  processNextQueueItem,
  pruneCompletedQueueItems,
  recoverStuckItems,
} from "@/lib/ai/marking-queue";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secret = process.env.MARKING_QUEUE_SECRET;
  const authHeader = request.headers.get("Authorization");

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let remaining = 0;
  try {
    await logQueueEvent("info", "Queue processor triggered");

    // 1. Recover any stuck items (housekeeping)
    await recoverStuckItems();

    // 2. Prune old items (housekeeping)
    await pruneCompletedQueueItems();

    // 3. Process batch
    const result = await processNextQueueItem();
    remaining = result.remaining;

    return NextResponse.json({
      success: true,
      processed: result.processed,
      remaining,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await logQueueEvent("error", "Queue processor API failed", {
      error: errorMessage,
    });
    console.error("[api/marking/process-queue] Error:", error);

    // Attempt to get remaining count even on error to decide if we should retry/continue
    // This might fail if DB is down, but worth a try to keep chain alive
    try {
      const { rows } = await import("@/lib/db").then((m) =>
        m.query(
          "SELECT count(*) FROM ai_marking_queue WHERE status = 'pending' AND attempts < 3",
        )
      );
      remaining = parseInt(rows[0].count as string, 10);
    } catch (e) { /* ignore */ }

    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  } finally {
    // 4. Self-chain if more items remain (Robust logging)
    if (remaining > 0) {
      const baseUrl = process.env.AI_MARKING_CALLBACK_URL
        ? new URL(process.env.AI_MARKING_CALLBACK_URL).origin
        : new URL(request.url).origin;

      await logQueueEvent(
        "info",
        `Self-chaining: ${remaining} items remaining`,
      );

      // Trigger next item in background
      void fetch(`${baseUrl}/api/marking/process-queue`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
        },
      }).catch((err) => console.error("Failed to self-chain:", err));
    }
  }
}
