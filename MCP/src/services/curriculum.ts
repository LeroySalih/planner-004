import { getSupabaseServiceClient } from '../supabase.js';

export type CurriculumSummary = {
  curriculum_id: string;
  title: string;
  is_active: boolean;
};

export async function listCurriculumSummaries(): Promise<CurriculumSummary[]> {
  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase
    .from('curricula')
    .select('curriculum_id, title, active')
    .order('title', { ascending: true });

  if (error) {
    throw new Error(`Failed to load curriculum summaries: ${error.message}`);
  }

  return (data ?? []).map(entry => ({
    curriculum_id: entry.curriculum_id as string,
    title: typeof entry.title === 'string' ? entry.title : '',
    is_active: Boolean(entry.active)
  }));
}
