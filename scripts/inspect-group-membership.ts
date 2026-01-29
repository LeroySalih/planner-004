import * as dotenv from "dotenv";
dotenv.config();
import { Pool } from "pg";

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function main() {
    console.log("Inspecting group_membership data...");

    try {
        const res = await pool.query(`
            SELECT * FROM group_membership LIMIT 1
        `);

        if (res.rows.length > 0) {
            console.log("Row keys:", Object.keys(res.rows[0]));
            console.log("Row:", res.rows[0]);
        } else {
            console.log("Table is empty.");
        }
    } catch (error) {
        console.error("Inspect failed:", error);
    } finally {
        await pool.end();
    }
}

main();
