import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env, hasSupabase } from "./env";

// A single shared client. Null when the app hasn't been configured yet, so the
// UI can show the setup screen instead of crashing.
export const supabase: SupabaseClient<any, "fogofwar"> | null = hasSupabase
  ? createClient(env.supabaseUrl!, env.supabaseAnonKey!, {
      auth: { persistSession: true, autoRefreshToken: true },
      // Shared Supabase project: each app lives in its own schema.
      db: { schema: "fogofwar" },
    })
  : null;
