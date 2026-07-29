// Public, browser-shipped configuration. Never put the Supabase service_role
// key here — only the anon key, which is safe to expose.
export const env = {
  maptilerKey: import.meta.env.VITE_MAPTILER_KEY as string | undefined,
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL as string | undefined,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined,
};

export const hasMap = !!env.maptilerKey;
export const hasSupabase = !!(env.supabaseUrl && env.supabaseAnonKey);
export const isConfigured = hasMap && hasSupabase;
