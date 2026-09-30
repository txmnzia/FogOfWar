import { latLngToCell, gridDisk } from "h3-js";
import { H3_RES } from "./constants";

// Google Takeout writes one JSON sidecar per photo. Depending on the export
// vintage it's named "<photo>.jpg.supplemental-metadata.json", the older
// "<photo>.jpg.json", or a truncated variant. Each holds the photo's location
// under geoData (Google's best guess) and/or geoDataExif (straight from the
// file's EXIF). Coordinates are 0/0 when unknown.
interface Geo {
  latitude?: number;
  longitude?: number;
}
interface Sidecar {
  geoData?: Geo;
  geoDataExif?: Geo;
}

const RING = 1; // gridDisk radius → small "candlelight" of 7 res-9 cells per photo.

function coordFrom(g?: Geo): [number, number] | null {
  if (!g) return null;
  const { latitude: lat, longitude: lng } = g;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  // Takeout uses exactly 0/0 as "no location". A real Gulf-of-Guinea photo is
  // vanishingly unlikely and not worth a false reveal there.
  if (lat === 0 && lng === 0) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return [lat, lng];
}

/** Pull a [lat,lng] from one Takeout sidecar, or null if it carries no fix. */
export function coordFromSidecar(text: string): [number, number] | null {
  let json: Sidecar;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  // Prefer Google's resolved location, fall back to the photo's own EXIF.
  return coordFrom(json.geoData) ?? coordFrom(json.geoDataExif);
}

/** A Takeout sidecar is a JSON file sitting next to a media file. */
export function isSidecar(name: string): boolean {
  const n = name.toLowerCase();
  if (!n.endsWith(".json")) return false;
  // Album/export bookkeeping files carry no per-photo geoData; skip the obvious
  // ones so we don't waste time parsing them (harmless if one slips through).
  if (n === "metadata.json" || n === "print-subscriptions.json" || n === "shared_album_comments.json") {
    return false;
  }
  return true;
}

/**
 * Expand a set of photo coordinates into unique H3 cell indexes, each grown to
 * a small candlelight so a lone photo reads as a visited spot, not a pinprick.
 */
export function photosToCellIndexes(points: Array<[number, number]>): Set<string> {
  const out = new Set<string>();
  for (const [lat, lng] of points) {
    const cell = latLngToCell(lat, lng, H3_RES);
    for (const c of gridDisk(cell, RING)) out.add(c);
  }
  return out;
}
