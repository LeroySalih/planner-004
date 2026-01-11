import { NextResponse } from "next/server";
import { processNextQueueItem, pruneCompletedQueueItems, recoverStuckItems, logQueueEvent } from "@/lib/ai/marking-queue";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secret = process.env.MARKING_QUEUE_SECRET;
  const authHeader = request.headers.get("Authorization");

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await logQueueEvent('info', 'Queue processor triggered');

    // 1. Recover any stuck items (housekeeping)
    await recoverStuckItems();

    // 2. Prune old items (housekeeping)
    await pruneCompletedQueueItems();

    // 3. Process one item
    const { processed, remaining } = await processNextQueueItem();

    // 4. Self-chain if more items remain
    if (remaining > 0) {
      const baseUrl = process.env.AI_MARKING_CALLBACK_URL 
        ? new URL(process.env.AI_MARKING_CALLBACK_URL).origin 
        : new URL(request.url).origin;

      await logQueueEvent('info', `Self-chaining: ${remaining} items remaining`);

      // Trigger next item in background
      void fetch(`${baseUrl}/api/marking/process-queue`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${secret}`,
        }
      });
    }

    return NextResponse.json({
      success: true,
      processed,
      remaining
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await logQueueEvent('error', 'Queue processor API failed', { error: errorMessage });
    console.error("[api/marking/process-queue] Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
