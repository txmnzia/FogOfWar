import { hasMap, hasSupabase } from "../lib/env";

export function SetupScreen() {
  return (
    <div className="center">
      <div className="card">
        <p className="eyebrow">Fog of War · setup</p>
        <h1>Almost ready</h1>
        <p>
          The app needs two free accounts before it can draw your world. Create a{" "}
          <code>.env</code> file (copy <code>.env.example</code>) and fill in these values:
        </p>
        <ol>
          <li>
            {hasMap ? "✓ " : ""}
            <b>MapTiler key</b> — sign up at <a href="https://cloud.maptiler.com/account/keys/" target="_blank" rel="noreferrer">cloud.maptiler.com</a>,
            copy a key into <code>VITE_MAPTILER_KEY</code>. Powers the parchment map and place search.
          </li>
          <li>
            {hasSupabase ? "✓ " : ""}
            <b>Supabase project</b> — create one at <a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">supabase.com</a>,
            then Settings → API. Put the Project URL in <code>VITE_SUPABASE_URL</code> and the <code>anon public</code> key in <code>VITE_SUPABASE_ANON_KEY</code>.
          </li>
          <li>
            In Supabase, open the <b>SQL editor</b> and run <code>supabase/migrations/0001_init.sql</code> once to create the tables.
          </li>
        </ol>
        <p className="hint">Restart the dev server after editing <code>.env</code>. These are all public keys — safe to ship to the browser.</p>
      </div>
    </div>
  );
}
