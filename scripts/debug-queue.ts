import { query } from "@/lib/db";

async function main() {
    console.log("Fetching recent AI Marking Logs (last 50)...");

    const { rows } = await query(`
    SELECT created_at, level, message, metadata 
    FROM ai_marking_logs 
    ORDER BY created_at DESC 
    LIMIT 50
  `);

    if (rows.length === 0) {
        console.log("No logs found.");
        return;
    }

    console.log("Time | Level | Message");
    console.log("--- | --- | ---");

    // Show chronological
    (rows as { created_at: string | Date; level: string; message: string }[])
        .reverse().forEach((row) => {
            // Truncate message if too long
            const msg = row.message.length > 100
                ? row.message.substring(0, 100) + "..."
                : row.message;
            console.log(
                `${
                    new Date(row.created_at).toISOString()
                } | ${row.level} | ${msg}`,
            );
        });
}

main().catch((err) => {
    console.error("Error:", err);
    process.exit(1);
});
