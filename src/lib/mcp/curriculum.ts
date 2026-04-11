import { query } from "@/lib/db"

type CurriculumSummary = {
  curriculum_id: string
  title: string
  is_active: boolean
}

export async function listCurriculumSummaries(): Promise<CurriculumSummary[]> {
  const { rows } = await query(
    "select curriculum_id, title, active from curricula order by title asc",
  )

  return (rows ?? []).map((entry) => ({
    curriculum_id: typeof entry.curriculum_id === "string" ? entry.curriculum_id : String(entry.curriculum_id ?? ""),
    title: typeof entry.title === "string" ? entry.title : "",
    is_active: entry.active === true,
  }))
}

export async function getCurriculumSummary(curriculumId: string): Promise<CurriculumSummary | null> {
  const { rows } = await query(
    "select curriculum_id, title, active from curricula where curriculum_id = $1 limit 1",
    [curriculumId],
  )
  const data = rows?.[0] ?? null
  if (!data) return null

  return {
    curriculum_id: typeof data.curriculum_id === "string" ? data.curriculum_id : String(data.curriculum_id ?? ""),
    title: typeof data.title === "string" ? data.title : "",
    is_active: data.active === true,
  }
}

export type CurriculumTitleMatch = {
  curriculum_id: string
  curriculum_title: string
}

export async function findCurriculumIdsByTitle(queryStr: string): Promise<CurriculumTitleMatch[]> {
  const normalized = queryStr.trim()
  if (!normalized) return []

  const isRegex =
    normalized.startsWith('/') && normalized.endsWith('/') && normalized.length > 2

  let sql: string
  let param: string

  if (isRegex) {
    // Strip surrounding slashes, use PostgreSQL case-insensitive regex
    const pattern = normalized.slice(1, -1)
    sql =
      'SELECT curriculum_id, title FROM curricula WHERE title ~* $1 ORDER BY title ASC LIMIT 200'
    param = pattern
  } else {
    // Convert glob wildcards (* → %, ? → _), wrap bare terms in %…%
    const escaped = normalized.replace(/[%_]/g, (m) => `\\${m}`)
    const replaced = escaped.replace(/\*/g, '%').replace(/\?/g, '_')
    const pattern =
      replaced.includes('%') || replaced.includes('_') ? replaced : `%${replaced}%`
    sql =
      'SELECT curriculum_id, title FROM curricula WHERE title ILIKE $1 ORDER BY title ASC LIMIT 200'
    param = pattern
  }

  const { rows } = await query(sql, [param])

  return (rows ?? []).map((row) => ({
    curriculum_id: typeof row.curriculum_id === 'string' ? row.curriculum_id : String(row.curriculum_id ?? ''),
    curriculum_title: typeof row.title === 'string' ? row.title : '',
  }))
}
