import * as dotenv from "dotenv";
dotenv.config();
import { Pool } from "pg";

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function main() {
    console.log("Verifying pupil_lessons_detail_bootstrap output (v2)...");

    try {
        // 1. Find a pupil - avoid using 'role' column since it might not exist
        const pupilRes = await pool.query(`
            SELECT p.user_id, p.first_name, p.last_name
            FROM profiles p
            JOIN group_membership gm ON gm.user_id = p.user_id
            LIMIT 1
        `);

        if (pupilRes.rows.length === 0) {
            console.log("No pupil found to test with.");
            return;
        }

        const pupilId = pupilRes.rows[0].user_id;
        console.log(
            `Testing with pupil: ${pupilRes.rows[0].first_name} (${pupilId})`,
        );

        // 2. Call the function
        const res = await pool.query(
            `
            select * from pupil_lessons_detail_bootstrap($1::text)
        `,
            [pupilId],
        );

        const data = res.rows[0];
        const rawKey = Object.keys(data)[0];
        const payload = data[rawKey];

        if (!payload) {
            console.log("No payload returned.");
            return;
        }

        const lessonAssignments = payload.lessonAssignments || [];
        console.log(`Found ${lessonAssignments.length} lesson assignments.`);

        if (lessonAssignments.length > 0) {
            console.log("First 3 assignments:");
            lessonAssignments.slice(0, 3).forEach((la: any) => {
                console.log(
                    `- Lesson: ${la.lesson_title}, Hidden: ${la.hidden} (type: ${typeof la
                        .hidden})`,
                );
            });
        }
    } catch (error) {
        console.error("Verification failed:", error);
    } finally {
        await pool.end();
    }
}

main();
