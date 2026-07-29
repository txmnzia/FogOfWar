import { getHexagonEdgeLengthAvg } from "h3-js";

// Resolution of the exploration grid. Res 9 ≈ 174 m average hex edge
// (~0.1 km² cells) — fine enough to feel a city block, coarse enough that a
// heavily-travelled life is still only tens of thousands of cells.
export const H3_RES = 9;

// Average edge length of an H3 cell at H3_RES, in metres. Used to size the
// "lit" disc we draw per explored cell so adjacent cells join seamlessly.
export const CELL_EDGE_M = getHexagonEdgeLengthAvg(H3_RES, "m");

export const DEFAULT_CENTER: [number, number] = [2.3522, 48.8566]; // Paris
export const DEFAULT_ZOOM = 5;

export interface FogSettings {
  /** Opacity of the veil over unexplored world, 0..1. */
  darkness: number;
  /** How far candlelight bleeds past explored land, in metres. */
  reachM: number;
}

export const DEFAULT_SETTINGS: FogSettings = {
  darkness: 0.72,
  reachM: 450,
};

export const SETTINGS_BOUNDS = {
  darkness: { min: 0.35, max: 0.9, step: 0.01 },
  reachM: { min: 100, max: 2500, step: 25 },
};
