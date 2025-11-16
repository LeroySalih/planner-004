import { getSupabaseServiceClient } from '../supabase.js';
export async function listUnits() {
    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase
        .from('units')
        .select('unit_id, title, active')
        .order('title', { ascending: true });
    if (error) {
        throw new Error(`Failed to load units: ${error.message}`);
    }
    return (data ?? []).map(entry => ({
        unit_id: entry.unit_id,
        title: typeof entry.title === 'string' ? entry.title : '',
        is_active: Boolean(entry.active)
    }));
}
export async function findUnitsByTitle(query) {
    const supabase = getSupabaseServiceClient();
    const normalized = query.trim();
    if (!normalized) {
        return [];
    }
    const isRegex = normalized.startsWith('/') && normalized.endsWith('/') && normalized.length > 2;
    const baseSelect = supabase
        .from('units')
        .select('unit_id, title')
        .order('title', { ascending: true })
        .limit(200);
    const request = isRegex
        ? baseSelect.filter('title', 'regex', normalized.slice(1, -1))
        : baseSelect.ilike('title', toIlikePattern(normalized));
    const { data, error } = await request;
    if (error) {
        throw new Error(`Failed to match unit titles: ${error.message}`);
    }
    return (data ?? []).map(entry => ({
        unit_id: entry.unit_id,
        unit_title: typeof entry.title === 'string' ? entry.title : ''
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
