import { query } from "@/lib/db";

async function main() {
    console.log("Fetching recent AI Marking Logs...");

    // Fetch the last 20 logs that involve triggering the DO function
    const { rows } = await query(`
    SELECT created_at, message, metadata 
    FROM ai_marking_logs 
    WHERE message LIKE '%Triggering DO function%' 
    ORDER BY created_at DESC 
    LIMIT 20
  `);

    if (rows.length === 0) {
        console.log("No 'Triggering DO function' logs found.");
        return;
    }

    console.log(`Found ${rows.length} recent triggers.`);
    console.log("Timestamp | Submission ID");
    console.log("--- | ---");

    // Reverse to show chronological order of the last N items
    rows.reverse().forEach((row) => {
        const meta = row.metadata as any;
        const subId = meta?.submission_id || "N/A";
        console.log(`${new Date(row.created_at).toISOString()} | ${subId}`);
    });
}

main().catch((err) => {
    console.error("Error:", err);
    process.exit(1);
});
