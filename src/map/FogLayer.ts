import type { Map as MlMap } from "maplibre-gl";
import { CELL_EDGE_M, type FogSettings } from "../lib/constants";
import type { Cell, Pin } from "../lib/types";

/**
 * Draws the fog as a canvas overlay synced to the map.
 *
 * The reveal is ONE smooth light field: we rasterise the union of every explored
 * cell (and pin) as solid discs, then Gaussian-blur the whole thing and subtract
 * it from a dark veil with `destination-out`. Because nothing hard is stamped
 * back, the light falls off continuously from the interior into the dark — there
 * is no visible boundary between "explored" and "fog", like a real RPG map.
 * Overlapping visits merge into one region, so ten visits look like one.
 *
 * `settings.fade` (0..1) sets how wide/gradual that falloff is; `settings.darkness`
 * (0..1) sets how dark the unexplored world stays.
 */
export class FogLayer {
  private map: MlMap;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private mask: HTMLCanvasElement;
  private mctx: CanvasRenderingContext2D;
  private cells: Cell[] = [];
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

    this.mask = document.createElement("canvas");
    this.mctx = this.mask.getContext("2d")!;

    this.schedule = this.schedule.bind(this);
    map.on("move", this.schedule);
    map.on("moveend", this.schedule);
    map.on("zoom", this.schedule);

    this.ro = new ResizeObserver(() => this.schedule());
    this.ro.observe(map.getCanvasContainer());

    this.resize();
  }

  setData(cells: Cell[], pins: Pin[]) {
    this.cells = cells;
    this.pins = pins;
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

  private schedule() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render();
    });
  }

  /** Match the overlay to the map's own backing canvas exactly. Returns the
   *  device-pixels-per-CSS-pixel scale the map is using. */
  private resize(): number {
    const mc = this.map.getCanvas();
    if (this.canvas.width !== mc.width || this.canvas.height !== mc.height) {
      this.canvas.width = mc.width;
      this.canvas.height = mc.height;
      this.mask.width = mc.width;
      this.mask.height = mc.height;
    }
    return mc.clientWidth > 0 ? mc.width / mc.clientWidth : 1;
  }

  /** Screen pixels (device) per real-world metre at the current view. */
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
    const mctx = this.mctx;

    const ppm = this.pixelsPerMeter(scale);
    // Explored discs and the feather are both sized in the real world, so the
    // lit geography is honest and — crucially — an explored region stays solid
    // and bright at every zoom (the feather can't wash out its interior). The
    // feather still gives a wide, gradual edge as you zoom in.
    const discR = Math.max(1.2, CELL_EDGE_M * 1.18 * ppm);
    const fadeM = this.settings.fade * 3500; // border-fade distance, metres
    const featherPx = Math.min(300, Math.max(1, fadeM * ppm));
    const margin = discR + featherPx + 4;

    // Cheap lat/lng pre-filter so we only draw what could touch the viewport.
    const b = this.map.getBounds();
    const cLat = this.map.getCenter().lat;
    const padM = fadeM + CELL_EDGE_M * 2;
    const latPad = padM / 111320;
    const lngPad = latPad / Math.max(0.15, Math.cos((cLat * Math.PI) / 180));
    const west = b.getWest() - lngPad;
    const east = b.getEast() + lngPad;
    const south = b.getSouth() - latPad;
    const north = b.getNorth() + latPad;

    // 1) Build the light field: union of explored discs, then blur it.
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.globalCompositeOperation = "source-over";
    mctx.clearRect(0, 0, W, H);
    mctx.fillStyle = "#fff";
    mctx.filter = featherPx > 0.5 ? `blur(${featherPx}px)` : "none";
    mctx.beginPath();
    for (const cell of this.cells) {
      if (cell.lng < west || cell.lng > east || cell.lat < south || cell.lat > north) continue;
      const p = this.map.project([cell.lng, cell.lat]);
      const x = p.x * scale;
      const y = p.y * scale;
      if (x < -margin || x > W + margin || y < -margin || y > H + margin) continue;
      mctx.moveTo(x + discR, y);
      mctx.arc(x, y, discR, 0, Math.PI * 2);
    }
    for (const pin of this.pins) {
      const p = this.map.project([pin.lng, pin.lat]);
      const x = p.x * scale;
      const y = p.y * scale;
      const r = Math.max(discR, pin.radiusM * ppm);
      if (x < -margin - r || x > W + margin + r || y < -margin - r || y > H + margin + r) continue;
      mctx.moveTo(x + r, y);
      mctx.arc(x, y, r, 0, Math.PI * 2);
    }
    mctx.fill();
    mctx.filter = "none";

    // 2) Dark veil, carved by the smooth field.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = `rgba(20,14,7,${this.settings.darkness})`;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "destination-out";
    ctx.drawImage(this.mask, 0, 0);
    ctx.globalCompositeOperation = "source-over";
  }
}
