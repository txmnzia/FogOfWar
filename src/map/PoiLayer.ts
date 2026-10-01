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

// Hand-drawn engraving POIs rendered as a DOM sprite overlay, the same way
// LabelLayer draws names: query the vector source, project each feature every
// frame, and show only what's explored. Landmarks come straight from point
// features; nature icons are DERIVED from area data (option B) — forest patches
// become a tree at their centre, clustered peaks become a mountain range.

type IconName =
  | "castle" | "church" | "monument" | "obelisk" | "ruins" | "lighthouse"
  | "village" | "hamlet" | "oak" | "pines" | "mountains" | "peak";

const SRC_URL: Record<IconName, string> = {
  castle, church, monument, obelisk, ruins, lighthouse, village, hamlet, oak, pines, mountains, peak,
};

const LANDMARK_ZOOM = 11; // OSM only carries most POIs this close in
const FOREST_ZOOM = 9;
const PEAK_ZOOM = 7;
const MAX_ICONS = 42;

// Icon height in CSS px grows with zoom but stays within sane bounds.
function iconHeight(z: number): number {
  return Math.max(18, Math.min(58, Math.round((z - 10) * 7 + 14)));
}

function landmarkIcon(f: MapGeoJSONFeature): IconName | null {
  const p = (f.properties ?? {}) as Record<string, unknown>;
  const cls = String(p.class ?? "");
  const sub = String(p.subclass ?? "");
  const s = sub || cls;
  if (["castle", "fort", "fortress", "city_gate", "citywalls", "bunker", "manor"].includes(s)) return "castle";
  if (cls === "place_of_worship" || ["church", "cathedral", "chapel", "monastery", "basilica", "shrine", "place_of_worship"].includes(s)) return "church";
  if (s === "obelisk") return "obelisk";
  if (["monument", "memorial", "column", "statue", "artwork"].includes(s)) return "monument";
  if (["ruins", "ruin", "archaeological_site"].includes(s)) return "ruins";
  if (["lighthouse", "beacon"].includes(s)) return "lighthouse";
  return null;
}

interface Pick { icon: IconName; lng: number; lat: number; rank: number; }
interface Item { el: HTMLDivElement; img: HTMLImageElement; lng: number; lat: number; }

function geomBBox(g: GeoJSON.Geometry): { minLng: number; minLat: number; maxLng: number; maxLat: number } | null {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  const scan = (co: unknown): void => {
    if (typeof (co as number[])[0] === "number") {
      const [x, y] = co as number[];
      if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y;
    } else for (const k of co as unknown[]) scan(k);
  };
  try { scan((g as { coordinates: unknown }).coordinates); } catch { return null; }
  if (a === Infinity) return null;
  return { minLng: a, minLat: b, maxLng: c, maxLat: d };
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

  private gatherNature(src: string, z: number, picks: Pick[]) {
    // Peaks → cluster nearby summits into a range, else a lone peak.
    if (z >= PEAK_ZOOM) {
      const cell = 80;
      const cells = new Map<string, { lng: number; lat: number; n: number }>();
      for (const f of this.query(src, "mountain_peak")) {
        if (f.geometry?.type !== "Point") continue;
        const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
        const p = this.map.project([lng, lat]);
        const k = `${Math.round(p.x / cell)}_${Math.round(p.y / cell)}`;
        const c = cells.get(k);
        if (c) { c.lng += lng; c.lat += lat; c.n++; } else cells.set(k, { lng, lat, n: 1 });
      }
      for (const c of cells.values()) {
        picks.push({ icon: c.n >= 2 ? "mountains" : "peak", lng: c.lng / c.n, lat: c.lat / c.n, rank: 20 - c.n });
      }
    }
    // Forest/park patches → a tree at the patch centre, thinned to one per cell.
    if (z >= FOREST_ZOOM) {
      const cand: { lng: number; lat: number; area: number; icon: IconName }[] = [];
      const take = (feats: MapGeoJSONFeature[], icon: IconName) => {
        for (const f of feats) {
          if (!f.geometry) continue;
          const bb = geomBBox(f.geometry);
          if (!bb) continue;
          const a = this.map.project([bb.maxLng, bb.minLat]);
          const b = this.map.project([bb.minLng, bb.maxLat]);
          const area = Math.abs((a.x - b.x) * (a.y - b.y));
          if (area < 1600) continue; // skip tile-edge slivers (~40x40px)
          cand.push({ lng: (bb.minLng + bb.maxLng) / 2, lat: (bb.minLat + bb.maxLat) / 2, area, icon });
        }
      };
      take(this.query(src, "landcover", ["==", "class", "wood"]), "pines");
      take(this.query(src, "park"), "oak");
      const cell = 120;
      const best = new Map<string, { lng: number; lat: number; area: number; icon: IconName }>();
      for (const c of cand) {
        const p = this.map.project([c.lng, c.lat]);
        const k = `${Math.round(p.x / cell)}_${Math.round(p.y / cell)}`;
        const e = best.get(k);
        if (!e || c.area > e.area) best.set(k, c);
      }
      for (const c of best.values()) picks.push({ icon: c.icon, lng: c.lng, lat: c.lat, rank: 30 });
    }
  }

  private rebuild() {
    const src = this.vectorSource();
    if (!src) return;
    const z = this.map.getZoom();
    const picks: Pick[] = [];

    if (z >= LANDMARK_ZOOM) {
      for (const f of this.query(src, "poi")) {
        if (f.geometry?.type !== "Point") continue;
        const ic = landmarkIcon(f);
        if (!ic) continue;
        const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
        picks.push({ icon: ic, lng, lat, rank: Number((f.properties as Record<string, unknown>)?.rank ?? 50) });
      }
      for (const f of this.query(src, "place")) {
        if (f.geometry?.type !== "Point") continue;
        const cls = String((f.properties as Record<string, unknown>)?.class ?? "");
        const ic: IconName | null = cls === "hamlet" ? "hamlet" : cls === "village" || cls === "town" ? "village" : null;
        if (!ic) continue;
        const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
        picks.push({ icon: ic, lng, lat, rank: Number((f.properties as Record<string, unknown>)?.rank ?? 40) + 6 });
      }
    }
    this.gatherNature(src, z, picks);

    // fog-gate + de-duplicate
    const seen = new Set<string>();
    const uniq: Pick[] = [];
    for (const p of picks) {
      if (this.fog && !this.fog.isRevealed(p.lng, p.lat)) continue;
      const k = `${p.icon}@${p.lng.toFixed(3)},${p.lat.toFixed(3)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      uniq.push(p);
    }
    uniq.sort((a, b) => a.rank - b.rank);

    // declutter: greedily keep the highest-ranked icon that doesn't collide
    const h = iconHeight(z);
    const placed: Box[] = [];
    const chosen: Pick[] = [];
    for (const p of uniq) {
      if (chosen.length >= MAX_ICONS) break;
      const pt = this.map.project([p.lng, p.lat]);
      const w = h * 0.95;
      const box: Box = [pt.x - w / 2, pt.y - h, pt.x + w / 2, pt.y];
      if (placed.some((q) => overlaps(q, box, h * 0.28))) continue;
      placed.push(box);
      chosen.push(p);
    }

    // draw north→south so southern (lower) icons overlap in front
    chosen.sort((a, b) => b.lat - a.lat);

    this.root.textContent = "";
    this.items = [];
    for (const p of chosen) {
      const el = document.createElement("div");
      el.className = "mapicon";
      const img = document.createElement("img");
      img.src = SRC_URL[p.icon];
      img.alt = "";
      img.decoding = "async";
      el.appendChild(img);
      this.root.appendChild(el);
      this.items.push({ el, img, lng: p.lng, lat: p.lat });
    }
    this.reposition();
  }

  private reposition() {
    const c = this.map.getCanvas();
    const W = c.clientWidth, H = c.clientHeight;
    const h = iconHeight(this.map.getZoom());
    for (const it of this.items) {
      const pt = this.map.project([it.lng, it.lat]);
      if (pt.x < -60 || pt.x > W + 60 || pt.y < -80 || pt.y > H + 40) {
        it.el.style.display = "none";
        continue;
      }
      it.el.style.display = "";
      it.img.style.height = `${h}px`;
      it.el.style.zIndex = String(Math.round((90 - it.lat) * 40));
      it.el.style.transform = `translate(${pt.x}px, ${pt.y}px) translate(-50%, -100%)`;
    }
  }
}
