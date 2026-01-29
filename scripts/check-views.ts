import * as dotenv from "dotenv";
dotenv.config();
import { Pool } from "pg";

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function main() {
    console.log("Checking views...");

    try {
        const res = await pool.query(`
            SELECT table_name
            FROM information_schema.views
            WHERE table_schema = 'public'
        `);

        console.log("Views:", res.rows.map((r) => r.table_name));
    } catch (error) {
        console.error("Check failed:", error);
    } finally {
        await pool.end();
    }
}

main();
