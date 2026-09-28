import type { Map as MlMap } from "maplibre-gl";
import { cellToParent, cellToLatLng, getHexagonEdgeLengthAvg } from "h3-js";
import { H3_RES, type FogSettings } from "../lib/constants";
import type { Cell, Pin } from "../lib/types";

// H3 resolutions we pre-aggregate to, finest → coarsest. When zoomed out we
// draw a coarse level (few big cells) instead of every fine cell, so the number
// of shapes drawn depends on the screen, not on how much history you have.
const LADDER = [H3_RES, 8, 7, 6, 5, 4, 3, 2];
// Aggregate to a coarser level once a cell would draw smaller than this (CSS px).
const MIN_DRAW_CSS = 5;
// Each cell's clear core is drawn a bit wider than its own radius so neighbours
// overlap into a smooth region instead of a beaded chain of discs.
const CORE_MULT = 1.45;
const FADE_MIN = 0.6; // fade=0 → tight halo
const FADE_SPREAD = 2.6; // fade=1 → halo ~3x the core radius
const SPRITE_R = 128; // cached candlelight sprite radius (px)

interface Level {
  res: number;
  edgeM: number;
  /** Flat [lat, lng, lat, lng, …] of the (deduped) cell centres at this res. */
  pts: Float64Array;
}

/**
 * Candlelight fog as a canvas overlay synced to the map.
 *
 * Per explored cell we blit a cached radial "candlelight" sprite with
 * `destination-out`: fully clear at the centre, fading gently to the dark. A
 * single visit is fully bright; overlaps can't exceed full clarity; the edge is
 * always a soft progressive falloff. Cells are pre-aggregated into an H3 pyramid
 * so a zoomed-out view draws a handful of coarse cells instead of tens of
 * thousands — keeping pan/zoom smooth no matter how big the history is.
 */
export class FogLayer {
  private map: MlMap;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private sprite: HTMLCanvasElement;
  private levels: Level[] = [];
  private lastCells: Cell[] | null = null;
  private pins: Pin[] = [];
  private settings: FogSettings;
  private spriteFade = -1;
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
    this.sprite = document.createElement("canvas");
    this.sprite.width = this.sprite.height = SPRITE_R * 2;

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
    // Only rebuild the (relatively expensive) H3 pyramid when the cell set
    // actually changes — not when just the pins change (e.g. dragging a radius).
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

  /** Aggregate the fine cells into deduped parent-cell centres at each level. */
  private buildPyramid(cells: Cell[]) {
    this.levels = LADDER.map((res) => {
      const set = new Set<string>();
      for (const c of cells) set.add(res === H3_RES ? c.h3 : cellToParent(c.h3, res));
      const pts = new Float64Array(set.size * 2);
      let i = 0;
      for (const h3 of set) {
        const [lat, lng] = cellToLatLng(h3);
        pts[i++] = lat;
        pts[i++] = lng;
      }
      return { res, edgeM: getHexagonEdgeLengthAvg(res, "m"), pts };
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

  /** Rebuild the cached candlelight sprite for the current fade setting. */
  private buildSprite(fadeFactor: number) {
    const c = 1 / (1 + fadeFactor); // fraction of the radius that is fully clear
    const sctx = this.sprite.getContext("2d")!;
    sctx.clearRect(0, 0, SPRITE_R * 2, SPRITE_R * 2);
    const g = sctx.createRadialGradient(SPRITE_R, SPRITE_R, 0, SPRITE_R, SPRITE_R, SPRITE_R);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(c, "rgba(255,255,255,1)");
    g.addColorStop(c + (1 - c) * 0.25, "rgba(255,255,255,0.68)");
    g.addColorStop(c + (1 - c) * 0.5, "rgba(255,255,255,0.36)");
    g.addColorStop(c + (1 - c) * 0.75, "rgba(255,255,255,0.14)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    sctx.fillStyle = g;
    sctx.beginPath();
    sctx.arc(SPRITE_R, SPRITE_R, SPRITE_R, 0, Math.PI * 2);
    sctx.fill();
    this.spriteFade = fadeFactor;
  }

  private render() {
    const scale = this.resize();
    const W = this.canvas.width;
    const H = this.canvas.height;
    const ctx = this.ctx;

    const ppm = this.pixelsPerMeter(scale);
    const fadeFactor = FADE_MIN + this.settings.fade * FADE_SPREAD;
    if (fadeFactor !== this.spriteFade) this.buildSprite(fadeFactor);

    // Dark veil over everything…
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = `rgba(20,14,7,${this.settings.darkness})`;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "destination-out";

    // …choose the coarsest-detail level whose cells are still ≥ MIN_DRAW on
    // screen, so we draw few shapes when zoomed out.
    const minPx = MIN_DRAW_CSS * scale;
    const level =
      this.levels.find((l) => l.edgeM * ppm >= minPx) ?? this.levels[this.levels.length - 1];

    if (level && level.pts.length) {
      const coreR = level.edgeM * ppm * CORE_MULT;
      const outer = coreR * (1 + fadeFactor);
      const margin = outer + 4;

      const b = this.map.getBounds();
      const cLat = this.map.getCenter().lat;
      const latPad = outer / Math.max(ppm, 1e-9) / 111320 + level.edgeM / 111320;
      const lngPad = latPad / Math.max(0.15, Math.cos((cLat * Math.PI) / 180));
      const west = b.getWest() - lngPad;
      const east = b.getEast() + lngPad;
      const south = b.getSouth() - latPad;
      const north = b.getNorth() + latPad;

      const d = outer * 2;
      const pts = level.pts;
      for (let i = 0; i < pts.length; i += 2) {
        const lat = pts[i];
        const lng = pts[i + 1];
        if (lng < west || lng > east || lat < south || lat > north) continue;
        const p = this.map.project([lng, lat]);
        const x = p.x * scale;
        const y = p.y * scale;
        if (x < -margin || x > W + margin || y < -margin || y > H + margin) continue;
        ctx.drawImage(this.sprite, x - outer, y - outer, d, d);
      }
    }

    // Pins render at their own (larger) radius, always at full detail.
    for (const pin of this.pins) {
      const p = this.map.project([pin.lng, pin.lat]);
      const x = p.x * scale;
      const y = p.y * scale;
      const core = Math.max(MIN_DRAW_CSS * scale, pin.radiusM * ppm);
      const outer = core * (1 + fadeFactor);
      if (x < -outer || x > W + outer || y < -outer || y > H + outer) continue;
      ctx.drawImage(this.sprite, x - outer, y - outer, outer * 2, outer * 2);
    }

    ctx.globalCompositeOperation = "source-over";
  }
}
