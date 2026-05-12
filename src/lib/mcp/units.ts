import { query } from '@/lib/db'

export type UnitSummary = {
  unit_id: string
  title: string
  is_active: boolean
}

export type UnitTitleMatch = {
  unit_id: string
  unit_title: string
}

export async function listUnits(): Promise<UnitSummary[]> {
  const { rows } = await query(
    'SELECT unit_id, title, active FROM units ORDER BY title ASC',
  )

  return (rows ?? []).map((row) => ({
    unit_id: typeof row.unit_id === 'string' ? row.unit_id : String(row.unit_id ?? ''),
    title: typeof row.title === 'string' ? row.title : '',
    is_active: row.active === true,
  }))
}

export type UnitRecord = {
  unit_id: string
  title: string
  subject: string
  description: string | null
  year: number | null
  is_active: boolean
}

export async function createUnit(
  title: string,
  subject: string,
  description?: string | null,
  year?: number | null,
): Promise<UnitRecord> {
  const sanitizedYear =
    typeof year === 'number' && Number.isFinite(year)
      ? Math.min(Math.max(Math.trunc(year), 1), 13)
      : null

  const { rows } = await query<{
    unit_id: string
    title: string
    subject: string
    description: string | null
    year: number | null
    active: boolean
  }>(
    `insert into units (title, subject, description, year, active)
     values ($1, $2, $3, $4, false)
     returning unit_id, title, subject, description, year, active`,
    [title.trim(), subject.trim(), description?.trim() ?? null, sanitizedYear],
  )
  const row = rows[0]
  if (!row) throw new Error('Failed to create unit')
  return {
    unit_id: row.unit_id,
    title: row.title,
    subject: row.subject,
    description: row.description,
    year: row.year,
    is_active: row.active,
  }
}

export async function findUnitsByTitle(queryStr: string): Promise<UnitTitleMatch[]> {
  const normalized = queryStr.trim()
  if (!normalized) return []

  const isRegex =
    normalized.startsWith('/') && normalized.endsWith('/') && normalized.length > 2

  let sql: string
  let param: string

  if (isRegex) {
    const pattern = normalized.slice(1, -1)
    sql = 'SELECT unit_id, title FROM units WHERE title ~* $1 ORDER BY title ASC LIMIT 200'
    param = pattern
  } else {
    const escaped = normalized.replace(/[%_]/g, (m) => `\\${m}`)
    const replaced = escaped.replace(/\*/g, '%').replace(/\?/g, '_')
    const pattern =
      replaced.includes('%') || replaced.includes('_') ? replaced : `%${replaced}%`
    sql = 'SELECT unit_id, title FROM units WHERE title ILIKE $1 ORDER BY title ASC LIMIT 200'
    param = pattern
  }

  const { rows } = await query(sql, [param])

  return (rows ?? []).map((row) => ({
    unit_id: typeof row.unit_id === 'string' ? row.unit_id : String(row.unit_id ?? ''),
    unit_title: typeof row.title === 'string' ? row.title : '',
  }))
}
