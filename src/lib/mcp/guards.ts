import type { PoolClient } from 'pg'

/**
 * Throws if the unit is active. MCP write operations are only permitted
 * against inactive units so live teaching content cannot be accidentally modified.
 */
export async function assertUnitIsInactive(client: PoolClient, unitId: string): Promise<void> {
  const { rows } = await client.query<{ active: boolean }>(
    'select active from units where unit_id = $1 limit 1',
    [unitId],
  )
  if (!rows[0]) throw new Error(`Unit ${unitId} not found`)
  if (rows[0].active) {
    throw new Error(
      `Unit ${unitId} is active. MCP write operations are only allowed on inactive units. Deactivate the unit in the app before making changes via MCP.`,
    )
  }
}

/**
 * Resolves the unit for a lesson then calls assertUnitIsInactive.
 */
export async function assertLessonUnitIsInactive(client: PoolClient, lessonId: string): Promise<void> {
  const { rows } = await client.query<{ unit_id: string }>(
    'select unit_id from lessons where lesson_id = $1 limit 1',
    [lessonId],
  )
  if (!rows[0]) throw new Error(`Lesson ${lessonId} not found`)
  await assertUnitIsInactive(client, rows[0].unit_id)
}
