import type { Map as MlMap, MapGeoJSONFeature } from "maplibre-gl";
import type { FogLayer } from "./FogLayer";
import { crestSvg } from "../lib/crest";
import type { Cell, Pin } from "../lib/types";
import { discoveredCountries, loadCountries, type Country } from "../lib/countries";

// A styled label overlay. MapLibre's native labels need pre-baked glyph fonts, so
// they can't use a web font like Cinzel. Instead we read the place + water names
// from the vector source and render them ourselves as DOM elements in the medieval
// faces, positioned each frame with map.project(). The overlay lives BELOW the fog
// canvas, so names are hidden under the clouds and revealed only where explored —
// consistent with the rest of the map.

const MAX_LABELS = 44;

type Kind = "country" | "region" | "city" | "town" | "water";

function kindFor(cls: string): Kind | null {
  switch (cls) {
    case "country":
      return "country";
    case "state":
    case "province":
    case "region":
      return "region";
    case "city":
      return "city";
    case "town":
    case "village":
    case "hamlet":
    case "suburb":
      return "town";
    default:
      return null;
  }
}

// Label size grows with zoom so a country name isn't huge at world view. Values
// are px; each kind only renders within its own zoom window (see visibleAt).
function sizeFor(kind: Kind, z: number): number {
  const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
  switch (kind) {
    case "country":
      return clamp(8.5 + (z - 2) * 2.2, 8.5, 18);
    case "region":
      return clamp(9 + (z - 3.5) * 1.5, 9, 14);
    case "city":
      return clamp(12 + (z - 5) * 0.7, 12, 16);
    case "town":
      return clamp(10 + (z - 8.5) * 0.6, 10, 13);
    case "water":
      return clamp(10 + (z - 6) * 0.6, 10, 15);
  }
}

// A discovered realm (see Discovery) never fades out when zooming in; only the
// low-zoom floor applies so the world view doesn't drown in names.
function visibleAt(kind: Kind, z: number, discovered: boolean): boolean {
  switch (kind) {
    case "country":
      return discovered || (z >= 2 && z <= 6.5);
    case "region":
      return z >= 3.5 && (z <= 9 || discovered);
    case "city":
      return z >= 5;
    case "town":
      return z >= 8.5;
    case "water":
      return z >= 6;
  }
}

interface Item {
  el: HTMLDivElement;
  lng: number;
  lat: number;
  kind: Kind;
  crestEl: HTMLElement | null;
}

// Realms (countries, regions, cities) get a heraldic crest above the name.
const REALM_KINDS = new Set<Kind>(["country", "region", "city"]);

// A realm counts as discovered once enough explored ground lies within a radius
// of its label point. It's a proxy for "a significant part was explored" (we have
// no borders client-side), but unlike the fog pixel check it doesn't depend on
// zoom, so a discovered realm's crest stays put at every zoom level.
const DISCOVERY: Partial<Record<Kind, { radiusKm: number; minCells: number }>> = {
  country: { radiusKm: 150, minCells: 25 },
  region: { radiusKm: 60, minCells: 10 },
  city: { radiusKm: 12, minCells: 3 },
};

const KM_PER_DEG = 111.32;

/** Explored cells bucketed into a 1° grid for cheap radius counts. */
class Discovery {
  private grid = new Map<string, Array<[number, number]>>();
  private pins: Pin[] = [];
  private cache = new Map<string, boolean>();

  set(cells: Cell[], pins: Pin[]) {
    this.grid.clear();
    this.cache.clear();
    this.pins = pins;
    for (const c of cells) {
      const k = Math.floor(c.lat) + "|" + Math.floor(c.lng);
      let b = this.grid.get(k);
      if (!b) this.grid.set(k, (b = []));
      b.push([c.lat, c.lng]);
    }
  }

  isDiscovered(kind: Kind, lng: number, lat: number): boolean {
    const rule = DISCOVERY[kind];
    if (!rule) return false;
    const key = kind + "|" + lng.toFixed(3) + "|" + lat.toFixed(3);
    let v = this.cache.get(key);
    if (v === undefined) {
      v = this.compute(rule.radiusKm, rule.minCells, lng, lat);
      this.cache.set(key, v);
    }
    return v;
  }

  private compute(radiusKm: number, minCells: number, lng: number, lat: number): boolean {
    const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
    const distKm = (la: number, ln: number) => {
      const dy = (la - lat) * KM_PER_DEG;
      const dx = (ln - lng) * KM_PER_DEG * cosLat;
      return Math.hypot(dx, dy);
    };
    // A pin is a deliberate "I was here", so one inside the radius is enough.
    for (const p of this.pins) {
      if (distKm(p.lat, p.lng) <= radiusKm + p.radiusM / 1000) return true;
    }
    const dLat = radiusKm / KM_PER_DEG;
    const dLng = Math.min(radiusKm / (KM_PER_DEG * cosLat), 180);
    let n = 0;
    for (let y = Math.floor(lat - dLat); y <= Math.floor(lat + dLat); y++) {
      for (let x = Math.floor(lng - dLng); x <= Math.floor(lng + dLng); x++) {
        const b = this.grid.get(y + "|" + x);
        if (!b) continue;
        for (const [la, ln] of b) {
          if (distKm(la, ln) <= radiusKm && ++n >= minCells) return true;
        }
      }
    }
    return false;
  }
}

export class LabelLayer {
  private map: MlMap;
  private fog: FogLayer | null;
  private root: HTMLDivElement;
  private items: Item[] = [];
  private srcName: string | null = null;
  private moveRaf = 0;
  private rebuildTimer = 0;
  private discovery = new Discovery();
  // Country borders, once loaded. From then on countries come from these (any
  // explored cell inside → discovered) instead of the tiles' label points.
  private countries: Country[] | null = null;
  private realms: Country[] = [];
  private explored: { cells: Cell[]; pins: Pin[] } = { cells: [], pins: [] };

  private onMove = () => {
    if (this.moveRaf) return;
    this.moveRaf = requestAnimationFrame(() => {
      this.moveRaf = 0;
      this.reposition();
    });
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
    this.root.className = "maplabels";
    map.getCanvasContainer().appendChild(this.root);
    map.on("move", this.onMove);
    map.on("moveend", this.onSettle);
    map.on("zoomend", this.onSettle);
    map.on("sourcedata", this.onSourceData);
    this.rebuild();
  }

  /** Explored data used to decide which realms are discovered. */
  setExplored(cells: Cell[], pins: Pin[]) {
    this.discovery.set(cells, pins);
    this.explored = { cells, pins };
    if (this.countries) {
      this.realms = discoveredCountries(this.countries, cells, pins);
    } else {
      loadCountries()
        .then((all) => {
          this.countries = all;
          this.realms = discoveredCountries(all, this.explored.cells, this.explored.pins);
          this.rebuild();
        })
        .catch(() => {
          // Keep the tile-based fallback if the borders fail to load.
        });
    }
  }

  /** Re-evaluate labels (e.g. after explored data changes). */
  refresh() {
    this.rebuild();
  }

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
    this.srcName =
      Object.keys(sources).find((k) => (sources as Record<string, { type?: string }>)[k]?.type === "vector") ?? null;
    return this.srcName;
  }

  private rebuild() {
    const src = this.vectorSource();
    if (!src) return;
    const z = this.map.getZoom();

    interface Pick {
      kind: Kind;
      name: string;
      lng: number;
      lat: number;
      rank: number;
      discovered: boolean;
    }
    const chosen = new Map<string, Pick>();

    const consider = (feats: MapGeoJSONFeature[], toKind: (cls: string) => Kind | null) => {
      for (const f of feats) {
        if (!f.geometry || f.geometry.type !== "Point") continue;
        const props = (f.properties ?? {}) as Record<string, unknown>;
        const name = String(props.name_en ?? props.name ?? "");
        if (!name) continue;
        const kind = toKind(String(props.class ?? ""));
        if (!kind) continue;
        const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
        const discovered = this.discovery.isDiscovered(kind, lng, lat);
        if (!visibleAt(kind, z, discovered)) continue;
        const rank = Number(props.rank ?? props.symbolrank ?? 50);
        const key = kind + "|" + name.toLowerCase();
        const prev = chosen.get(key);
        if (!prev || rank < prev.rank) {
          chosen.set(key, { kind, name, lng, lat, rank, discovered });
        }
      }
    };

    try {
      const own = this.countries !== null;
      consider(this.map.querySourceFeatures(src, { sourceLayer: "place" }), (cls) =>
        own && cls === "country" ? null : kindFor(cls),
      );
      consider(this.map.querySourceFeatures(src, { sourceLayer: "water_name" }), () => "water");
    } catch {
      return;
    }

    // Discovered countries are never dropped by the label cap.
    const realms: Pick[] = this.countries
      ? this.realms.map((c) => ({ kind: "country", name: c.name, lng: c.lng, lat: c.lat, rank: 0, discovered: true }))
      : [];
    const list = [...realms, ...[...chosen.values()].sort((a, b) => a.rank - b.rank).slice(0, MAX_LABELS)];

    this.root.textContent = "";
    this.items = [];
    for (const it of list) {
      // Labels sit above the clouds now, so only show ones over explored (or
      // open-sea) ground — otherwise unexplored place names would float on the fog.
      // Discovered realms are the exception: once earned, they always show.
      if (!it.discovered && this.fog && !this.fog.isRevealed(it.lng, it.lat)) continue;
      const el = document.createElement("div");
      el.className = "maplabel " + it.kind;
      let crestEl: HTMLElement | null = null;
      if (REALM_KINDS.has(it.kind)) {
        crestEl = document.createElement("span");
        crestEl.className = "crest";
        crestEl.innerHTML = this.crestFor(it.name);
        el.appendChild(crestEl);
        const txt = document.createElement("span");
        txt.className = "lbl-text";
        txt.textContent = it.name;
        el.appendChild(txt);
      } else {
        el.textContent = it.name;
      }
      this.root.appendChild(el);
      this.items.push({ el, lng: it.lng, lat: it.lat, kind: it.kind, crestEl });
    }
    this.reposition();
  }

  private crestCache = new Map<string, string>();
  private crestFor(name: string): string {
    let s = this.crestCache.get(name);
    if (!s) {
      s = crestSvg(name);
      this.crestCache.set(name, s);
    }
    return s;
  }

  private reposition() {
    const c = this.map.getCanvas();
    const W = c.clientWidth;
    const H = c.clientHeight;
    const z = this.map.getZoom();
    for (const it of this.items) {
      const pt = this.map.project([it.lng, it.lat]);
      if (pt.x < -80 || pt.x > W + 80 || pt.y < -40 || pt.y > H + 40) {
        it.el.style.display = "none";
        continue;
      }
      it.el.style.display = "";
      const fs = sizeFor(it.kind, z);
      it.el.style.fontSize = fs.toFixed(1) + "px";
      if (it.crestEl) {
        const h = fs * 2.4;
        it.crestEl.style.width = ((h * 100) / 120).toFixed(1) + "px";
        it.crestEl.style.height = h.toFixed(1) + "px";
      }
      it.el.style.transform = `translate(${pt.x}px, ${pt.y}px) translate(-50%, -50%)`;
    }
  }
}
