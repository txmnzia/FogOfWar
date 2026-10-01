import type { Map as MlMap, MapGeoJSONFeature } from "maplibre-gl";
import type { FogLayer } from "./FogLayer";

import castle from "../assets/poi/castle.png";
import church from "../assets/poi/church.png";
import monument from "../assets/poi/monument.png";
import obelisk from "../assets/poi/obelisk.png";
import ruins from "../assets/poi/ruins.png";
import lighthouse from "../assets/poi/lighthouse.png";
import village from "../assets/poi/village.png";
import hamlet from "../assets/poi/hamlet.png";
import house from "../assets/poi/house.png";
import house2 from "../assets/poi/house2.png";
import oak from "../assets/poi/oak.png";
import pines from "../assets/poi/pines.png";
import fir from "../assets/poi/fir.png";
import mountains from "../assets/poi/mountains.png";
import peak from "../assets/poi/peak.png";

// Hand-drawn engraving POIs as a DOM sprite overlay. They all turn on at one
// zoom and then stay a STABLE set: selection is on a fixed geographic grid (not
// screen space) so nothing pops in or out as you zoom, sizes are fixed per type
// (with a little per-icon variation for character), and elements persist across
// rebuilds via a keyed reconcile so only genuinely new icons fade in.

type IconName =
  | "castle" | "church" | "monument" | "obelisk" | "ruins" | "lighthouse"
  | "village" | "hamlet" | "house" | "house2" | "oak" | "pines" | "fir" | "mountains" | "peak";

const SRC_URL: Record<IconName, string> = {
  castle, church, monument, obelisk, ruins, lighthouse, village, hamlet, house, house2, oak, pines, fir, mountains, peak,
};

// Fixed on-screen height (px) per type — relative sizes (a range dwarfs a
// cottage); multiplied by a small per-icon variation.
const BASE_PX: Record<IconName, number> = {
  castle: 48, church: 48, monument: 42, obelisk: 40, ruins: 38, lighthouse: 46,
  village: 44, hamlet: 36, house: 30, house2: 30, oak: 40, pines: 44, fir: 38, mountains: 56, peak: 46,
};

const FLIPPABLE = new Set<IconName>(["house", "house2", "village", "hamlet", "oak", "pines", "fir", "mountains", "peak"]);

const Z_ON = 12;            // everything appears here and stays put
const MIN_ELE = 700;        // metres — excludes city hills (Montmartre ~130m)
const MAX_TOTAL = 60;       // overall clutter cap
// fixed geographic grids (degrees) → stable selection, zoom-independent
const LANDMARK_CELL = 0.03; // ~3km: one landmark per cell
const PEAK_CELL = 0.11;     // ~12km: one peak/range per cell
const FOREST_CELL = 0.07;   // ~7km: one grove per cell
const FOREST_MIN_DEG2 = 0.00035;

function rand(x: number, y: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const vary = (lng: number, lat: number) => 0.9 + rand(lng * 71, lat * 71) * 0.22; // 0.90–1.12

function landmarkIcon(f: MapGeoJSONFeature): IconName | null {
  const p = (f.properties ?? {}) as Record<string, unknown>;
  const cls = String(p.class ?? "");
  const sub = String(p.subclass ?? "");
  const s = sub || cls;
  if (["castle", "fort", "fortress", "city_gate", "citywalls", "bunker", "manor"].includes(s)) return "castle";
  if (cls === "place_of_worship" || ["church", "cathedral", "chapel", "monastery", "basilica"].includes(s)) return "church";
  if (["obelisk", "tower", "column", "campanile", "bell_tower", "chimney"].includes(s)) return "obelisk";
  if (s === "monument") return "monument";
  if (["ruins", "ruin", "archaeological_site"].includes(s)) return "ruins";
  if (["lighthouse", "beacon"].includes(s)) return "lighthouse";
  return null;
}

function settlement(cls: string, lng: number, lat: number): { icon: IconName; scale: number } | null {
  const r = rand(lng * 997, lat * 997);
  if (cls === "town") return { icon: "village", scale: 1.05 };
  if (cls === "village") return r < 0.6 ? { icon: "village", scale: 0.92 } : { icon: r < 0.8 ? "house" : "house2", scale: 1.12 };
  if (["hamlet", "isolated_dwelling", "suburb", "neighbourhood", "quarter"].includes(cls))
    return { icon: r < 0.5 ? "house" : "house2", scale: 0.95 };
  return null;
}

interface Pick { key: string; icon: IconName; lng: number; lat: number; rank: number; scale: number; flip: boolean; }
interface Item { el: HTMLDivElement; img: HTMLImageElement; icon: IconName; scale: number; flip: boolean; lng: number; lat: number; }

function geomBBox(g: GeoJSON.Geometry) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  const scan = (co: unknown): void => {
    if (typeof (co as number[])[0] === "number") {
      const [x, y] = co as number[];
      if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y;
    } else for (const k of co as unknown[]) scan(k);
  };
  try { scan((g as { coordinates: unknown }).coordinates); } catch { return null; }
  return a === Infinity ? null : { minLng: a, minLat: b, maxLng: c, maxLat: d };
}

export class PoiLayer {
  private map: MlMap;
  private fog: FogLayer | null;
  private root: HTMLDivElement;
  private items = new Map<string, Item>();
  private srcName: string | null = null;
  private moveRaf = 0;
  private rebuildTimer = 0;

  private onMove = () => {
    if (this.moveRaf) return;
    this.moveRaf = requestAnimationFrame(() => { this.moveRaf = 0; this.reposition(); });
  };
  private onSettle = () => this.rebuild();
  private onSourceData = () => {
    clearTimeout(this.rebuildTimer);
    this.rebuildTimer = window.setTimeout(() => this.rebuild(), 250);
  };

  constructor(map: MlMap, fog: FogLayer | null = null) {
    this.map = map;
    this.fog = fog;
    this.root = document.createElement("div");
    this.root.className = "mapicons";
    map.getCanvasContainer().appendChild(this.root);
    map.on("move", this.onMove);
    map.on("moveend", this.onSettle);
    map.on("zoomend", this.onSettle);
    map.on("sourcedata", this.onSourceData);
    this.rebuild();
  }

  refresh() { this.rebuild(); }

  destroy() {
    cancelAnimationFrame(this.moveRaf);
    clearTimeout(this.rebuildTimer);
    this.map.off("move", this.onMove);
    this.map.off("moveend", this.onSettle);
    this.map.off("zoomend", this.onSettle);
    this.map.off("sourcedata", this.onSourceData);
    this.root.remove();
    this.items.clear();
  }

  private vectorSource(): string | null {
    if (this.srcName) return this.srcName;
    const sources = this.map.getStyle()?.sources ?? {};
    this.srcName = Object.keys(sources).find(
      (k) => (sources as Record<string, { type?: string }>)[k]?.type === "vector",
    ) ?? null;
    return this.srcName;
  }

  private query(src: string, sourceLayer: string, filter?: unknown[]): MapGeoJSONFeature[] {
    try {
      const opts = (filter ? { sourceLayer, filter } : { sourceLayer }) as Parameters<MlMap["querySourceFeatures"]>[1];
      return this.map.querySourceFeatures(src, opts);
    } catch {
      return [];
    }
  }

  private revealed(lng: number, lat: number): boolean {
    return !this.fog || this.fog.isRevealed(lng, lat);
  }

  // one landmark per fixed geo cell (the most important), so the set is stable
  private gatherLandmarks(src: string): Pick[] {
    const best = new Map<string, Pick>();
    const consider = (icon: IconName, lng: number, lat: number, rank: number, scale: number) => {
      if (!this.revealed(lng, lat)) return;
      const k = `L${Math.floor(lng / LANDMARK_CELL)}_${Math.floor(lat / LANDMARK_CELL)}`;
      const prev = best.get(k);
      if (prev && prev.rank <= rank) return;
      best.set(k, { key: k, icon, lng, lat, rank, scale: scale * vary(lng, lat), flip: rand(lat * 13, lng * 13) > 0.5 });
    };
    for (const f of this.query(src, "poi")) {
      if (f.geometry?.type !== "Point") continue;
      const ic = landmarkIcon(f);
      if (!ic) continue;
      const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
      consider(ic, lng, lat, Number((f.properties as Record<string, unknown>)?.rank ?? 50), 1);
    }
    for (const f of this.query(src, "place")) {
      if (f.geometry?.type !== "Point") continue;
      const cls = String((f.properties as Record<string, unknown>)?.class ?? "");
      const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
      const s = settlement(cls, lng, lat);
      if (!s) continue;
      consider(s.icon, lng, lat, Number((f.properties as Record<string, unknown>)?.rank ?? 40) + 6, s.scale);
    }
    return [...best.values()];
  }

  // nature derived on fixed geo grids (stable): a range or peak per cell, and a
  // grove of 3–4 trees per wood cell.
  private gatherNature(src: string): Pick[] {
    const out: Pick[] = [];

    const groups = new Map<string, { n: number; top: { lng: number; lat: number; ele: number } }>();
    for (const f of this.query(src, "mountain_peak")) {
      if (f.geometry?.type !== "Point") continue;
      const pr = (f.properties ?? {}) as Record<string, unknown>;
      const cls = String(pr.class ?? "peak");
      if (cls !== "peak" && cls !== "volcano") continue;
      const ele = Number(pr.ele ?? 0);
      if (!Number.isFinite(ele) || ele < MIN_ELE) continue;
      const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
      if (!this.revealed(lng, lat)) continue;
      const k = `${Math.floor(lng / PEAK_CELL)}_${Math.floor(lat / PEAK_CELL)}`;
      const g = groups.get(k);
      if (g) { g.n++; if (ele > g.top.ele) g.top = { lng, lat, ele }; }
      else groups.set(k, { n: 1, top: { lng, lat, ele } });
    }
    for (const [k, g] of groups) {
      if (g.n >= 3) {
        const [gx, gy] = k.split("_").map(Number);
        const lng = (gx + 0.5) * PEAK_CELL, lat = (gy + 0.5) * PEAK_CELL;
        out.push({ key: `M${k}`, icon: "mountains", lng, lat, rank: 5, scale: vary(lng, lat), flip: rand(gx * 17, gy * 17) > 0.5 });
      } else {
        const { lng, lat } = g.top;
        out.push({ key: `P${k}`, icon: "peak", lng, lat, rank: 8, scale: vary(lng, lat), flip: rand(lat * 31, lng * 31) > 0.5 });
      }
    }

    const cells = new Map<string, { area: number; wood: boolean }>();
    const take = (feats: MapGeoJSONFeature[], wood: boolean) => {
      for (const f of feats) {
        if (!f.geometry) continue;
        const bb = geomBBox(f.geometry);
        if (!bb) continue;
        const area = (bb.maxLng - bb.minLng) * (bb.maxLat - bb.minLat);
        if (area < FOREST_MIN_DEG2) continue;
        const cx = (bb.minLng + bb.maxLng) / 2, cy = (bb.minLat + bb.maxLat) / 2;
        const k = `${Math.floor(cx / FOREST_CELL)}_${Math.floor(cy / FOREST_CELL)}`;
        const e = cells.get(k);
        if (!e || area > e.area) cells.set(k, { area, wood });
      }
    };
    take(this.query(src, "landcover", ["==", "class", "wood"]), true);
    take(this.query(src, "park"), false);
    for (const [k, c] of cells) {
      const [gx, gy] = k.split("_").map(Number);
      const cx = (gx + 0.5) * FOREST_CELL, cy = (gy + 0.5) * FOREST_CELL;
      if (!this.revealed(cx, cy)) continue;
      const n = rand(gx, gy) > 0.5 ? 4 : 3;
      for (let i = 0; i < n; i++) {
        const lng = cx + (rand(gx * 7 + i, gy * 3) - 0.5) * FOREST_CELL * 0.6;
        const lat = cy + (rand(gy * 7 + i * 5, gx * 3) - 0.5) * FOREST_CELL * 0.6;
        const r3 = rand(i + gx, gy - i);
        const icon: IconName = c.wood
          ? (r3 < 0.45 ? "pines" : r3 < 0.8 ? "fir" : "oak")
          : (r3 < 0.6 ? "oak" : r3 < 0.85 ? "fir" : "pines");
        out.push({ key: `F${k}:${i}`, icon, lng, lat, rank: 30, scale: vary(lng + i, lat), flip: rand(lat, lng) > 0.5 });
      }
    }
    return out;
  }

  private rebuild() {
    const src = this.vectorSource();
    if (!src) return;

    let picks: Pick[] = [];
    if (this.map.getZoom() >= Z_ON) {
      try {
        picks = this.gatherLandmarks(src).concat(this.gatherNature(src));
      } catch {
        picks = [];
      }
    }
    if (picks.length > MAX_TOTAL) {
      picks.sort((a, b) => a.rank - b.rank);
      picks = picks.slice(0, MAX_TOTAL);
    }

    const desired = new Map(picks.map((p) => [p.key, p]));
    for (const [k, it] of this.items) {
      if (!desired.has(k)) { it.el.remove(); this.items.delete(k); }
    }
    for (const [k, p] of desired) {
      const existing = this.items.get(k);
      if (existing) { existing.lng = p.lng; existing.lat = p.lat; existing.scale = p.scale; continue; }
      const el = document.createElement("div");
      el.className = "mapicon fade-in";
      const img = document.createElement("img");
      img.src = SRC_URL[p.icon];
      img.alt = "";
      img.decoding = "async";
      el.appendChild(img);
      this.root.appendChild(el);
      this.items.set(k, { el, img, icon: p.icon, scale: p.scale, flip: p.flip && FLIPPABLE.has(p.icon), lng: p.lng, lat: p.lat });
    }
    this.reposition();
  }

  private reposition() {
    const c = this.map.getCanvas();
    const W = c.clientWidth, H = c.clientHeight;
    for (const it of this.items.values()) {
      const pt = this.map.project([it.lng, it.lat]);
      if (pt.x < -60 || pt.x > W + 60 || pt.y < -90 || pt.y > H + 40) {
        it.el.style.display = "none";
        continue;
      }
      it.el.style.display = "";
      it.img.style.height = `${Math.round(clamp(BASE_PX[it.icon] * it.scale, 14, 90))}px`;
      it.el.style.zIndex = String(Math.round((90 - it.lat) * 40));
      it.el.style.transform = `translate(${pt.x}px, ${pt.y}px) translate(-50%, -100%)${it.flip ? " scaleX(-1)" : ""}`;
    }
  }
}
