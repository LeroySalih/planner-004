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
