import * as dotenv from "dotenv";
dotenv.config();
import { Pool } from "pg";

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function main() {
    console.log("Starting migration: Add hidden column to lesson_assignments");

    try {
        const res = await pool.query(`
            ALTER TABLE lesson_assignments
            ADD COLUMN IF NOT EXISTS hidden BOOLEAN DEFAULT FALSE;
        `);
        console.log("Migration successful:", res);
    } catch (error) {
        console.error("Migration failed:", error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

main();
