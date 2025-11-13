import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cachedClient: SupabaseClient | null = null;

export function getSupabaseServiceClient(): SupabaseClient {
  if (cachedClient) {
    return cachedClient;
  }

  const url = process.env.PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

export async function verifySupabaseConnection(): Promise<{ checkedAt: string; sampleCount: number | null }> {
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
