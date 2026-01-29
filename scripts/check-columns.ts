import * as dotenv from "dotenv";
dotenv.config();
import { Pool } from "pg";

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function main() {
    console.log("Checking columns of group_membership...");

    try {
        const res = await pool.query(`
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'group_membership'
        `);

        console.log("Columns:", res.rows.map((r) => r.column_name));
    } catch (error) {
        console.error("Check failed:", error);
    } finally {
        await pool.end();
    }
}

main();
