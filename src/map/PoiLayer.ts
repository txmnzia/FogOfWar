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

// Hand-drawn engraving POIs as a DOM sprite overlay. Landmarks come from point
// features; nature icons are DERIVED from area data — a forest patch becomes a
// little cluster of trees of varying size, a mountain range a cluster of peaks,
// the way a hand-drawn map draws them. Icons are a FIXED size (they don't keep
// multiplying/growing as you zoom), base-anchored, decluttered, and fog-gated.

type IconName =
  | "castle" | "church" | "monument" | "obelisk" | "ruins" | "lighthouse"
  | "village" | "hamlet" | "house" | "house2" | "oak" | "pines" | "fir" | "mountains" | "peak";

const SRC_URL: Record<IconName, string> = {
  castle, church, monument, obelisk, ruins, lighthouse, village, hamlet, house, house2, oak, pines, fir, mountains, peak,
};

// Real-world footprint (metres of latitude) each icon stands for. Icons are
// drawn at this size projected to the screen, so they're PINNED to the map:
// they grow/shrink with zoom like they're painted on the terrain, and a
// mountain range reads far bigger than a cottage. Clamped so they never vanish
// or fill the screen. (mountains tuned to ~25px at zoom 7.7 over the Alps.)
const BASE_M: Record<IconName, number> = {
  castle: 320, church: 340, monument: 300, obelisk: 300, ruins: 260, lighthouse: 320,
  village: 380, hamlet: 300, house: 210, house2: 210, oak: 1300, pines: 1400, fir: 1200, mountains: 5800, peak: 1200,
};
const MIN_PX = 12;
const MAX_PX = 110;

// Icons that may be mirrored for variety (landmarks stay as drawn so they read
// clearly; organic things and generic houses can flip without looking wrong).
const FLIPPABLE = new Set<IconName>(["house", "house2", "village", "hamlet", "oak", "pines", "fir", "mountains", "peak"]);

const LANDMARK_ZOOM = 12;   // landmarks turn on here and stay a stable set
const FOREST_ZOOM = 10;
const PEAK_RANGE_ZOOM = 7;  // show a single range symbol at regional zoom
const PEAK_DETAIL_ZOOM = 10; // resolve into individual peaks closer in
const MIN_ELE = 700;        // metres — excludes city hills (Montmartre ~130m)
const MAX_LANDMARKS = 34;
const MAX_NATURE = 90;
// Clustering uses FIXED geographic grids (degrees), not screen cells, so the
// derived mountain-range and forest icons keep a stable position on the map as
// you zoom and pan — they don't jump around.
const RANGE_CELL = 0.42;    // ~45km: groups peaks into a named range
const PEAK_CELL = 0.025;    // ~2.5km: spacing between individual peaks
const FOREST_CELL = 0.03;   // ~3km: one wood cluster per cell
const FOREST_MIN_DEG2 = 0.00035; // ~geographic area to count as a real wood

// deterministic pseudo-random in [0,1) from two numbers, so derived clusters
// don't flicker or jump between rebuilds.
function rand(x: number, y: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function landmarkIcon(f: MapGeoJSONFeature): IconName | null {
  const p = (f.properties ?? {}) as Record<string, unknown>;
  const cls = String(p.class ?? "");
  const sub = String(p.subclass ?? "");
  const s = sub || cls;
  if (["castle", "fort", "fortress", "city_gate", "citywalls", "bunker", "manor"].includes(s)) return "castle";
  if (cls === "place_of_worship" || ["church", "cathedral", "chapel", "monastery", "basilica"].includes(s)) return "church";
  // Obelisk icon ONLY for genuinely column/tower-shaped things — not the flood
  // of memorials/statues/artworks that used to all become obelisks.
  if (["obelisk", "tower", "column", "campanile", "bell_tower", "chimney"].includes(s)) return "obelisk";
  if (s === "monument") return "monument";
  if (["ruins", "ruin", "archaeological_site"].includes(s)) return "ruins";
  if (["lighthouse", "beacon"].includes(s)) return "lighthouse";
  return null;
}

interface Pick { icon: IconName; lng: number; lat: number; rank: number; scale: number; flip?: boolean; }
interface Item { el: HTMLDivElement; img: HTMLImageElement; icon: IconName; scale: number; flip: boolean; lng: number; lat: number; }

// Pick a settlement sprite with variety: towns get the full cluster, villages
// usually a cluster but sometimes a lone house, hamlets a single cottage.
function settlement(cls: string, lng: number, lat: number): { icon: IconName; scale: number } | null {
  const r = rand(lng * 997, lat * 997);
  if (cls === "town") return { icon: "village", scale: 1.05 };
  if (cls === "village") return r < 0.6 ? { icon: "village", scale: 0.92 } : { icon: r < 0.8 ? "house" : "house2", scale: 1.15 };
  if (["hamlet", "isolated_dwelling", "suburb", "neighbourhood", "quarter"].includes(cls))
    return { icon: r < 0.5 ? "house" : "house2", scale: 0.95 };
  return null;
}

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

type Box = [number, number, number, number];
function overlaps(a: Box, b: Box, m: number): boolean {
  return !(a[2] - m <= b[0] || b[2] - m <= a[0] || a[3] - m <= b[1] || b[3] - m <= a[1]);
}

export class PoiLayer {
  private map: MlMap;
  private fog: FogLayer | null;
  private root: HTMLDivElement;
  private items: Item[] = [];
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

  // Pixel height for a given real-world height (metres) at a location — this is
  // what pins icon size to the map so it scales with zoom.
  private pxForMeters(lng: number, lat: number, m: number): number {
    const p1 = this.map.project([lng, lat]);
    const p2 = this.map.project([lng, lat + m / 111320]);
    return Math.abs(p1.y - p2.y);
  }
  private iconPx(icon: IconName, lng: number, lat: number, scale: number): number {
    return clamp(this.pxForMeters(lng, lat, BASE_M[icon] * scale), MIN_PX, MAX_PX);
  }

  // ---- landmarks: point features, decluttered, capped & stable ----
  private gatherLandmarks(src: string): Pick[] {
    const raw: Pick[] = [];
    for (const f of this.query(src, "poi")) {
      if (f.geometry?.type !== "Point") continue;
      const ic = landmarkIcon(f);
      if (!ic) continue;
      const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
      if (!this.revealed(lng, lat)) continue;
      raw.push({ icon: ic, lng, lat, rank: Number((f.properties as Record<string, unknown>)?.rank ?? 50), scale: 1 });
    }
    for (const f of this.query(src, "place")) {
      if (f.geometry?.type !== "Point") continue;
      const cls = String((f.properties as Record<string, unknown>)?.class ?? "");
      const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
      const s = settlement(cls, lng, lat);
      if (!s) continue;
      if (!this.revealed(lng, lat)) continue;
      raw.push({ icon: s.icon, lng, lat, rank: Number((f.properties as Record<string, unknown>)?.rank ?? 40) + 6, scale: s.scale, flip: rand(lat * 13, lng * 13) > 0.5 });
    }
    // de-duplicate, then declutter by importance
    const seen = new Set<string>();
    const uniq = raw.filter((p) => {
      const k = `${p.icon}@${p.lng.toFixed(3)},${p.lat.toFixed(3)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    uniq.sort((a, b) => a.rank - b.rank);
    const placed: Box[] = [];
    const out: Pick[] = [];
    for (const p of uniq) {
      if (out.length >= MAX_LANDMARKS) break;
      const pt = this.map.project([p.lng, p.lat]);
      const h = this.iconPx(p.icon, p.lng, p.lat, p.scale);
      const box: Box = [pt.x - h * 0.45, pt.y - h, pt.x + h * 0.45, pt.y];
      if (placed.some((q) => overlaps(q, box, -14))) continue; // keep a small gap
      placed.push(box);
      out.push(p);
    }
    return out;
  }

  // ---- nature: derived clusters (option B), drawn like a hand-map ----
  private gatherNature(src: string, z: number): Pick[] {
    const out: Pick[] = [];

    // Peaks — only genuine high summits, so flat cities show none.
    const peaks: { lng: number; lat: number; ele: number }[] = [];
    if (z >= PEAK_RANGE_ZOOM) {
      for (const f of this.query(src, "mountain_peak")) {
        if (f.geometry?.type !== "Point") continue;
        const pr = (f.properties ?? {}) as Record<string, unknown>;
        const cls = String(pr.class ?? "peak");
        if (cls !== "peak" && cls !== "volcano") continue;
        const ele = Number(pr.ele ?? 0);
        if (!Number.isFinite(ele) || ele < MIN_ELE) continue;
        const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
        if (!this.revealed(lng, lat)) continue;
        peaks.push({ lng, lat, ele });
      }
    }
    if (z < PEAK_DETAIL_ZOOM) {
      // regional view: one range symbol per FIXED geo cell holding several high
      // peaks — placed at the cell centre so it never jumps when you zoom/pan.
      const groups = new Map<string, { n: number; ele: number }>();
      for (const q of peaks) {
        const k = `${Math.floor(q.lng / RANGE_CELL)}_${Math.floor(q.lat / RANGE_CELL)}`;
        const g = groups.get(k);
        if (g) { g.n++; g.ele = Math.max(g.ele, q.ele); } else groups.set(k, { n: 1, ele: q.ele });
      }
      for (const [k, g] of groups) {
        if (g.n < 3) continue; // a real chain, not a lone bump
        const [gx, gy] = k.split("_").map(Number);
        const lng = (gx + 0.5) * RANGE_CELL, lat = (gy + 0.5) * RANGE_CELL;
        if (!this.revealed(lng, lat)) continue;
        out.push({ icon: "mountains", lng, lat, rank: 5, scale: clamp(0.85 + g.n / 26, 0.85, 1.2), flip: rand(gx * 17, gy * 17) > 0.5 });
      }
    } else {
      // closer in: individual peaks on a fixed geo grid, highest per cell, by ele
      const best = new Map<string, { lng: number; lat: number; ele: number }>();
      for (const q of peaks) {
        const k = `${Math.floor(q.lng / PEAK_CELL)}_${Math.floor(q.lat / PEAK_CELL)}`;
        const e = best.get(k);
        if (!e || q.ele > e.ele) best.set(k, q);
      }
      for (const q of best.values()) {
        out.push({ icon: "peak", lng: q.lng, lat: q.lat, rank: 8, scale: clamp(0.7 + (q.ele - MIN_ELE) / 2500, 0.7, 1.6), flip: rand(q.lat * 31, q.lng * 31) > 0.5 });
      }
    }

    // Forest / park patches → a stable grove of 3–4 trees per fixed geo cell.
    if (z >= FOREST_ZOOM) {
      const cells = new Map<string, { area: number; wood: boolean }>();
      const take = (feats: MapGeoJSONFeature[], wood: boolean) => {
        for (const f of feats) {
          if (!f.geometry) continue;
          const bb = geomBBox(f.geometry);
          if (!bb) continue;
          const area = (bb.maxLng - bb.minLng) * (bb.maxLat - bb.minLat); // deg² — zoom-independent
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
        const n = rand(gx, gy) > 0.5 ? 4 : 3; // a little grove of 3–4
        for (let i = 0; i < n; i++) {
          const r1 = rand(gx * 7 + i, gy * 3), r2 = rand(gy * 7 + i * 5, gx * 3);
          const lng = cx + (r1 - 0.5) * FOREST_CELL * 0.7;
          const lat = cy + (r2 - 0.5) * FOREST_CELL * 0.7;
          const r3 = rand(i + gx, gy - i);
          // mix clumps, lone firs and oaks so a wood isn't one repeated stamp
          const icon: IconName = c.wood
            ? (r3 < 0.45 ? "pines" : r3 < 0.8 ? "fir" : "oak")
            : (r3 < 0.6 ? "oak" : r3 < 0.85 ? "fir" : "pines");
          out.push({ icon, lng, lat, rank: 30, scale: 0.78 + rand(lng, lat) * 0.5, flip: rand(lat, lng) > 0.5 });
        }
      }
    }
    return out.slice(0, MAX_NATURE);
  }

  private rebuild() {
    const src = this.vectorSource();
    if (!src) return;
    const z = this.map.getZoom();

    let picks: Pick[] = [];
    try {
      if (z >= LANDMARK_ZOOM) picks = picks.concat(this.gatherLandmarks(src));
      picks = picks.concat(this.gatherNature(src, z));
    } catch {
      return;
    }

    // south-most drawn last so lower icons overlap in front
    picks.sort((a, b) => b.lat - a.lat);

    this.root.textContent = "";
    this.items = [];
    for (const p of picks) {
      const el = document.createElement("div");
      el.className = "mapicon";
      const img = document.createElement("img");
      img.src = SRC_URL[p.icon];
      img.alt = "";
      img.decoding = "async";
      el.appendChild(img);
      this.root.appendChild(el);
      this.items.push({ el, img, icon: p.icon, scale: p.scale, flip: !!p.flip && FLIPPABLE.has(p.icon), lng: p.lng, lat: p.lat });
    }
    this.reposition();
  }

  private reposition() {
    const c = this.map.getCanvas();
    const W = c.clientWidth, H = c.clientHeight;
    for (const it of this.items) {
      const pt = this.map.project([it.lng, it.lat]);
      if (pt.x < -60 || pt.x > W + 60 || pt.y < -90 || pt.y > H + 40) {
        it.el.style.display = "none";
        continue;
      }
      it.el.style.display = "";
      it.img.style.height = `${Math.round(this.iconPx(it.icon, it.lng, it.lat, it.scale))}px`;
      it.el.style.zIndex = String(Math.round((90 - it.lat) * 40));
      it.el.style.transform = `translate(${pt.x}px, ${pt.y}px) translate(-50%, -100%)${it.flip ? " scaleX(-1)" : ""}`;
    }
  }
}
