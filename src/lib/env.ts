// Public, browser-shipped configuration. Never put the Supabase service_role
// key here — only the anon key, which is safe to expose. The map (OpenFreeMap)
// and place search (Nominatim) need no key at all.
export const env = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL as string | undefined,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined,
};

export const hasSupabase = !!(env.supabaseUrl && env.supabaseAnonKey);
export const isConfigured = hasSupabase;
