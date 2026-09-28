import { useEffect, useRef, useState } from "react";

interface Feature {
  name: string;
  context: string;
  lng: number;
  lat: number;
}

// Keyless place search via OpenStreetMap's Nominatim. Fair-use policy: low
// volume, one request at a time — fine for a personal app. We debounce and only
// fire on ≥3 characters to stay well within it.
export function PinSearch({ onPick }: { onPick: (p: { name: string; lng: number; lat: number }) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Feature[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<number>();

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (q.trim().length < 3) {
      setResults([]);
      return;
    }
    timer.current = window.setTimeout(async () => {
      setLoading(true);
      try {
        const url =
          `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&addressdetails=1` +
          `&q=${encodeURIComponent(q)}`;
        const res = await fetch(url, { headers: { "Accept-Language": navigator.language || "en" } });
        const data = await res.json();
        const feats: Feature[] = (Array.isArray(data) ? data : []).map((f: any) => {
          const full: string = f.display_name ?? "";
          const parts = full.split(",").map((s: string) => s.trim());
          return {
            name: f.name || parts[0] || full,
            context: parts.slice(1).join(", "),
            lat: parseFloat(f.lat),
            lng: parseFloat(f.lon),
          };
        });
        setResults(feats);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 500);
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
