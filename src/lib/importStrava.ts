import JSZip from "jszip";
import { ungzip } from "pako";
import FitParser from "fit-file-parser";
import { pointsToCellIndexes } from "./h3";

type Pt = [number, number];

const ACTIVITY_RE = /\.(gpx|tcx|fit)(\.gz)?$/i;

function valid(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

/** GPX (lat/lon attributes) and TCX (LatitudeDegrees/LongitudeDegrees elements). */
function parseXml(text: string): Pt[] {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const pts: Pt[] = [];

  for (const tag of ["trkpt", "rtept", "wpt"]) {
    const els = doc.getElementsByTagName(tag);
    for (let i = 0; i < els.length; i++) {
      const lat = parseFloat(els[i].getAttribute("lat") || "");
      const lon = parseFloat(els[i].getAttribute("lon") || "");
      if (valid(lat, lon)) pts.push([lat, lon]);
    }
  }

  const tps = doc.getElementsByTagName("Trackpoint");
  for (let i = 0; i < tps.length; i++) {
    const latEl = tps[i].getElementsByTagName("LatitudeDegrees")[0];
    const lonEl = tps[i].getElementsByTagName("LongitudeDegrees")[0];
    if (latEl && lonEl) {
      const lat = parseFloat(latEl.textContent || "");
      const lon = parseFloat(lonEl.textContent || "");
      if (valid(lat, lon)) pts.push([lat, lon]);
    }
  }

  return pts;
}

function isFit(data: Uint8Array): boolean {
  // FIT files carry the ".FIT" signature at bytes 8..11 of the header.
  return (
    data.length > 12 &&
    data[8] === 0x2e &&
    data[9] === 0x46 &&
    data[10] === 0x49 &&
    data[11] === 0x54
  );
}

async function parseFit(data: Uint8Array): Promise<Pt[]> {
  const parser = new FitParser({ mode: "list", force: true });
  // Pass an exact-length ArrayBuffer (data may be a view into a larger buffer).
  const parsed = await parser.parseAsync(data.slice().buffer);
  const recs = (parsed?.records ?? []) as Array<{ position_lat?: number; position_long?: number }>;
  const pts: Pt[] = [];
  for (const r of recs) {
    if (typeof r.position_lat === "number" && typeof r.position_long === "number" && valid(r.position_lat, r.position_long)) {
      pts.push([r.position_lat, r.position_long]);
    }
  }
  return pts;
}

async function parseActivity(name: string, data: Uint8Array): Promise<Pt[]> {
  if (/\.fit$/i.test(name) || isFit(data)) return parseFit(data);
  return parseXml(new TextDecoder().decode(data));
}

export interface StravaProgress {
  file: string;
  index: number;
  total: number;
}

export interface StravaResult {
  cells: Set<string>;
  points: number;
  activities: number;
}

/**
 * Extract explored H3 cells from Strava files: either the whole export .zip, or
 * loose .gpx/.tcx/.fit files (gzipped or not). Files are processed one at a time
 * and reduced to cells as we go, so a large archive stays light on memory.
 */
export async function extractCellsFromStrava(
  files: File[],
  onProgress?: (p: StravaProgress) => void,
): Promise<StravaResult> {
  type Item = { name: string; bytes: () => Promise<Uint8Array> };
  const items: Item[] = [];

  for (const f of files) {
    if (/\.zip$/i.test(f.name) || f.type === "application/zip" || f.type === "application/x-zip-compressed") {
      const zip = await JSZip.loadAsync(f);
      zip.forEach((path, entry) => {
        if (!entry.dir && ACTIVITY_RE.test(path)) {
          items.push({ name: path.split("/").pop() || path, bytes: () => entry.async("uint8array") });
        }
      });
    } else if (ACTIVITY_RE.test(f.name)) {
      items.push({ name: f.name, bytes: async () => new Uint8Array(await f.arrayBuffer()) });
    }
  }

  const cells = new Set<string>();
  let points = 0;
  let activities = 0;

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    onProgress?.({ file: it.name, index: i + 1, total: items.length });
    try {
      let data = await it.bytes();
      let name = it.name;
      if (/\.gz$/i.test(name)) {
        data = ungzip(data);
        name = name.replace(/\.gz$/i, "");
      }
      const pts = await parseActivity(name, data);
      if (pts.length) {
        activities++;
        points += pts.length;
        for (const idx of pointsToCellIndexes(pts)) cells.add(idx);
      }
    } catch {
      // Skip any file we can't read rather than failing the whole import.
    }
    // Yield to the UI periodically so the progress bar can paint.
    if (i % 4 === 0) await new Promise((r) => setTimeout(r, 0));
  }

  return { cells, points, activities };
}
