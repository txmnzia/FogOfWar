import { latLngToCell, cellToLatLng } from "h3-js";
import { H3_RES } from "./constants";
import type { Cell } from "./types";

export function pointToCellIndex(lat: number, lng: number): string {
  return latLngToCell(lat, lng, H3_RES);
}

export function cellFromIndex(h3: string): Cell {
  const [lat, lng] = cellToLatLng(h3);
  return { h3, lat, lng };
}

/** Dedup a stream of points into unique H3 cell indexes. */
export function pointsToCellIndexes(points: Array<[number, number]>): Set<string> {
  const set = new Set<string>();
  for (const [lat, lng] of points) {
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      set.add(latLngToCell(lat, lng, H3_RES));
    }
  }
  return set;
}
