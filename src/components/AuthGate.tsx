import { useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

export function AuthGate({ children }: { children: (session: Session) => ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return (
      <div className="center">
        <p className="hint">Lighting the lanterns…</p>
      </div>
    );
  }
  if (!session) return <Login />;
  return <>{children(session)}</>;
}

function Login() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase || !email) return;
    setState("sending");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) {
      setError(error.message);
      setState("error");
    } else {
      setState("sent");
    }
  }

  return (
    <div className="center">
      <div className="card">
        <p className="eyebrow">Fog of War</p>
        <h1>Enter the map</h1>
        <p>This is your private atlas. Sign in with your email and we'll send you a one-time magic link — no password to remember.</p>
        {state === "sent" ? (
          <div className="msg ok">Check <b>{email}</b> for a sign-in link. You can close this tab.</div>
        ) : (
          <form className="stack" onSubmit={send}>
            <input
              className="field"
              type="email"
              placeholder="you@example.com"
              value={email}
              autoComplete="email"
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            {state === "error" && <div className="msg err">{error}</div>}
            <button className="btn primary block" type="submit" disabled={state === "sending"}>
              {state === "sending" ? "Sending…" : "Send magic link"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
