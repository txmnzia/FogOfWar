import type { Map as MlMap } from "maplibre-gl";
import { CELL_EDGE_M, type FogSettings } from "../lib/constants";
import type { Cell, Pin } from "../lib/types";

// Isolated points never render smaller than this on screen (so no "ant dots"),
// but the size is otherwise real-world, so explored areas shrink naturally when
// zoomed out and bigger hubs read as bigger bubbles.
const MIN_CORE_CSS = 2.5;
const FLOOR_FEATHER_CSS = 3;
const FADE_MIN = 0.6; // fade=0 → tight halo
const FADE_SPREAD = 2.6; // fade=1 → halo ~3x the core radius

/**
 * Draws the fog as a canvas overlay synced to the map.
 *
 * Each explored cell (and pin) erases the dark veil with a candlelight gradient:
 * fully clear at its centre, then a LONG, gradual fade to nothing. So a single
 * GPS point is fully bright at that spot, more points on the same spot can't make
 * it brighter (already fully clear), and the edge is always a soft, progressive
 * falloff — never a hard line. The fade width has a floor so explored areas stay
 * a visible, glowing size at every zoom.
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

  /** Candlelight erase at (x,y): fully clear to `coreR`, then a long gradual fade to `outer`. */
  private punch(x: number, y: number, coreR: number, outer: number) {
    const ctx = this.ctx;
    const c = Math.min(0.9, coreR / outer);
    const g = ctx.createRadialGradient(x, y, 0, x, y, outer);
    g.addColorStop(0, "rgba(0,0,0,1)");
    g.addColorStop(c, "rgba(0,0,0,1)");
    // long, smooth candlelight falloff
    g.addColorStop(c + (1 - c) * 0.25, "rgba(0,0,0,0.68)");
    g.addColorStop(c + (1 - c) * 0.5, "rgba(0,0,0,0.36)");
    g.addColorStop(c + (1 - c) * 0.75, "rgba(0,0,0,0.14)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, outer, 0, Math.PI * 2);
    ctx.fill();
  }

  private render() {
    const scale = this.resize();
    const W = this.canvas.width;
    const H = this.canvas.height;
    const ctx = this.ctx;

    const ppm = this.pixelsPerMeter(scale);
    // Real-world sized core (with a small screen floor), plus a soft edge that's
    // proportional to the core — so the whole mark scales with zoom instead of
    // staying a fixed huge blob.
    const cellCore = Math.max(MIN_CORE_CSS * scale, CELL_EDGE_M * ppm);
    const fadeFactor = FADE_MIN + this.settings.fade * FADE_SPREAD;
    const floorFeather = FLOOR_FEATHER_CSS * scale;
    const outerOf = (core: number) => core + core * fadeFactor + floorFeather;
    const cellOuter = outerOf(cellCore);
    const margin = cellOuter + 4;

    // Cheap lat/lng pre-filter: convert the on-screen extent back to metres.
    const b = this.map.getBounds();
    const cLat = this.map.getCenter().lat;
    const padM = cellOuter / Math.max(ppm, 1e-9) + CELL_EDGE_M * 2;
    const latPad = padM / 111320;
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

    // …then carve the candlelight out of it.
    ctx.globalCompositeOperation = "destination-out";
    for (const cell of this.cells) {
      if (cell.lng < west || cell.lng > east || cell.lat < south || cell.lat > north) continue;
      const p = this.map.project([cell.lng, cell.lat]);
      const x = p.x * scale;
      const y = p.y * scale;
      if (x < -margin || x > W + margin || y < -margin || y > H + margin) continue;
      this.punch(x, y, cellCore, cellOuter);
    }
    for (const pin of this.pins) {
      const p = this.map.project([pin.lng, pin.lat]);
      const x = p.x * scale;
      const y = p.y * scale;
      const core = Math.max(cellCore, pin.radiusM * ppm);
      const outer = outerOf(core);
      if (x < -outer || x > W + outer || y < -outer || y > H + outer) continue;
      this.punch(x, y, core, outer);
    }
    ctx.globalCompositeOperation = "source-over";
  }
}
