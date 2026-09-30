// Fog Lab nudges: additive offsets on the zoom-driven fog curves (0 = pure
// formula). Stored per-device in localStorage; no DB column needed.
export interface FogTuning {
  generosity: number;
  fade: number;
  discR: number;
  coreEdge: number;
  markSurvive: number;
  closeScale: number;
  haloAlpha: number;
}

export const DEFAULT_TUNING: FogTuning = {
  generosity: 0,
  fade: 0,
  discR: 0,
  coreEdge: 0,
  markSurvive: 0,
  closeScale: 0,
  haloAlpha: 0,
};

// v2: the older key stored absolute values; ignore it now that these are offsets.
const KEY = "fow.tuning.v2";

export function loadTuning(): FogTuning {
  try {
    const j = JSON.parse(localStorage.getItem(KEY) || "{}");
    return { ...DEFAULT_TUNING, ...j };
  } catch {
    return { ...DEFAULT_TUNING };
  }
}

export function saveTuning(t: FogTuning) {
  try {
    localStorage.setItem(KEY, JSON.stringify(t));
  } catch {
    /* ignore */
  }
}

/** Slider definitions for the Fog Lab, in display order. */
export const FOG_NUDGES: { key: keyof FogTuning; label: string; min: number; max: number; step: number }[] = [
  { key: "generosity", label: "Low-zoom coverage", min: -1, max: 1, step: 0.02 },
  { key: "discR", label: "Disc overlap", min: -0.3, max: 0.3, step: 0.01 },
  { key: "coreEdge", label: "Edge softness", min: -0.4, max: 0.4, step: 0.02 },
  { key: "markSurvive", label: "Min-mark size", min: -1, max: 1, step: 0.05 },
  { key: "closeScale", label: "Hole closing", min: -1, max: 1, step: 0.05 },
  { key: "haloAlpha", label: "Halo glow", min: -0.3, max: 0.3, step: 0.02 },
  { key: "fade", label: "Halo fade", min: -0.4, max: 0.4, step: 0.02 },
];
