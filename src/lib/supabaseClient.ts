import { createClient } from '@supabase/supabase-js'

// Use env variables to avoid leaking keys
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!

console.log("Supabase URL:", supabaseUrl); // Debugging line
console.log("Supabase Anon Key:", supabaseAnonKey); // Debugging line
export const supabaseServer = createClient(supabaseUrl, supabaseAnonKey)