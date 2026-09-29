import { useEffect, useState } from "react";
import type { Map as MlMap } from "maplibre-gl";
import type { FogLayer } from "../map/FogLayer";
import { SETTINGS_BOUNDS, type FogSettings } from "../lib/constants";

type Tuning = ReturnType<FogLayer["getTuning"]>;
const TUNE_KEY = "fow.tuning";

const TBOUNDS: Record<keyof Tuning, { min: number; max: number; step: number; label: string }> = {
  discR: { min: 0.9, max: 1.7, step: 0.01, label: "Disc overlap" },
  coreEdge: { min: 0.3, max: 1.3, step: 0.02, label: "Edge softness (core)" },
  markSurvive: { min: 1, max: 2.6, step: 0.05, label: "Min-mark blur survival" },
  closeScale: { min: 0, max: 2, step: 0.05, label: "Hole closing" },
  haloAlpha: { min: 0, max: 0.8, step: 0.02, label: "Halo glow" },
};

/** Load persisted advanced tuning (applied to the FogLayer on startup). */
export function loadTuning(): Partial<Tuning> {
  try {
    return JSON.parse(localStorage.getItem(TUNE_KEY) || "{}");
  } catch {
    return {};
  }
}
function saveTuning(t: Tuning) {
  try {
    localStorage.setItem(TUNE_KEY, JSON.stringify(t));
  } catch {
    /* ignore */
  }
}

interface Props {
  settings: FogSettings;
  onSettings: (s: FogSettings) => void;
  fog: FogLayer | null;
  map: MlMap | null;
  onClose: () => void;
}

export function FogLab({ settings, onSettings, fog, map, onClose }: Props) {
  const [tuning, setTuning] = useState<Tuning>(() =>
    fog ? fog.getTuning() : { discR: 1.25, coreEdge: 0.7, markSurvive: 1.3, closeScale: 1, haloAlpha: 0.35 },
  );
  const [zoom, setZoom] = useState(map?.getZoom() ?? 0);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    if (!map) return;
    const on = () => setZoom(map.getZoom());
    map.on("zoom", on);
    map.on("moveend", on);
    on();
    return () => {
      map.off("zoom", on);
      map.off("moveend", on);
    };
  }, [map]);

  function changeT(k: keyof Tuning, v: number) {
    const next = { ...tuning, [k]: v };
    setTuning(next);
    fog?.setTuning(next);
    saveTuning(next);
  }

  function copy() {
    const t = tuning;
    const txt =
      `// Fog values @ zoom ${zoom.toFixed(1)}\n` +
      `DEFAULT_SETTINGS.generosity = ${settings.generosity.toFixed(2)}\n` +
      `DEFAULT_SETTINGS.fade = ${settings.fade.toFixed(2)}\n` +
      `DEFAULT_SETTINGS.darkness = ${settings.darkness.toFixed(2)}\n` +
      `DISC_R = ${t.discR.toFixed(2)}\n` +
      `CORE_BLUR_EDGE = ${t.coreEdge.toFixed(2)}\n` +
      `min-mark survival = ${t.markSurvive.toFixed(2)}\n` +
      `closing scale = ${t.closeScale.toFixed(2)}\n` +
      `HALO_ALPHA = ${t.haloAlpha.toFixed(2)}`;
    navigator.clipboard?.writeText(txt).then(
      () => setCopied("Copied — paste it to me."),
      () => setCopied("Couldn't copy — screenshot the values."),
    );
  }

  return (
    <aside className="foglab">
      <div className="panel-head">
        <h2>Fog Lab</h2>
        <button className="close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <p className="hint">
        Live on your real map — pan and zoom, tune, and note if a value should differ by zoom.{" "}
        <b>Zoom {zoom.toFixed(1)}</b>
      </p>

      <Slider label="Low-zoom coverage" v={settings.generosity} bounds={SETTINGS_BOUNDS.generosity} pct onChange={(v) => onSettings({ ...settings, generosity: v })} />
      <Slider label="Halo fade" v={settings.fade} bounds={SETTINGS_BOUNDS.fade} pct onChange={(v) => onSettings({ ...settings, fade: v })} />
      <Slider label="Cloud density" v={settings.darkness} bounds={SETTINGS_BOUNDS.darkness} pct onChange={(v) => onSettings({ ...settings, darkness: v })} />

      {(Object.keys(TBOUNDS) as (keyof Tuning)[]).map((k) => (
        <Slider key={k} label={TBOUNDS[k].label} v={tuning[k]} bounds={TBOUNDS[k]} onChange={(v) => changeT(k, v)} />
      ))}

      <button className="btn ghost block" style={{ marginTop: 12 }} onClick={copy}>
        Copy values
      </button>
      {copied && <p className="hint" style={{ marginTop: 8 }}>{copied}</p>}
    </aside>
  );
}

function Slider({
  label,
  v,
  bounds,
  onChange,
  pct,
}: {
  label: string;
  v: number;
  bounds: { min: number; max: number; step: number };
  onChange: (v: number) => void;
  pct?: boolean;
}) {
  return (
    <div className="slider">
      <label>
        {label} <b>{pct ? Math.round(v * 100) : v.toFixed(2)}</b>
      </label>
      <input
        type="range"
        min={bounds.min}
        max={bounds.max}
        step={bounds.step}
        value={v}
        onChange={(e) => onChange(+e.target.value)}
      />
    </div>
  );
}
