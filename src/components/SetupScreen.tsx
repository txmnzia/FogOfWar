export function SetupScreen() {
  return (
    <div className="center">
      <div className="card">
        <p className="eyebrow">Fog of War · setup</p>
        <h1>Almost ready</h1>
        <p>
          The map (OpenFreeMap) and place search (Nominatim) are keyless — nothing to set up
          there. Only your <b>sync + login</b> backend needs configuring. Create a{" "}
          <code>.env</code> file (copy <code>.env.example</code>) and fill in these two values:
        </p>
        <ol>
          <li>
            <b>Supabase project</b> — create one at{" "}
            <a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">supabase.com</a>,
            then Settings → API. Put the Project URL in <code>VITE_SUPABASE_URL</code> and the{" "}
            <code>anon public</code> key in <code>VITE_SUPABASE_ANON_KEY</code>.
          </li>
          <li>
            In Supabase, open the <b>SQL editor</b> and run{" "}
            <code>supabase/migrations/0001_init.sql</code> once to create the tables.
          </li>
        </ol>
        <p className="hint">
          Restart the dev server after editing <code>.env</code>. Both values are public client
          keys — safe to ship to the browser and to commit configuration around.
        </p>
      </div>
    </div>
  );
}
