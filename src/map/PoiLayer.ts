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
import oak from "../assets/poi/oak.png";
import pines from "../assets/poi/pines.png";
import mountains from "../assets/poi/mountains.png";
import peak from "../assets/poi/peak.png";

// Hand-drawn engraving POIs as a DOM sprite overlay. Landmarks come from point
// features; nature icons are DERIVED from area data — a forest patch becomes a
// little cluster of trees of varying size, a mountain range a cluster of peaks,
// the way a hand-drawn map draws them. Icons are a FIXED size (they don't keep
// multiplying/growing as you zoom), base-anchored, decluttered, and fog-gated.

type IconName =
  | "castle" | "church" | "monument" | "obelisk" | "ruins" | "lighthouse"
  | "village" | "hamlet" | "oak" | "pines" | "mountains" | "peak";

const SRC_URL: Record<IconName, string> = {
  castle, church, monument, obelisk, ruins, lighthouse, village, hamlet, oak, pines, mountains, peak,
};

// Fixed on-screen height (CSS px) per icon — constant across zoom.
const BASE_H: Record<IconName, number> = {
  castle: 50, church: 50, monument: 44, obelisk: 42, ruins: 40, lighthouse: 48,
  village: 44, hamlet: 38, oak: 40, pines: 44, mountains: 60, peak: 42,
};

const LANDMARK_ZOOM = 12;   // landmarks turn on here and stay a stable set
const FOREST_ZOOM = 10;
const PEAK_RANGE_ZOOM = 7;  // show a single range symbol at regional zoom
const PEAK_DETAIL_ZOOM = 10; // resolve into individual peaks closer in
const MIN_ELE = 700;        // metres — excludes city hills (Montmartre ~130m)
const MAX_LANDMARKS = 34;
const MAX_NATURE = 90;

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

interface Pick { icon: IconName; lng: number; lat: number; rank: number; scale: number; }
interface Item { el: HTMLDivElement; img: HTMLImageElement; icon: IconName; scale: number; lng: number; lat: number; }

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
      const ic: IconName | null = cls === "hamlet" ? "hamlet" : cls === "village" || cls === "town" ? "village" : null;
      if (!ic) continue;
      const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
      if (!this.revealed(lng, lat)) continue;
      raw.push({ icon: ic, lng, lat, rank: Number((f.properties as Record<string, unknown>)?.rank ?? 40) + 6, scale: 1 });
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
      const h = BASE_H[p.icon];
      const box: Box = [pt.x - h * 0.45, pt.y - h, pt.x + h * 0.45, pt.y];
      if (placed.some((q) => overlaps(q, box, -18))) continue; // keep ~18px gap
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
      // regional view: one range symbol per cluster of several high peaks
      const cell = 170;
      const groups = new Map<string, { lng: number; lat: number; ele: number; n: number }>();
      for (const q of peaks) {
        const p = this.map.project([q.lng, q.lat]);
        const k = `${Math.round(p.x / cell)}_${Math.round(p.y / cell)}`;
        const g = groups.get(k);
        if (g) { g.lng += q.lng; g.lat += q.lat; g.ele = Math.max(g.ele, q.ele); g.n++; }
        else groups.set(k, { lng: q.lng, lat: q.lat, ele: q.ele, n: 1 });
      }
      for (const g of groups.values()) {
        if (g.n < 3) continue; // a real chain, not a lone bump
        out.push({ icon: "mountains", lng: g.lng / g.n, lat: g.lat / g.n, rank: 5, scale: clamp(0.9 + g.n / 10, 0.9, 1.5) });
      }
    } else {
      // closer in: individual peaks, sized by elevation, thinned by spacing
      const cell = 58;
      const best = new Map<string, { lng: number; lat: number; ele: number }>();
      for (const q of peaks) {
        const p = this.map.project([q.lng, q.lat]);
        const k = `${Math.round(p.x / cell)}_${Math.round(p.y / cell)}`;
        const e = best.get(k);
        if (!e || q.ele > e.ele) best.set(k, q);
      }
      for (const q of best.values()) {
        out.push({ icon: "peak", lng: q.lng, lat: q.lat, rank: 8, scale: clamp(0.7 + (q.ele - MIN_ELE) / 2500, 0.7, 1.6) });
      }
    }

    // Forest / park patches — a small cluster of trees of varying size.
    if (z >= FOREST_ZOOM) {
      const patches: { minLng: number; minLat: number; maxLng: number; maxLat: number; area: number; wood: boolean }[] = [];
      const take = (feats: MapGeoJSONFeature[], wood: boolean) => {
        for (const f of feats) {
          if (!f.geometry) continue;
          const bb = geomBBox(f.geometry);
          if (!bb) continue;
          const a = this.map.project([bb.maxLng, bb.minLat]);
          const b = this.map.project([bb.minLng, bb.maxLat]);
          const area = Math.abs((a.x - b.x) * (a.y - b.y));
          if (area < 3000) continue;
          patches.push({ ...bb, area, wood });
        }
      };
      take(this.query(src, "landcover", ["==", "class", "wood"]), true);
      take(this.query(src, "park"), false);
      // thin to one patch per big cell (keep the largest)
      const cell = 150;
      const best = new Map<string, (typeof patches)[number]>();
      for (const c of patches) {
        const cx = (c.minLng + c.maxLng) / 2, cy = (c.minLat + c.maxLat) / 2;
        const p = this.map.project([cx, cy]);
        const k = `${Math.round(p.x / cell)}_${Math.round(p.y / cell)}`;
        const e = best.get(k);
        if (!e || c.area > e.area) best.set(k, c);
      }
      for (const c of best.values()) {
        const cx = (c.minLng + c.maxLng) / 2, cy = (c.minLat + c.maxLat) / 2;
        if (!this.revealed(cx, cy)) continue;
        const n = clamp(Math.round(Math.sqrt(c.area) / 60), 2, 5); // 2–5 trees by size
        const spanLng = (c.maxLng - c.minLng) * 0.34, spanLat = (c.maxLat - c.minLat) * 0.34;
        for (let i = 0; i < n; i++) {
          const r1 = rand(cx * 1000 + i, cy * 1000);
          const r2 = rand(cy * 1000 + i * 7, cx * 1000);
          const lng = cx + (r1 - 0.5) * 2 * spanLng;
          const lat = cy + (r2 - 0.5) * 2 * spanLat;
          const r3 = rand(i + cx, cy - i);
          const icon: IconName = c.wood ? (r3 > 0.82 ? "oak" : "pines") : (r3 > 0.3 ? "oak" : "pines");
          out.push({ icon, lng, lat, rank: 30, scale: 0.72 + rand(lng, lat) * 0.6 }); // 0.72–1.32
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
      this.items.push({ el, img, icon: p.icon, scale: p.scale, lng: p.lng, lat: p.lat });
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
      it.img.style.height = `${Math.round(BASE_H[it.icon] * it.scale)}px`;
      it.el.style.zIndex = String(Math.round((90 - it.lat) * 40));
      it.el.style.transform = `translate(${pt.x}px, ${pt.y}px) translate(-50%, -100%)`;
    }
  }
}
