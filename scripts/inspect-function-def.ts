import * as dotenv from "dotenv";
dotenv.config();
import { Pool } from "pg";

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function main() {
    console.log("Inspecting function definition...");

    try {
        const res = await pool.query(`
            SELECT prosrc
            FROM pg_proc
            WHERE proname = 'pupil_lessons_detail_bootstrap'
        `);

        if (res.rows.length > 0) {
            console.log("Source:", res.rows[0].prosrc);
        } else {
            console.log("Function not found.");
        }
    } catch (error) {
        console.error("Inspect failed:", error);
    } finally {
        await pool.end();
    }
}

main();
