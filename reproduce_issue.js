const { Client } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
const ACTIVITY_ID = 'dccefe60-c3f0-4872-9a46-386653da241c';
const USER_ID = '52e2c408-4960-48c9-b3c6-9d9bb5b70835';

async function run() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    console.log('--- Start ---');

    // 1. Check existing
    console.log('1. Checking existing submission...');
    const res1 = await client.query(
      `select submission_id from submissions where activity_id = $1 and user_id = $2 order by submitted_at desc limit 1`,
      [ACTIVITY_ID, USER_ID]
    );
    let existingId = res1.rows[0]?.submission_id;
    console.log('Existing ID:', existingId);

    const body = {
        answer: "First answer",
        ai_model_score: null,
        ai_model_feedback: null,
        teacher_override_score: null,
        is_correct: false,
        success_criteria_scores: {}
    };
    const timestamp = new Date().toISOString();

    let submissionId;

    // 2. Insert or Update (First Save)
    if (existingId) {
        console.log('2. Updating (First Save - simulating overwrite)...');
        const res2 = await client.query(
            `update submissions set body = $1, submitted_at = $2, is_flagged = false where submission_id = $3 returning *`,
            [body, timestamp, existingId]
        );
        submissionId = res2.rows[0].submission_id;
    } else {
        console.log('2. Inserting (First Save)...');
        const res2 = await client.query(
            `insert into submissions (activity_id, user_id, body, submitted_at) values ($1, $2, $3, $4) returning *`,
            [ACTIVITY_ID, USER_ID, body, timestamp]
        );
        submissionId = res2.rows[0].submission_id;
    }
    console.log('Saved 1:', submissionId);

    // 3. Log event 1
    console.log('3. Logging event 1...');
    // Need lesson_id
    const resLesson = await client.query(`select lesson_id from activities where activity_id = $1`, [ACTIVITY_ID]);
    const lessonId = resLesson.rows[0]?.lesson_id;
    
    await client.query(
        `insert into activity_submission_events (submission_id, activity_id, lesson_id, pupil_id, file_name, submitted_at) values ($1, $2, $3, $4, $5, $6)`,
        [submissionId, ACTIVITY_ID, lessonId, USER_ID, null, timestamp]
    );
    console.log('Logged 1');


    // 4. Second Save (Update)
    console.log('4. Second Save (Update)...');
    const body2 = { ...body, answer: "Second answer" };
    const timestamp2 = new Date().toISOString();

    // Check existing again (server action does this)
    const res3 = await client.query(
        `select submission_id from submissions where activity_id = $1 and user_id = $2 order by submitted_at desc limit 1`,
        [ACTIVITY_ID, USER_ID]
    );
    const existingId2 = res3.rows[0]?.submission_id;
    console.log('Existing ID 2:', existingId2);

    const res4 = await client.query(
        `update submissions set body = $1, submitted_at = $2, is_flagged = false where submission_id = $3 returning *`,
        [body2, timestamp2, existingId2]
    );
    console.log('Saved 2:', res4.rows[0].submission_id);

    // 5. Log event 2
    console.log('5. Logging event 2...');
    await client.query(
        `insert into activity_submission_events (submission_id, activity_id, lesson_id, pupil_id, file_name, submitted_at) values ($1, $2, $3, $4, $5, $6)`,
        [res4.rows[0].submission_id, ACTIVITY_ID, lessonId, USER_ID, null, timestamp2]
    );
    console.log('Logged 2');

    console.log('--- Done ---');

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

run();
