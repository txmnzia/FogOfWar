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
 * Read many sidecar files with a bounded number of reads in flight at once, so
 * a huge archive (tens of thousands of files) isn't read one-at-a-time. Reports
 * progress as each file resolves and returns every coordinate found.
 */
export async function collectPhotoPoints(
  files: File[],
  onProgress?: (read: number, total: number, found: number) => void,
  concurrency = 12,
): Promise<Array<[number, number]>> {
  const points: Array<[number, number]> = [];
  let read = 0;
  let next = 0;

  async function worker() {
    while (next < files.length) {
      const file = files[next++];
      let text = "";
      try {
        text = await file.text();
      } catch {
        text = ""; // Unreadable file — skip it rather than abort the whole run.
      }
      const pt = text ? coordFromSidecar(text) : null;
      if (pt) points.push(pt);
      read++;
      if (read % 250 === 0 || read === files.length) onProgress?.(read, files.length, points.length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
  return points;
}

/**
 * Expand a set of photo coordinates into unique H3 cell indexes, each grown to
 * a small candlelight so a lone photo reads as a visited spot, not a pinprick.
 * Yields to the event loop every few thousand points so the UI keeps painting
 * (and progress keeps updating) on a large archive instead of locking up.
 */
export async function photosToCellIndexes(
  points: Array<[number, number]>,
  onProgress?: (done: number, total: number) => void,
): Promise<Set<string>> {
  const out = new Set<string>();
  const total = points.length;
  for (let i = 0; i < total; i++) {
    const [lat, lng] = points[i];
    const cell = latLngToCell(lat, lng, H3_RES);
    for (const c of gridDisk(cell, RING)) out.add(c);
    if ((i + 1) % 3000 === 0) {
      onProgress?.(i + 1, total);
      await new Promise((r) => setTimeout(r)); // let the browser repaint
    }
  }
  onProgress?.(total, total);
  return out;
}
