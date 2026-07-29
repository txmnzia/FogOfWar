import type { Map as MlMap } from "maplibre-gl";
import { CELL_EDGE_M, type FogSettings } from "../lib/constants";
import type { Cell, Pin } from "../lib/types";

/**
 * Draws the candlelight fog as a canvas overlay synced to the map.
 *
 * Each explored cell (and pin) erases the dark veil with a radial gradient that
 * is fully opaque out to the cell's core and then fades to nothing over the
 * "reach" distance. Because the erase uses `destination-out`, overlapping cores
 * simply combine into one fully-cleared region — so ten visits to a block look
 * identical to one ("explored is explored"), while the region's outer edge is
 * always a soft gradient, never a hard line. We deliberately avoid the Canvas
 * 2D blur filter, which isn't supported on every device/GPU.
 */
export class FogLayer {
  private map: MlMap;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
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

  /** Erase the veil at (x,y): opaque to `core`, fading to nothing at `outer`. */
  private punch(x: number, y: number, core: number, outer: number) {
    const ctx = this.ctx;
    const r = Math.max(outer, 0.75);
    const c = Math.min(0.97, Math.max(0, core / r));
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(0,0,0,1)");
    g.addColorStop(c, "rgba(0,0,0,1)");
    g.addColorStop(c + (1 - c) * 0.4, "rgba(0,0,0,0.55)");
    g.addColorStop(c + (1 - c) * 0.72, "rgba(0,0,0,0.22)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  private render() {
    const scale = this.resize();
    const W = this.canvas.width;
    const H = this.canvas.height;
    const ctx = this.ctx;

    const ppm = this.pixelsPerMeter(scale);
    const cellCore = Math.max(0.75, CELL_EDGE_M * 1.18 * ppm);
    const reachPx = Math.min(220, Math.max(1, this.settings.reachM * ppm));
    const margin = cellCore + reachPx + 4;

    // Cheap lat/lng pre-filter so we only draw cells that could be visible.
    const b = this.map.getBounds();
    const cLat = this.map.getCenter().lat;
    const latPad = (this.settings.reachM + CELL_EDGE_M * 2) / 111320;
    const lngPad = latPad / Math.max(0.15, Math.cos((cLat * Math.PI) / 180));
    const west = b.getWest() - lngPad;
    const east = b.getEast() + lngPad;
    const south = b.getSouth() - latPad;
    const north = b.getNorth() + latPad;

    // Dark veil over everything…
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = `rgba(20,14,7,${this.settings.darkness})`;
    ctx.fillRect(0, 0, W, H);

    // …then carve candlelight out of it.
    ctx.globalCompositeOperation = "destination-out";
    for (const cell of this.cells) {
      if (cell.lng < west || cell.lng > east || cell.lat < south || cell.lat > north) continue;
      const p = this.map.project([cell.lng, cell.lat]);
      const x = p.x * scale;
      const y = p.y * scale;
      if (x < -margin || x > W + margin || y < -margin || y > H + margin) continue;
      this.punch(x, y, cellCore, cellCore + reachPx);
    }
    for (const pin of this.pins) {
      const p = this.map.project([pin.lng, pin.lat]);
      const x = p.x * scale;
      const y = p.y * scale;
      const core = Math.max(cellCore, pin.radiusM * ppm);
      if (x < -margin - core || x > W + margin + core || y < -margin - core || y > H + margin + core) continue;
      this.punch(x, y, core, core + reachPx);
    }
    ctx.globalCompositeOperation = "source-over";
  }
}
