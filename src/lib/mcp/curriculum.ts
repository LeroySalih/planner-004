import { createSupabaseServiceClient } from "@/lib/supabase/server"

type CurriculumSummary = {
  curriculum_id: string
  title: string
  is_active: boolean
}

export async function listCurriculumSummaries(): Promise<CurriculumSummary[]> {
  const supabase = createSupabaseServiceClient()

  const { data, error } = await supabase
    .from("curricula")
    .select("curriculum_id, title, active")
    .order("title", { ascending: true })

  if (error) {
    throw new Error(error.message)
  }

  return (data ?? []).map((entry) => ({
    curriculum_id: entry.curriculum_id,
    title: entry.title ?? "",
    is_active: entry.active ?? false,
  }))
}

export async function getCurriculumSummary(curriculumId: string): Promise<CurriculumSummary | null> {
  const supabase = createSupabaseServiceClient()

  const { data, error } = await supabase
    .from("curricula")
    .select("curriculum_id, title, active")
    .eq("curriculum_id", curriculumId)
    .maybeSingle()

  if (error && error.code !== "PGRST116") {
    throw new Error(error.message)
  }

  if (!data) {
    return null
  }

  return {
    curriculum_id: data.curriculum_id,
    title: data.title ?? "",
    is_active: data.active ?? false,
  }
}
