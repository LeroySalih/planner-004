import * as dotenv from "dotenv";
dotenv.config();
import { Pool } from "pg";
import { z } from "zod";

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function main() {
    const assignmentId = process.argv[2];
    if (!assignmentId) {
        console.error("Please provide an assignment ID as the first argument.");
        process.exit(1);
    }

    console.log(`Clearing feedback for assignment: ${assignmentId}`);

    try {
        // 1. Parse Assignment ID (GroupId__LessonId)
        const [groupId, lessonId] = assignmentId.split("__");

        if (!groupId || !lessonId) {
            console.error(
                "Invalid assignment ID format. Expected GroupId__LessonId",
            );
            process.exit(1);
        }

        console.log(`Parsed Group ID: ${groupId}, Lesson ID: ${lessonId}`);

        // 2. Get Activities for Lesson
        const activitiesRes = await pool.query(
            `SELECT activity_id, title, type FROM activities WHERE lesson_id = $1`,
            [lessonId],
        );

        if (activitiesRes.rows.length === 0) {
            console.log("No activities found for this lesson.");
            process.exit(0);
        }

        const activityIds = activitiesRes.rows.map((r) => r.activity_id);
        console.log(`Found ${activityIds.length} activities.`);

        // 3. Clear Feedback in Submissions
        // We update submissions for these activities.
        // Ideally we should also filter by pupils in the group, but submissions are usually unique to user+activity.
        // And if the assignment is for the group, clearing for the lesson might affect other groups if they share the lesson?
        // Submissions table has `user_id`. We should verify which users belong to the group to be safe.
        // Usually `group_membership` links `group_id` and `user_id`.

        const membersRes = await pool.query(
            `SELECT user_id FROM group_membership WHERE group_id = $1`,
            [groupId],
        );
        const userIds = membersRes.rows.map((r) => r.user_id);

        if (userIds.length === 0) {
            console.log("No students in this group.");
            process.exit(0);
        }

        console.log(`Found ${userIds.length} students in the group.`);

        // 4. Update Submissions
        // Wipe: ai_model_feedback, ai_model_score, teacher_override_score, teacher_feedback, is_correct
        // We use JSONB concatenation to overwrite fields.

        const updateQuery = `
      UPDATE submissions
      SET body = (body::jsonb || $1::jsonb)::json
      WHERE activity_id = ANY($2)
      AND user_id = ANY($3)
      RETURNING submission_id, activity_id
    `;

        const resetPayload = JSON.stringify({
            ai_model_feedback: null,
            ai_model_score: null,
            teacher_override_score: null,
            is_correct: false,
            teacher_feedback: null,
            success_criteria_scores: {},
            score: null,
            auto_score: null,
            override_score: null,
        });

        const updateRes = await pool.query(updateQuery, [
            resetPayload,
            activityIds,
            userIds,
        ]);

        console.log(`Updated ${updateRes.rowCount} submissions.`);

        // 5. Delete from pupil_activity_feedback
        console.log("Clearing separate feedback entries...");
        const deleteFeedbackRes = await pool.query(
            `DELETE FROM pupil_activity_feedback 
         WHERE activity_id = ANY($1) 
         AND pupil_id = ANY($2)`,
            [activityIds, userIds],
        );
        console.log(`Deleted ${deleteFeedbackRes.rowCount} feedback entries.`);

        // 6. Delete from sse_events (Clear stale cache re-broadcasts)
        console.log("Clearing SSE event history...");
        const deleteSseRes = await pool.query(
            `DELETE FROM sse_events 
             WHERE (payload->>'activityId' = ANY($1) OR payload->>'activity_id' = ANY($1))
             AND (payload->>'pupilId' = ANY($2) OR payload->>'user_id' = ANY($2))`,
            [activityIds, userIds],
        );
        console.log(`Deleted ${deleteSseRes.rowCount} SSE events.`);
    } catch (error) {
        console.error("Error clearing feedback:", error);
    } finally {
        await pool.end();
    }
}

main();
