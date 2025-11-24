import { createClient } from '@supabase/supabase-js';
let cachedClient = null;
export function getSupabaseServiceClient() {
    if (cachedClient) {
        return cachedClient;
    }
    const url = process.env.PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? null;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY ?? process.env.SERVICE_ROLE_KEY ?? null;
    if (!url) {
        throw new Error('PUBLIC_SUPABASE_URL (or SUPABASE_URL) is not set. Cannot create Supabase client.');
    }
    if (!serviceKey) {
        throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set. Cannot create Supabase client.');
    }
    cachedClient = createClient(url, serviceKey, {
        auth: {
            persistSession: false
        }
    });
    return cachedClient;
}
export async function verifySupabaseConnection() {
    const client = getSupabaseServiceClient();
    const { count, error } = await client
        .from('curricula')
        .select('curriculum_id', { head: true, count: 'estimated' });
    if (error) {
        throw new Error(`Supabase connectivity check failed: ${error.message}`);
    }
    return {
        checkedAt: new Date().toISOString(),
        sampleCount: typeof count === 'number' ? count : null
    };
}
