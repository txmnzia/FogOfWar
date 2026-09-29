import type { Map as MlMap, MapGeoJSONFeature } from "maplibre-gl";
import { cellToParent, cellToLatLng, getHexagonEdgeLengthAvg } from "h3-js";
import { H3_RES, type FogSettings } from "../lib/constants";
import type { Cell, Pin } from "../lib/types";

// H3 resolutions we pre-aggregate to, finest → coarsest. When zoomed out we draw
// a coarse level (few big cells) instead of every fine cell, so the number of
// shapes drawn depends on the screen, not on how much history you have.
const LADDER = [H3_RES, 8, 7, 6, 5, 4, 3, 2];
// Aggregate to a coarser level once a cell would draw smaller than this (CSS px).
const MIN_DRAW_CSS = 6;

// The fog is painted from a single coverage mask (explored cells + pins), so
// everything reads as one material. Instead of dimming the world with a flat
// veil, the unexplored ground is HIDDEN beneath a painted-cloud layer, and going
// somewhere lifts that layer to reveal the full-colour map underneath. The reveal
// is a soft feather: a rounded core that fully clears, wrapped in a translucent
// halo that dissolves gently back into the clouds.
//
// Everything is composited at 1/MASK_DOWNSCALE resolution and scaled back up:
// invisible on such soft imagery, and it quarters the fill/blur cost.
const MASK_DOWNSCALE = 3;

// ---- Painted-cloud veil (the "unexplored" surface) -------------------------
// Aged vellum with drifting cloud mottling. Tones are kept a touch lighter and
// warmer than the parchment basemap so the clouds read as a layer ABOVE the map.
// (Tunable set — mirrored by the Fog Reveal Studio prototype.)
const VEIL_PAPER: [number, number, number] = [196, 190, 182]; // base (neutral grey)
const VEIL_SHADOW: [number, number, number] = [150, 146, 138]; // low mottling
const VEIL_WISP: [number, number, number] = [232, 232, 230]; // cloud highlights
const VEIL_CONTRAST = 0.9; // spread of the cloud mottling
const VEIL_WISP_STRENGTH = 0.47; // how much white cloud shows through
const VEIL_MARGIN = 28; // mask-px overscan so drift never exposes an edge
const DRIFT_AMP = 13; // mask-px drift amplitude (0 = still)
const DRIFT_SPEED = 1.4; // drift speed multiplier
const DRIFT_FPS = 12; // throttle the drift so it barely costs battery

// ---- Reveal shape ----------------------------------------------------------
// Edge softness, as a share of the cell edge (device px): a single wide blur of
// the disc mask dissolves the boundary into the clouds — soft, but contained.
const CORE_BLUR_EDGE = 0.7;
const CORE_BLUR_MIN = 3;
// Halo reach (device px): a modest translucent glow just past the soft edge,
// driven by the "fade" setting so the slider can push it wider on demand.
const HALO_BLUR_BASE = 4;
const HALO_BLUR_SPREAD = 22;
const HALO_BLUR_EDGE = 0.6;
const HALO_ALPHA = 0.35;

// Disc radius per cell, as a share of the cell edge. Overlapping discs union into
// smooth, organic shapes with no hexagon steps, and a thin route stays connected.
const DISC_R = 1.25;

// Open water is revealed for orientation, but a fog band is kept hugging every
// coast so the coastline itself is still earned by exploring. The band width is
// in CSS px — a consistent visual margin at any zoom.
const WATER_MARGIN_CSS = 16;

interface Level {
  res: number;
  edgeM: number;
  /** Flat [lat, lng, …] of the (deduped) cell centres — used for viewport culling. */
  centers: Float64Array;
  /** Flat mercator [x, y, …] of the cell centres, for the affine screen transform. */
  cmerc: Float64Array;
  /** Fraction 0..1 of each aggregated cell actually explored (finest cells = 1). */
  cov: Float64Array;
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
 * Explored cells and manual pins are rasterised into one coverage mask. That mask
 * is blurred into a "reveal" alpha (soft core + translucent halo), which is then
 * cut out of a drifting painted-cloud layer: the map is revealed in full colour
 * exactly where you've been, and hidden under slowly drifting cloud everywhere
 * else. Cells are pre-aggregated into an H3 pyramid, so a zoomed-out view
 * rasterises a handful of coarse shapes instead of tens of thousands.
 */
export class FogLayer {
  private map: MlMap;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private fog: HTMLCanvasElement;
  private fctx: CanvasRenderingContext2D;
  private mask: HTMLCanvasElement;
  private mctx: CanvasRenderingContext2D;
  private reveal: HTMLCanvasElement;
  private rctx: CanvasRenderingContext2D;
  private veil: HTMLCanvasElement;
  private vctx: CanvasRenderingContext2D;
  private wrev: HTMLCanvasElement;
  private wctx: CanvasRenderingContext2D;
  private wtmp: HTMLCanvasElement;
  private wtctx: CanvasRenderingContext2D;
  private mtmp: HTMLCanvasElement;
  private mtctx: CanvasRenderingContext2D;
  private small: HTMLCanvasElement;
  private sctx: CanvasRenderingContext2D;
  private srcName: string | null = null;
  private levels: Level[] = [];
  private lastCells: Cell[] | null = null;
  private pins: Pin[] = [];
  private settings: FogSettings;
  // Advanced, live-tunable knobs (Fog Lab). Default to the baked constants.
  private tuning = {
    discR: DISC_R,
    coreEdge: CORE_BLUR_EDGE,
    markSurvive: 1.3,
    closeScale: 1,
    haloAlpha: HALO_ALPHA,
  };
  private raf = 0;
  private driftRaf = 0;
  private lastDrift = 0;
  private reduce: boolean;
  private ro: ResizeObserver;

  constructor(map: MlMap, settings: FogSettings) {
    this.map = map;
    this.settings = settings;
    this.reduce =
      typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

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
    this.mask = document.createElement("canvas");
    this.mctx = this.mask.getContext("2d")!;
    this.reveal = document.createElement("canvas");
    this.rctx = this.reveal.getContext("2d", { willReadFrequently: true })!;
    this.veil = document.createElement("canvas");
    this.vctx = this.veil.getContext("2d")!;
    this.wrev = document.createElement("canvas");
    this.wctx = this.wrev.getContext("2d", { willReadFrequently: true })!;
    this.wtmp = document.createElement("canvas");
    this.wtctx = this.wtmp.getContext("2d")!;
    this.mtmp = document.createElement("canvas");
    this.mtctx = this.mtmp.getContext("2d")!;
    this.small = document.createElement("canvas");
    this.sctx = this.small.getContext("2d")!;

    this.schedule = this.schedule.bind(this);
    this.driftTick = this.driftTick.bind(this);
    map.on("move", this.schedule);
    map.on("moveend", this.schedule);
    map.on("zoom", this.schedule);

    this.ro = new ResizeObserver(() => this.schedule());
    this.ro.observe(map.getCanvasContainer());

    this.resize();
    this.startDrift();
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

  getTuning() {
    return { ...this.tuning };
  }

  setTuning(t: Partial<typeof this.tuning>) {
    this.tuning = { ...this.tuning, ...t };
    this.schedule();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    cancelAnimationFrame(this.driftRaf);
    this.map.off("move", this.schedule);
    this.map.off("moveend", this.schedule);
    this.map.off("zoom", this.schedule);
    this.ro.disconnect();
    this.canvas.remove();
  }

  private buildPyramid(cells: Cell[]) {
    this.levels = LADDER.map((res) => {
      // Count how many finest-resolution cells fall inside each aggregated cell,
      // so we can size its disc by real coverage instead of "any child explored".
      const counts = new Map<string, number>();
      for (const c of cells) {
        const p = res === H3_RES ? c.h3 : cellToParent(c.h3, res);
        counts.set(p, (counts.get(p) ?? 0) + 1);
      }
      const childPerParent = Math.pow(7, H3_RES - res); // res-9 cells inside a res cell

      const n = counts.size;
      const centers = new Float64Array(n * 2);
      const cmerc = new Float64Array(n * 2);
      const cov = new Float64Array(n);
      let ci = 0;
      for (const [h3, cnt] of counts) {
        const [clat, clng] = cellToLatLng(h3);
        centers[ci * 2] = clat;
        centers[ci * 2 + 1] = clng;
        const [mx, my] = lngLatToMerc(clng, clat);
        cmerc[ci * 2] = mx;
        cmerc[ci * 2 + 1] = my;
        cov[ci] = Math.min(1, cnt / childPerParent);
        ci++;
      }
      return { res, edgeM: getHexagonEdgeLengthAvg(res, "m"), centers, cmerc, cov };
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
      const fw = Math.max(1, Math.ceil(mc.width / MASK_DOWNSCALE));
      const fh = Math.max(1, Math.ceil(mc.height / MASK_DOWNSCALE));
      this.fog.width = fw;
      this.fog.height = fh;
      this.mask.width = fw;
      this.mask.height = fh;
      this.reveal.width = fw;
      this.reveal.height = fh;
      this.wrev.width = fw;
      this.wrev.height = fh;
      this.wtmp.width = fw;
      this.wtmp.height = fh;
      this.mtmp.width = fw;
      this.mtmp.height = fh;
      this.buildVeil(fw, fh);
    }
    return mc.clientWidth > 0 ? mc.width / mc.clientWidth : 1;
  }

  /** Build the drifting cloud texture once per size, at mask resolution + margin. */
  private buildVeil(fw: number, fh: number) {
    const vw = fw + VEIL_MARGIN * 2;
    const vh = fh + VEIL_MARGIN * 2;
    this.veil.width = vw;
    this.veil.height = vh;

    const field = fbm(vw, vh, 1234);
    const out = this.vctx.createImageData(vw, vh);
    const d = field.data;
    const o = out.data;
    const [pr, pg, pb] = VEIL_PAPER;
    const [sr, sg, sb] = VEIL_SHADOW;
    const [wr, wg, wb] = VEIL_WISP;
    for (let i = 0; i < vw * vh; i++) {
      const n = d[i * 4] / 255;
      let t = 0.5 + (n - 0.5) * VEIL_CONTRAST;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      let r = sr + (pr - sr) * t;
      let g = sg + (pg - sg) * t;
      let b = sb + (pb - sb) * t;
      if (VEIL_WISP_STRENGTH > 0 && n > 0.6) {
        const wf = ((n - 0.6) / 0.4) * VEIL_WISP_STRENGTH;
        r += (wr - r) * wf;
        g += (wg - g) * wf;
        b += (wb - b) * wf;
      }
      o[i * 4] = r;
      o[i * 4 + 1] = g;
      o[i * 4 + 2] = b;
      o[i * 4 + 3] = 255;
    }
    this.vctx.putImageData(out, 0, 0);
  }

  private pixelsPerMeter(scale: number): number {
    const c = this.map.getCenter();
    const d = 1000;
    const dLng = d / (111320 * Math.cos((c.lat * Math.PI) / 180));
    const p1 = this.map.project([c.lng, c.lat]);
    const p2 = this.map.project([c.lng + dLng, c.lat]);
    return (Math.hypot(p2.x - p1.x, p2.y - p1.y) / d) * scale;
  }

  /** Rebuild the coverage mask + reveal alpha (only needed on move / data / resize). */
  private render() {
    const scale = this.resize();
    const ctx = this.ctx;
    const mctx = this.mctx;
    const fw = this.mask.width;
    const fh = this.mask.height;
    const ms = scale / MASK_DOWNSCALE;

    const ppm = this.pixelsPerMeter(scale);
    const minPx = MIN_DRAW_CSS * scale;
    const level =
      this.levels.find((l) => l.edgeM * ppm >= minPx) ?? this.levels[this.levels.length - 1];
    const edgePx = level ? level.edgeM * ppm : 8;

    const coreBlur = Math.max(CORE_BLUR_MIN * scale, edgePx * this.tuning.coreEdge) / MASK_DOWNSCALE;
    const haloBlur =
      ((HALO_BLUR_BASE + this.settings.fade * HALO_BLUR_SPREAD) * scale + edgePx * HALO_BLUR_EDGE) /
      MASK_DOWNSCALE;
    const reachPx = coreBlur + haloBlur;

    // ---- 1. Coverage mask: a disc per explored cell + pins, solid, at low res.
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.globalCompositeOperation = "source-over";
    mctx.clearRect(0, 0, fw, fh);
    mctx.fillStyle = "#fff";

    // Affine mercator→mask transform (depends only on the map view, not the
    // data). Used for both explored cells and the water polygons.
    const c = this.map.getCenter();
    const [m0x, m0y] = lngLatToMerc(c.lng, c.lat);
    const dxDeg = 0.05;
    const [m1x, m1y] = lngLatToMerc(c.lng + dxDeg, c.lat + dxDeg);
    const p0 = this.map.project([c.lng, c.lat]);
    const p1 = this.map.project([c.lng + dxDeg, c.lat + dxDeg]);
    const ax = ((p1.x - p0.x) / (m1x - m0x)) * ms;
    const ay = ((p1.y - p0.y) / (m1y - m0y)) * ms;
    const bx = p0.x * ms - ax * m0x;
    const by = p0.y * ms - ay * m0y;

    if (level && level.centers.length) {
      // Two radii, whichever is larger:
      //  • the honest footprint — disc area ∝ how much of the aggregated cell is
      //    actually explored, so a lightly-visited coarse cell doesn't balloon;
      //  • a fixed on-screen minimum mark so exploration stays visible when zoomed
      //    right out, sized to survive the edge blur (a smaller dot just washes
      //    out against the fog). The min mark is a fixed screen size, not the
      //    coarse cell's size, so it stays a modest dot rather than a whole region.
      // Zoomed in, the footprint wins; zoomed out, the mark wins — both covered.
      const fullR = (edgePx * this.tuning.discR) / MASK_DOWNSCALE;
      const g = Math.max(0, Math.min(1, this.settings.generosity ?? 0.65));
      const minMark = Math.max(
        ((3 + g * 9) * scale) / MASK_DOWNSCALE,
        coreBlur * this.tuning.markSurvive,
      );

      const b = this.map.getBounds();
      const latPad =
        (edgePx * this.tuning.discR + reachPx * MASK_DOWNSCALE) / Math.max(ppm, 1e-9) / 111320;
      const lngPad = latPad / Math.max(0.15, Math.cos((c.lat * Math.PI) / 180));
      const west = b.getWest() - lngPad;
      const east = b.getEast() + lngPad;
      const south = b.getSouth() - latPad;
      const north = b.getNorth() + latPad;
      const centers = level.centers;
      const cmerc = level.cmerc;
      const cov = level.cov;

      mctx.beginPath();
      for (let ci = 0; ci < centers.length; ci += 2) {
        const lat = centers[ci];
        const lng = centers[ci + 1];
        if (lat < south || lat > north || lng < west || lng > east) continue;
        const x = ax * cmerc[ci] + bx;
        const y = ay * cmerc[ci + 1] + by;
        const rr = Math.max(minMark, fullR * Math.sqrt(cov[ci >> 1]));
        mctx.moveTo(x + rr, y);
        mctx.arc(x, y, rr, 0, Math.PI * 2);
      }
      mctx.fill();
    }

    for (const pin of this.pins) {
      const p = this.map.project([pin.lng, pin.lat]);
      const x = p.x * ms;
      const y = p.y * ms;
      const r = Math.max(minPx, pin.radiusM * ppm) / MASK_DOWNSCALE;
      if (x < -r - reachPx || x > fw + r + reachPx || y < -r - reachPx || y > fh + r + reachPx)
        continue;
      mctx.beginPath();
      mctx.arc(x, y, r, 0, Math.PI * 2);
      mctx.fill();
    }

    // ---- 1b. Close small interior holes (morphological closing) so a fully
    // surrounded pocket fills in and dense areas read as clean explored regions.
    const closeRad = Math.min(8, (edgePx * 0.5) / MASK_DOWNSCALE) * this.tuning.closeScale;
    if (closeRad >= 1.2) this.closeMask(closeRad, fw, fh);

    // ---- 2. Reveal alpha: soft core (full) + translucent halo, from the mask.
    // Precomputing this once per move means each drift frame is just two draws.
    const rctx = this.rctx;
    rctx.setTransform(1, 0, 0, 1, 0, 0);
    rctx.globalCompositeOperation = "source-over";
    rctx.globalAlpha = 1;
    rctx.filter = "none";
    rctx.clearRect(0, 0, fw, fh);
    // Soft core (full) + translucent halo. Blur via ctx.filter where it works
    // (desktop), else a downscale/upscale blur that also softens on iOS Safari,
    // where canvas ctx.filter is unsupported and would leave hard edges.
    this.blurDraw(rctx, this.mask, coreBlur, 1);
    this.blurDraw(rctx, this.mask, haloBlur, this.tuning.haloAlpha);
    rctx.globalAlpha = 1;

    // ---- 2b. Water: reveal open sea, eroded inward from every coast by a margin.
    const src = this.vectorSource();
    if (src) this.buildWaterReveal(src, ax, ay, bx, by, WATER_MARGIN_CSS * ms);
    else this.clearWater();

    // ---- 3. Composite the cloud veil with the reveals cut out.
    this.composite(this.reduce ? 0 : performance.now());
    void ctx;
  }

  /** Draw the drifting clouds, cut the reveal out, scale up to the visible canvas. */
  private composite(t: number) {
    const fctx = this.fctx;
    const fw = this.fog.width;
    const fh = this.fog.height;
    const W = this.canvas.width;
    const H = this.canvas.height;

    const amp = this.reduce ? 0 : DRIFT_AMP;
    const dx = amp ? Math.sin(t * 0.00006 * DRIFT_SPEED) * amp : 0;
    const dy = amp ? Math.cos(t * 0.00004 * DRIFT_SPEED) * amp : 0;

    const density = Math.max(0, Math.min(1, this.settings.darkness));

    fctx.setTransform(1, 0, 0, 1, 0, 0);
    fctx.globalCompositeOperation = "source-over";
    fctx.filter = "none";
    fctx.clearRect(0, 0, fw, fh);
    // The clouds hide the world; density (the "darkness" setting) controls how
    // completely, so a little of the paper can still glow through if desired.
    fctx.globalAlpha = density;
    fctx.drawImage(this.veil, -VEIL_MARGIN + dx, -VEIL_MARGIN + dy);
    fctx.globalAlpha = 1;
    // Lift the clouds over the open sea, then over everywhere you've explored.
    fctx.globalCompositeOperation = "destination-out";
    fctx.drawImage(this.wrev, 0, 0);
    fctx.drawImage(this.reveal, 0, 0);
    fctx.globalCompositeOperation = "source-over";

    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.fog, 0, 0, fw, fh, 0, 0, W, H);
  }

  /** Slow, throttled cloud drift. Paused when the tab is hidden or motion is reduced. */
  private startDrift() {
    if (this.reduce || DRIFT_AMP <= 0) return;
    this.driftRaf = requestAnimationFrame(this.driftTick);
  }

  private driftTick(t: number) {
    this.driftRaf = requestAnimationFrame(this.driftTick);
    if (t - this.lastDrift < 1000 / DRIFT_FPS) return;
    this.lastDrift = t;
    if (typeof document !== "undefined" && document.hidden) return;
    // Only the veil offset changes; the reveal + mask are reused as-is.
    this.composite(t);
  }

  /** Draw `src` blurred by `radius` (mask px) into rctx at `alpha`. Uses
   *  ctx.filter where supported, else a downscale/upscale blur for iOS Safari. */
  private blurDraw(
    dctx: CanvasRenderingContext2D,
    src: HTMLCanvasElement,
    radius: number,
    alpha: number,
  ) {
    const W = this.reveal.width;
    const H = this.reveal.height;
    dctx.globalAlpha = alpha;
    if (ctxFilterSupported()) {
      dctx.filter = radius > 0.3 ? `blur(${radius}px)` : "none";
      dctx.drawImage(src, 0, 0);
      dctx.filter = "none";
    } else {
      const f = Math.max(1, radius);
      const sw = Math.max(1, Math.round(W / f));
      const sh = Math.max(1, Math.round(H / f));
      this.small.width = sw;
      this.small.height = sh;
      this.sctx.imageSmoothingEnabled = true;
      this.sctx.clearRect(0, 0, sw, sh);
      this.sctx.drawImage(src, 0, 0, sw, sh);
      dctx.imageSmoothingEnabled = true;
      dctx.drawImage(this.small, 0, 0, sw, sh, 0, 0, W, H);
    }
    dctx.globalAlpha = 1;
  }

  /** Morphological closing (dilate then erode) of the coverage mask, in place. */
  private closeMask(rad: number, fw: number, fh: number) {
    const m = this.mctx;
    const t = this.mtctx;
    const d = rad * 0.7071;
    const offs: Array<[number, number]> = [
      [rad, 0],
      [-rad, 0],
      [0, rad],
      [0, -rad],
      [d, d],
      [d, -d],
      [-d, d],
      [-d, -d],
    ];
    // Dilate: union with shifted copies of the current mask.
    t.setTransform(1, 0, 0, 1, 0, 0);
    t.globalCompositeOperation = "source-over";
    t.clearRect(0, 0, fw, fh);
    t.drawImage(this.mask, 0, 0);
    m.globalCompositeOperation = "source-over";
    for (const [ox, oy] of offs) m.drawImage(this.mtmp, ox, oy);
    // Erode: intersect with shifted copies of the dilated mask.
    t.clearRect(0, 0, fw, fh);
    t.drawImage(this.mask, 0, 0);
    m.globalCompositeOperation = "destination-in";
    for (const [ox, oy] of offs) m.drawImage(this.mtmp, ox, oy);
    m.globalCompositeOperation = "source-over";
  }

  /** True if the point is currently under a cleared (explored or open-sea) area. */
  isRevealed(lng: number, lat: number): boolean {
    const mc = this.map.getCanvas();
    const cw = mc.clientWidth;
    const ch = mc.clientHeight;
    if (cw <= 0 || ch <= 0) return false;
    const p = this.map.project([lng, lat]);
    const fw = this.reveal.width;
    const fh = this.reveal.height;
    const sx = Math.round((p.x / cw) * fw);
    const sy = Math.round((p.y / ch) * fh);
    if (sx < 0 || sy < 0 || sx >= fw || sy >= fh) return false;
    try {
      if (this.rctx.getImageData(sx, sy, 1, 1).data[3] > 45) return true;
      return this.wctx.getImageData(sx, sy, 1, 1).data[3] > 45;
    } catch {
      return true; // if pixel readback is blocked, don't hide the label
    }
  }

  private vectorSource(): string | null {
    if (this.srcName) return this.srcName;
    const s = this.map.getStyle()?.sources ?? {};
    this.srcName =
      Object.keys(s).find((k) => (s as Record<string, { type?: string }>)[k]?.type === "vector") ??
      null;
    return this.srcName;
  }

  private clearWater() {
    this.wctx.setTransform(1, 0, 0, 1, 0, 0);
    this.wctx.clearRect(0, 0, this.wrev.width, this.wrev.height);
  }

  /** Reveal open water, eroded inward from every coast by `marginPx` (mask px). */
  private buildWaterReveal(
    src: string,
    ax: number,
    ay: number,
    bx: number,
    by: number,
    marginPx: number,
  ) {
    const fw = this.wtmp.width;
    const fh = this.wtmp.height;
    const wt = this.wtctx;
    const wr = this.wctx;

    let feats: MapGeoJSONFeature[];
    try {
      feats = this.map.querySourceFeatures(src, { sourceLayer: "water" });
    } catch {
      this.clearWater();
      return;
    }
    if (!feats.length) {
      this.clearWater();
      return;
    }

    // 1. Union of all water, filled seamlessly. Filling every tile's polygons
    // makes tile seams vanish in the raster, so only real coasts remain as edges.
    wt.setTransform(1, 0, 0, 1, 0, 0);
    wt.globalCompositeOperation = "source-over";
    wt.filter = "none";
    wt.globalAlpha = 1;
    wt.clearRect(0, 0, fw, fh);
    wt.fillStyle = "#fff";
    // At low zoom the viewport can span more than one copy of the world (the map
    // wraps horizontally). Water features come back only for longitudes −180…180,
    // so draw each one shifted by whole worlds (±360°) to cover every visible
    // copy — otherwise the wrapped edges stay fogged as vertical side bands.
    const worldPx = ax; // 360° of longitude, in mask px
    let kmin = 0;
    let kmax = 0;
    if (worldPx > 0.5) {
      kmin = Math.floor((0 - bx) / worldPx) - 1;
      kmax = Math.floor((fw - bx) / worldPx) + 1;
      if (kmax - kmin > 12) {
        kmin = 0;
        kmax = 0;
      }
    }
    for (const f of feats) {
      const g = f.geometry;
      if (g.type !== "Polygon" && g.type !== "MultiPolygon") continue;
      for (let k = kmin; k <= kmax; k++) {
        const bxo = bx + k * worldPx;
        if (g.type === "Polygon") {
          wt.beginPath();
          this.addRings(wt, g.coordinates, ax, ay, bxo, by);
          wt.fill("evenodd");
        } else {
          for (const poly of g.coordinates) {
            wt.beginPath();
            this.addRings(wt, poly, ax, ay, bxo, by);
            wt.fill("evenodd");
          }
        }
      }
    }

    // 2. Erode inward by the coast margin: intersect the fill with 8 shifted
    // copies of itself (a cheap morphological erosion). Because the fill is a
    // seamless union, this only bites at real coasts, not at tile boundaries.
    wr.setTransform(1, 0, 0, 1, 0, 0);
    wr.globalCompositeOperation = "source-over";
    wr.filter = "none";
    wr.globalAlpha = 1;
    wr.clearRect(0, 0, fw, fh);
    wr.drawImage(this.wtmp, 0, 0);
    const m = marginPx;
    const d = m * 0.7071;
    const offs: Array<[number, number]> = [
      [m, 0],
      [-m, 0],
      [0, m],
      [0, -m],
      [d, d],
      [d, -d],
      [-d, d],
      [-d, -d],
    ];
    wr.globalCompositeOperation = "destination-in";
    for (const [ox, oy] of offs) wr.drawImage(this.wtmp, ox, oy);
    wr.globalCompositeOperation = "source-over";
  }

  private addRings(
    ctx: CanvasRenderingContext2D,
    rings: number[][][],
    ax: number,
    ay: number,
    bx: number,
    by: number,
  ) {
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        const lng = ring[i][0];
        const lat = ring[i][1];
        const s = Math.sin((lat * Math.PI) / 180);
        const mx = (180 + lng) / 360;
        const my = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
        const x = ax * mx + bx;
        const y = ay * my + by;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    }
  }
}

// ---------------------------------------------------------------------------
// Fractal cloud field: stacked bilinear-upscaled random noise, in [0,255] on the
// red channel. Cheap, and generated once per resize.
function fbm(w: number, h: number, seed: number): ImageData {
  const acc = document.createElement("canvas");
  acc.width = w;
  acc.height = h;
  const ax = acc.getContext("2d")!;
  const octs: Array<[number, number]> = [
    [5, 0.5],
    [10, 0.25],
    [20, 0.15],
    [40, 0.1],
  ];
  ax.globalCompositeOperation = "lighter";
  octs.forEach((o, oi) => {
    const cells = o[0];
    const nw = cells;
    const nh = Math.max(2, Math.round((cells * h) / w));
    const n = document.createElement("canvas");
    n.width = nw;
    n.height = nh;
    const nx = n.getContext("2d")!;
    const id = nx.createImageData(nw, nh);
    const rnd = mulberry32(seed + oi * 131);
    for (let i = 0; i < nw * nh; i++) {
      const v = rnd() * 255;
      id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v;
      id.data[i * 4 + 3] = 255;
    }
    nx.putImageData(id, 0, 0);
    ax.globalAlpha = o[1];
    ax.imageSmoothingEnabled = true;
    ax.drawImage(n, 0, 0, w, h);
  });
  ax.globalAlpha = 1;
  ax.globalCompositeOperation = "source-over";
  return ax.getImageData(0, 0, w, h);
}

// Canvas 2D ctx.filter (used for the soft blur) is unsupported on many iOS Safari
// versions, where it silently no-ops and leaves hard edges. Detect it once.
let _ctxFilter: boolean | null = null;
function ctxFilterSupported(): boolean {
  if (_ctxFilter !== null) return _ctxFilter;
  try {
    const c = document.createElement("canvas");
    c.width = 8;
    c.height = 1;
    const x = c.getContext("2d")!;
    x.fillStyle = "#fff";
    x.fillRect(0, 0, 4, 1);
    const c2 = document.createElement("canvas");
    c2.width = 8;
    c2.height = 1;
    const x2 = c2.getContext("2d")!;
    x2.filter = "blur(2px)";
    x2.drawImage(c, 0, 0);
    x2.filter = "none";
    // If blur worked, white bled past x=4 into the previously-transparent region.
    _ctxFilter = x2.getImageData(5, 0, 1, 1).data[3] > 4;
  } catch {
    _ctxFilter = false;
  }
  return _ctxFilter;
}

function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
