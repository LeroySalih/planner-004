import type { PoolClient } from 'pg'

export async function assertUnitExists(client: PoolClient, unitId: string): Promise<void> {
  const { rows } = await client.query('select 1 from units where unit_id = $1 limit 1', [unitId])
  if (!rows[0]) throw new Error(`Unit ${unitId} not found`)
}

export async function assertLessonExists(client: PoolClient, lessonId: string): Promise<void> {
  const { rows } = await client.query('select 1 from lessons where lesson_id = $1 limit 1', [lessonId])
  if (!rows[0]) throw new Error(`Lesson ${lessonId} not found`)
}
