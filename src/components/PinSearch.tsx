import { useEffect, useRef, useState } from "react";
import { env } from "../lib/env";

interface Feature {
  name: string;
  context: string;
  lng: number;
  lat: number;
}

export function PinSearch({ onPick }: { onPick: (p: { name: string; lng: number; lat: number }) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Feature[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<number>();

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    timer.current = window.setTimeout(async () => {
      setLoading(true);
      try {
        const url = `https://api.maptiler.com/geocoding/${encodeURIComponent(q)}.json?key=${env.maptilerKey}&limit=6&language=en`;
        const res = await fetch(url);
        const data = await res.json();
        const feats: Feature[] = (data.features ?? []).map((f: any) => ({
          name: f.text ?? f.place_name,
          context: (f.place_name ?? "").split(",").slice(1).join(",").trim(),
          lng: f.center[0],
          lat: f.center[1],
        }));
        setResults(feats);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => window.clearTimeout(timer.current);
  }, [q]);

  return (
    <div>
      <input
        className="field"
        placeholder="Search a city or place…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {loading && <p className="hint" style={{ marginTop: 8 }}>Searching…</p>}
      <div className="results">
        {results.map((f, i) => (
          <button
            key={i}
            className="result"
            onClick={() => {
              onPick({ name: f.name, lng: f.lng, lat: f.lat });
              setQ("");
              setResults([]);
            }}
          >
            {f.name}
            {f.context && <small>{f.context}</small>}
          </button>
        ))}
      </div>
    </div>
  );
}
