import * as dotenv from "dotenv";
dotenv.config();
import { Pool } from "pg";

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function main() {
    console.log("Inspecting user_roles...");

    try {
        const res = await pool.query(`
            SELECT * FROM user_roles LIMIT 5
        `);
        console.log("Rows:", res.rows);
    } catch (error) {
        console.error("Inspect failed:", error);
    } finally {
        await pool.end();
    }
}

main();
