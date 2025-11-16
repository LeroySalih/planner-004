import { getSupabaseServiceClient } from '../supabase.js';
export async function listLessonsForUnit(unitId) {
    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase
        .from('lessons')
        .select('lesson_id, unit_id, title, active, order_by')
        .eq('unit_id', unitId)
        .order('order_by', { ascending: true, nullsFirst: false })
        .order('title', { ascending: true });
    if (error) {
        throw new Error(`Failed to load lessons for unit ${unitId}: ${error.message}`);
    }
    return (data ?? []).map((entry, index) => {
        const numericOrder = typeof entry.order_by === 'number'
            ? entry.order_by
            : typeof entry.order_by === 'string'
                ? Number.parseInt(entry.order_by, 10)
                : null;
        return {
            lesson_id: entry.lesson_id,
            unit_id: entry.unit_id,
            title: typeof entry.title === 'string' ? entry.title : '',
            is_active: Boolean(entry.active),
            order_index: Number.isFinite(numericOrder) ? numericOrder : index
        };
    });
}
