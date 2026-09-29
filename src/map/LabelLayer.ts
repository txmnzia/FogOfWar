import type { Map as MlMap, MapGeoJSONFeature } from "maplibre-gl";

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

function visibleAt(kind: Kind, z: number): boolean {
  switch (kind) {
    case "country":
      return z >= 2 && z <= 6.5;
    case "region":
      return z >= 3.5 && z <= 9;
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
}

export class LabelLayer {
  private map: MlMap;
  private root: HTMLDivElement;
  private items: Item[] = [];
  private srcName: string | null = null;
  private moveRaf = 0;
  private rebuildTimer = 0;

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

  constructor(map: MlMap) {
    this.map = map;
    this.root = document.createElement("div");
    this.root.className = "maplabels";
    map.getCanvasContainer().appendChild(this.root);
    map.on("move", this.onMove);
    map.on("moveend", this.onSettle);
    map.on("zoomend", this.onSettle);
    map.on("sourcedata", this.onSourceData);
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
    }
    const chosen = new Map<string, Pick>();

    const consider = (feats: MapGeoJSONFeature[], toKind: (cls: string) => Kind | null) => {
      for (const f of feats) {
        if (!f.geometry || f.geometry.type !== "Point") continue;
        const props = (f.properties ?? {}) as Record<string, unknown>;
        const name = String(props.name_en ?? props.name ?? "");
        if (!name) continue;
        const kind = toKind(String(props.class ?? ""));
        if (!kind || !visibleAt(kind, z)) continue;
        const rank = Number(props.rank ?? props.symbolrank ?? 50);
        const key = kind + "|" + name.toLowerCase();
        const prev = chosen.get(key);
        if (!prev || rank < prev.rank) {
          const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
          chosen.set(key, { kind, name, lng, lat, rank });
        }
      }
    };

    try {
      consider(this.map.querySourceFeatures(src, { sourceLayer: "place" }), (cls) => kindFor(cls));
      consider(this.map.querySourceFeatures(src, { sourceLayer: "water_name" }), () => "water");
    } catch {
      return;
    }

    const list = [...chosen.values()].sort((a, b) => a.rank - b.rank).slice(0, MAX_LABELS);

    this.root.textContent = "";
    this.items = list.map((it) => {
      const el = document.createElement("div");
      el.className = "maplabel " + it.kind;
      el.textContent = it.name;
      this.root.appendChild(el);
      return { el, lng: it.lng, lat: it.lat, kind: it.kind };
    });
    this.reposition();
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
      it.el.style.fontSize = sizeFor(it.kind, z).toFixed(1) + "px";
      it.el.style.transform = `translate(${pt.x}px, ${pt.y}px) translate(-50%, -50%)`;
    }
  }
}
