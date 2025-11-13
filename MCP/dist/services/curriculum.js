import { getSupabaseServiceClient } from '../supabase.js';
export async function listCurriculumSummaries() {
    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase
        .from('curricula')
        .select('curriculum_id, title, active')
        .order('title', { ascending: true });
    if (error) {
        throw new Error(`Failed to load curriculum summaries: ${error.message}`);
    }
    return (data ?? []).map(entry => ({
        curriculum_id: entry.curriculum_id,
        title: typeof entry.title === 'string' ? entry.title : '',
        is_active: Boolean(entry.active)
    }));
}
