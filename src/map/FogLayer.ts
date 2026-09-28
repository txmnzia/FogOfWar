import type { Map as MlMap } from "maplibre-gl";
import { cellToParent, cellToLatLng, cellToBoundary, getHexagonEdgeLengthAvg } from "h3-js";
import { H3_RES, type FogSettings } from "../lib/constants";
import type { Cell, Pin } from "../lib/types";

// H3 resolutions we pre-aggregate to, finest → coarsest. When zoomed out we draw
// a coarse level (few big cells) instead of every fine cell, so the number of
// shapes drawn depends on the screen, not on how much history you have.
const LADDER = [H3_RES, 8, 7, 6, 5, 4, 3, 2];
// Aggregate to a coarser level once a cell would draw smaller than this (CSS px).
// Bigger → fewer, larger cells on screen → cheaper, but coarser aggregation
// slightly over-states a thin route. Kept small so the lit area stays honest.
const MIN_DRAW_CSS = 6;
// Soft candlelight edge width from the "fade" setting (CSS px).
const BLUR_MIN = 1.5;
const BLUR_SPREAD = 7;

interface Level {
  res: number;
  edgeM: number;
  /** Flat [lat, lng, …] of the (deduped) cell centres — used for viewport culling. */
  centers: Float64Array;
  /** Flat mercator [x, y, …] of every cell's boundary vertices, concatenated. */
  merc: Float64Array;
  /** Number of boundary vertices for each cell (5 or 6). */
  counts: Uint8Array;
}

// Web-Mercator projection to the unit square [0,1]², matching MapLibre. Doing this
// once per cell lets each frame convert a vertex to screen space with a couple of
// multiplies instead of a full map.project() call.
function lngLatToMerc(lng: number, lat: number): [number, number] {
  const x = (180 + lng) / 360;
  const s = Math.sin((lat * Math.PI) / 180);
  const y = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  return [x, y];
}

/**
 * Fog as a canvas overlay synced to the map.
 *
 * Explored cells erase the dark veil as their true H3 hexagons, unioned on an
 * offscreen canvas, then composited through a light blur for a soft candlelight
 * edge. Because H3 hexagons tile the plane, adjacent explored cells join with no
 * gaps or beading, and the lit region is exactly the union of cells you've
 * actually visited — it never balloons past your real footprint. Cells are
 * pre-aggregated into an H3 pyramid, so a zoomed-out view draws a handful of
 * coarse hexagons instead of tens of thousands, keeping pan/zoom smooth on any
 * device regardless of history size.
 */
export class FogLayer {
  private map: MlMap;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private fog: HTMLCanvasElement;
  private fctx: CanvasRenderingContext2D;
  private levels: Level[] = [];
  private lastCells: Cell[] | null = null;
  private pins: Pin[] = [];
  private settings: FogSettings;
  private raf = 0;
  private ro: ResizeObserver;

  constructor(map: MlMap, settings: FogSettings) {
    this.map = map;
    this.settings = settings;

    this.canvas = document.createElement("canvas");
    Object.assign(this.canvas.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "none",
      zIndex: "1",
    } as CSSStyleDeclaration);
    map.getCanvasContainer().appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
    this.fog = document.createElement("canvas");
    this.fctx = this.fog.getContext("2d")!;

    this.schedule = this.schedule.bind(this);
    map.on("move", this.schedule);
    map.on("moveend", this.schedule);
    map.on("zoom", this.schedule);

    this.ro = new ResizeObserver(() => this.schedule());
    this.ro.observe(map.getCanvasContainer());

    this.resize();
  }

  setData(cells: Cell[], pins: Pin[]) {
    this.pins = pins;
    if (cells !== this.lastCells) {
      this.lastCells = cells;
      this.buildPyramid(cells);
    }
    this.schedule();
  }

  setSettings(settings: FogSettings) {
    this.settings = settings;
    this.schedule();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.map.off("move", this.schedule);
    this.map.off("moveend", this.schedule);
    this.map.off("zoom", this.schedule);
    this.ro.disconnect();
    this.canvas.remove();
  }

  private buildPyramid(cells: Cell[]) {
    this.levels = LADDER.map((res) => {
      const set = new Set<string>();
      for (const c of cells) set.add(res === H3_RES ? c.h3 : cellToParent(c.h3, res));

      const n = set.size;
      const centers = new Float64Array(n * 2);
      const counts = new Uint8Array(n);
      // Pre-size assuming 6 vertices/cell (pentagons, which have 5, are
      // vanishingly rare); grow only if that ever proves too small.
      let merc = new Float64Array(n * 12);
      let ci = 0;
      let vi = 0;
      for (const h3 of set) {
        const [clat, clng] = cellToLatLng(h3);
        centers[ci * 2] = clat;
        centers[ci * 2 + 1] = clng;
        const bnd = cellToBoundary(h3); // [[lat, lng], …]
        counts[ci] = bnd.length;
        if (vi + bnd.length * 2 > merc.length) {
          const grown = new Float64Array(merc.length + bnd.length * 2 + n * 2);
          grown.set(merc);
          merc = grown;
        }
        for (const [vlat, vlng] of bnd) {
          const [mx, my] = lngLatToMerc(vlng, vlat);
          merc[vi++] = mx;
          merc[vi++] = my;
        }
        ci++;
      }
      return { res, edgeM: getHexagonEdgeLengthAvg(res, "m"), centers, counts, merc };
    });
  }

  private schedule() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render();
    });
  }

  private resize(): number {
    const mc = this.map.getCanvas();
    if (this.canvas.width !== mc.width || this.canvas.height !== mc.height) {
      this.canvas.width = mc.width;
      this.canvas.height = mc.height;
      this.fog.width = mc.width;
      this.fog.height = mc.height;
    }
    return mc.clientWidth > 0 ? mc.width / mc.clientWidth : 1;
  }

  private pixelsPerMeter(scale: number): number {
    const c = this.map.getCenter();
    const d = 1000;
    const dLng = d / (111320 * Math.cos((c.lat * Math.PI) / 180));
    const p1 = this.map.project([c.lng, c.lat]);
    const p2 = this.map.project([c.lng + dLng, c.lat]);
    return (Math.hypot(p2.x - p1.x, p2.y - p1.y) / d) * scale;
  }

  private render() {
    const scale = this.resize();
    const W = this.canvas.width;
    const H = this.canvas.height;
    const ctx = this.ctx;
    const fctx = this.fctx;

    // Dark veil on the offscreen canvas.
    fctx.setTransform(1, 0, 0, 1, 0, 0);
    fctx.globalCompositeOperation = "source-over";
    fctx.clearRect(0, 0, W, H);
    fctx.fillStyle = `rgba(20,14,7,${this.settings.darkness})`;
    fctx.fillRect(0, 0, W, H);

    const ppm = this.pixelsPerMeter(scale);
    const minPx = MIN_DRAW_CSS * scale;
    const level =
      this.levels.find((l) => l.edgeM * ppm >= minPx) ?? this.levels[this.levels.length - 1];
    const edgePx = level ? level.edgeM * ppm : 8;
    // Candlelight softness: a fixed base from the "fade" setting plus a share of
    // the cell size, so coarse (zoomed-out) cells melt their hexagon steps into a
    // smooth ribbon while fine cells stay crisp. Capped so a lone cell is never
    // erased by its own blur (which would also make the lit area balloon).
    const blurPx = Math.min(
      (BLUR_MIN + this.settings.fade * BLUR_SPREAD) * scale + edgePx * 0.3,
      edgePx * 0.85,
    );

    fctx.globalCompositeOperation = "destination-out";
    fctx.fillStyle = "#000";

    if (level && level.centers.length) {
      // Derive the affine mercator→screen transform from two projected reference
      // points (exact for the app's north-up, unpitched map): screen = a·merc + b.
      // This lets us place every vertex with two multiplies instead of a full
      // map.project() call per vertex.
      const c = this.map.getCenter();
      const [m0x, m0y] = lngLatToMerc(c.lng, c.lat);
      const dxDeg = 0.05;
      const [m1x, m1y] = lngLatToMerc(c.lng + dxDeg, c.lat + dxDeg);
      const p0 = this.map.project([c.lng, c.lat]);
      const p1 = this.map.project([c.lng + dxDeg, c.lat + dxDeg]);
      const ax = ((p1.x - p0.x) / (m1x - m0x)) * scale;
      const ay = ((p1.y - p0.y) / (m1y - m0y)) * scale;
      const bx = p0.x * scale - ax * m0x;
      const by = p0.y * scale - ay * m0y;

      // Viewport bounds padded by a cell + the blur reach, in degrees.
      const b = this.map.getBounds();
      const latPad = level.edgeM / 111320 + blurPx / Math.max(ppm, 1e-9) / 111320;
      const lngPad = latPad / Math.max(0.15, Math.cos((c.lat * Math.PI) / 180));
      const west = b.getWest() - lngPad;
      const east = b.getEast() + lngPad;
      const south = b.getSouth() - latPad;
      const north = b.getNorth() + latPad;
      const centers = level.centers;
      const merc = level.merc;
      const counts = level.counts;

      // One accumulated path of every visible hexagon; a single fill() unions
      // them (overlaps erase idempotently), giving a clean continuous region.
      fctx.beginPath();
      let vi = 0;
      for (let ci = 0; ci < counts.length; ci++) {
        const n = counts[ci];
        const lat = centers[ci * 2];
        const lng = centers[ci * 2 + 1];
        if (lat < south || lat > north || lng < west || lng > east) {
          vi += n * 2;
          continue;
        }
        for (let k = 0; k < n; k++) {
          const x = ax * merc[vi] + bx;
          const y = ay * merc[vi + 1] + by;
          if (k === 0) fctx.moveTo(x, y);
          else fctx.lineTo(x, y);
          vi += 2;
        }
        fctx.closePath();
      }
      fctx.fill();
    }

    // Pins: a filled disc of their radius.
    for (const pin of this.pins) {
      const p = this.map.project([pin.lng, pin.lat]);
      const x = p.x * scale;
      const y = p.y * scale;
      const r = Math.max(minPx, pin.radiusM * ppm);
      if (x < -r - blurPx || x > W + r + blurPx || y < -r - blurPx || y > H + r + blurPx) continue;
      fctx.beginPath();
      fctx.arc(x, y, r, 0, Math.PI * 2);
      fctx.fill();
    }
    fctx.globalCompositeOperation = "source-over";

    // Composite through a light blur: a soft candlelight edge that also melts the
    // hexagon vertices into one smooth, organic region.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.filter = blurPx > 0.4 ? `blur(${blurPx}px)` : "none";
    ctx.drawImage(this.fog, 0, 0);
    ctx.filter = "none";
  }
}
