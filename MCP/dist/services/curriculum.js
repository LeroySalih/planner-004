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
export async function getCurriculumSummary(curriculumId) {
    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase
        .from('curricula')
        .select('curriculum_id, title, active')
        .eq('curriculum_id', curriculumId)
        .maybeSingle();
    if (error && error.code !== 'PGRST116') {
        throw new Error(`Failed to load curriculum ${curriculumId}: ${error.message}`);
    }
    if (!data) {
        return null;
    }
    return {
        curriculum_id: data.curriculum_id,
        title: typeof data.title === 'string' ? data.title : '',
        is_active: Boolean(data.active)
    };
}
export async function findCurriculumIdsByTitle(query) {
    const supabase = getSupabaseServiceClient();
    const normalized = query.trim();
    if (!normalized) {
        return [];
    }
    const isRegex = normalized.startsWith('/') && normalized.endsWith('/') && normalized.length > 2;
    const baseSelect = supabase
        .from('curricula')
        .select('curriculum_id, title')
        .order('title', { ascending: true })
        .limit(200);
    const request = isRegex
        ? baseSelect.filter('title', 'regex', normalized.slice(1, -1))
        : baseSelect.ilike('title', toIlikePattern(normalized));
    const { data, error } = await request;
    if (error) {
        throw new Error(`Failed to match curriculum titles: ${error.message}`);
    }
    return (data ?? []).map(entry => ({
        curriculum_id: entry.curriculum_id,
        curriculum_title: typeof entry.title === 'string' ? entry.title : ''
    }));
}
function toIlikePattern(input) {
    const escaped = input.replace(/[%_]/g, match => `\\${match}`);
    const replaced = escaped.replace(/\*/g, '%').replace(/\?/g, '_');
    if (!replaced.includes('%') && !replaced.includes('_')) {
        return `%${replaced}%`;
    }
    return replaced;
}
