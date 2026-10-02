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
  title?: string;
  photoTakenTime?: { timestamp?: string };
  geoData?: Geo;
  geoDataExif?: Geo;
  googlePhotosOrigin?: Record<string, unknown>;
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
  return coordFromJson(json);
}

function coordFromJson(json: Sidecar): [number, number] | null {
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

// ---- Diagnostics ----------------------------------------------------------
// Every sidecar gets an outcome so a low yield can be explained: was the
// location really absent, or did Takeout drop it while the photo kept its GPS?

export type Outcome =
  | "located" // the sidecar carried a usable location
  | "no-location" // a photo sidecar with 0/0 or no geo fields
  | "not-photo" // JSON without a photo title/timestamp (album metadata etc.)
  | "unreadable"; // couldn't read or parse the file

export interface PhotoRecord {
  path: string;
  title: string;
  kind: "photo" | "video" | "screenshot" | "other";
  outcome: Outcome;
  /** Where Google says the item came from (e.g. "mobileUpload:ANDROID_PHONE"). */
  origin: string;
  takenAt: string;
  /** For no-location items: what the media file itself says, if it was selected. */
  fileGps: "yes" | "no" | "no-file" | "unsupported" | "";
  cameraMake: string;
  cameraModel: string;
  lat: number | null;
  lng: number | null;
}

const VIDEO_EXT = /\.(mp4|mov|m4v|3gp|avi|mkv|webm|mts|m2ts|mpg|mpeg)$/i;
const EXIF_EXT = /\.(jpe?g|heic|heif|tiff?|dng|cr2|nef|arw|orf|rw2|png|webp|avif)$/i;
const SCREENSHOT = /screen ?shot|capture d.?[ée]cran|bildschirmfoto|captura de pantalla|schermata|screen_?\d/i;

function kindOf(title: string): PhotoRecord["kind"] {
  if (!title) return "other";
  if (VIDEO_EXT.test(title)) return "video";
  if (SCREENSHOT.test(title)) return "screenshot";
  return "photo";
}

function originOf(o: Record<string, unknown> | undefined): string {
  if (!o) return "";
  return Object.entries(o)
    .map(([k, v]) => {
      const dt = v && typeof v === "object" ? (v as Record<string, unknown>).deviceType : undefined;
      return typeof dt === "string" ? `${k}:${dt}` : k;
    })
    .join("+");
}

function dirOf(f: File): string {
  const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
  const i = rel.lastIndexOf("/");
  return i < 0 ? "" : rel.slice(0, i);
}

/** "IMG_1.jpg.supplemental-metadata(1).json" → "IMG_1(1).jpg" style best guess. */
function mediaNameFromSidecar(name: string): string {
  let base = name.replace(/\.json$/i, "");
  const dup = base.match(/(\(\d+\))$/)?.[1] ?? "";
  if (dup) base = base.slice(0, -dup.length);
  // Drop the (possibly truncated) ".supplemental-metadata" suffix.
  base = base.replace(/\.su(p[a-z-]*)?$|\.s$/i, "");
  if (!dup) return base;
  const dot = base.lastIndexOf(".");
  return dot < 0 ? base + dup : base.slice(0, dot) + dup + base.slice(dot);
}

function pathOf(f: File): string {
  return (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
}

async function exifOf(file: File): Promise<Pick<PhotoRecord, "fileGps" | "cameraMake" | "cameraModel" | "lat" | "lng">> {
  if (!EXIF_EXT.test(file.name)) {
    return { fileGps: "unsupported", cameraMake: "", cameraModel: "", lat: null, lng: null };
  }
  try {
    const exifr = (await import("exifr")).default;
    // EXIF sits in the first segments of a JPEG/PNG/WebP, so a header slice is
    // enough; HEIC/RAW can place it anywhere, so those read the whole file.
    const head = /\.(jpe?g|png|webp)$/i.test(file.name) ? file.slice(0, 256 * 1024) : file;
    const t = await exifr.parse(await head.arrayBuffer(), { tiff: true, gps: true, exif: false, xmp: false, icc: false, iptc: false, jfif: false, ihdr: false });
    const lat = typeof t?.latitude === "number" ? t.latitude : null;
    const lng = typeof t?.longitude === "number" ? t.longitude : null;
    const ok = lat !== null && lng !== null && coordFrom({ latitude: lat, longitude: lng }) !== null;
    return {
      fileGps: ok ? "yes" : "no",
      cameraMake: String(t?.Make ?? "").trim(),
      cameraModel: String(t?.Model ?? "").trim(),
      lat: ok ? lat : null,
      lng: ok ? lng : null,
    };
  } catch {
    return { fileGps: "no", cameraMake: "", cameraModel: "", lat: null, lng: null };
  }
}

/**
 * Read many sidecar files with a bounded number of reads in flight at once, so
 * a huge archive (tens of thousands of files) isn't read one-at-a-time. Reports
 * progress as each file resolves and returns every coordinate found, plus one
 * diagnostic record per sidecar. `media` (the rest of the selected folder) is
 * used only to look inside the photo when its sidecar has no location.
 */
export async function collectPhotoPoints(
  files: File[],
  onProgress?: (read: number, total: number, found: number) => void,
  media: File[] = [],
  concurrency = 12,
): Promise<{ points: Array<[number, number]>; records: PhotoRecord[] }> {
  const points: Array<[number, number]> = [];
  const records: PhotoRecord[] = [];
  const mediaByKey = new Map<string, File>();
  for (const m of media) mediaByKey.set(dirOf(m) + "/" + m.name, m);
  let read = 0;
  let next = 0;

  async function worker() {
    while (next < files.length) {
      const file = files[next++];
      const rec: PhotoRecord = {
        path: pathOf(file),
        title: "",
        kind: "other",
        outcome: "unreadable",
        origin: "",
        takenAt: "",
        fileGps: "",
        cameraMake: "",
        cameraModel: "",
        lat: null,
        lng: null,
      };
      let json: Sidecar | null = null;
      try {
        json = JSON.parse(await file.text());
      } catch {
        json = null; // Unreadable file — skip it rather than abort the whole run.
      }
      if (json && typeof json === "object") {
        rec.title = typeof json.title === "string" ? json.title : "";
        const isPhoto = !!rec.title && (json.photoTakenTime !== undefined || json.geoData !== undefined);
        rec.kind = kindOf(rec.title);
        rec.origin = originOf(json.googlePhotosOrigin);
        const ts = Number(json.photoTakenTime?.timestamp);
        rec.takenAt = Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString().slice(0, 10) : "";
        const pt = coordFromJson(json);
        if (pt) {
          points.push(pt);
          rec.outcome = "located";
          [rec.lat, rec.lng] = pt;
        } else if (isPhoto) {
          rec.outcome = "no-location";
          const dir = dirOf(file) + "/";
          const m = mediaByKey.get(dir + rec.title) ?? mediaByKey.get(dir + mediaNameFromSidecar(file.name));
          if (!m) rec.fileGps = media.length ? "no-file" : "";
          else Object.assign(rec, await exifOf(m));
        } else {
          rec.outcome = "not-photo";
          rec.kind = "other";
        }
      }
      records.push(rec);
      read++;
      if (read % 250 === 0 || read === files.length) onProgress?.(read, files.length, points.length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
  records.sort((a, b) => a.path.localeCompare(b.path));
  return { points, records };
}

export interface PhotoSummary {
  sidecars: number;
  photos: number;
  located: number;
  noLocation: number;
  notPhoto: number;
  unreadable: number;
  /** No-location items broken down by kind. */
  missingByKind: Record<PhotoRecord["kind"], number>;
  /** No-location photos whose own file still carries GPS (Takeout dropped it). */
  gpsOnlyInFile: number;
  /** No-location items we could inspect (media file present and readable type). */
  inspected: number;
}

export function summarize(records: PhotoRecord[]): PhotoSummary {
  const s: PhotoSummary = {
    sidecars: records.length,
    photos: 0,
    located: 0,
    noLocation: 0,
    notPhoto: 0,
    unreadable: 0,
    missingByKind: { photo: 0, video: 0, screenshot: 0, other: 0 },
    gpsOnlyInFile: 0,
    inspected: 0,
  };
  for (const r of records) {
    if (r.outcome === "located") s.located++;
    else if (r.outcome === "no-location") {
      s.noLocation++;
      s.missingByKind[r.kind]++;
      if (r.fileGps === "yes" || r.fileGps === "no") s.inspected++;
      if (r.fileGps === "yes") s.gpsOnlyInFile++;
    } else if (r.outcome === "not-photo") s.notPhoto++;
    else s.unreadable++;
  }
  s.photos = s.located + s.noLocation;
  return s;
}

export function recordsToCsv(records: PhotoRecord[]): string {
  const cols: Array<keyof PhotoRecord> = [
    "path", "title", "kind", "outcome", "origin", "takenAt", "fileGps", "cameraMake", "cameraModel", "lat", "lng",
  ];
  const esc = (v: unknown) => {
    const t = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  };
  return [cols.join(","), ...records.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
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

// ---- Plain location files (iCloud via a Mac, exiftool, …) -----------------
// iCloud exports have no sidecars, and the photos themselves can be 100+ GB.
// On a Mac, osxphotos reads every location straight from the Photos database
// (no originals downloaded), so we accept any CSV/JSON listing coordinates.

const LAT_KEYS = ["latitude", "lat", "gpslatitude"];
const LNG_KEYS = ["longitude", "lng", "lon", "long", "gpslongitude"];

function num(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function pick(o: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of Object.keys(o)) if (keys.includes(k.toLowerCase())) return num(o[k]);
  return undefined;
}

function coordFromObject(o: unknown): [number, number] | null {
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  let lat = pick(r, LAT_KEYS);
  let lng = pick(r, LNG_KEYS);
  // osxphotos also writes location: [lat, lng].
  if ((lat === undefined || lng === undefined) && Array.isArray(r.location)) {
    lat = num(r.location[0]);
    lng = num(r.location[1]);
  }
  return coordFrom({ latitude: lat, longitude: lng });
}

/** Minimal RFC 4180 CSV reader: quoted fields may hold delimiters, quotes, newlines. */
function parseCsv(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * Read coordinates from a CSV or JSON location list: osxphotos output, an
 * exiftool `-n -csv` dump, or anything with latitude/longitude (lat/lng)
 * columns or fields. Rows without a usable fix are counted but skipped.
 */
export function pointsFromLocationFile(text: string): { points: Array<[number, number]>; rows: number } {
  const t = text.replace(/^﻿/, "").trim();
  const points: Array<[number, number]> = [];

  if (t.startsWith("[") || t.startsWith("{")) {
    const json: unknown = JSON.parse(t);
    const items = Array.isArray(json)
      ? json
      : Object.values(json as Record<string, unknown>).find(Array.isArray) ?? [json];
    for (const it of items) {
      const p = coordFromObject(it);
      if (p) points.push(p);
    }
    return { points, rows: items.length };
  }

  const first = t.slice(0, t.search(/\r?\n|$/));
  const delim = [",", ";", "\t"].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const [header, ...body] = parseCsv(t, delim);
  const cols = (header ?? []).map((h) => h.trim().toLowerCase());
  const li = cols.findIndex((c) => LAT_KEYS.includes(c));
  const gi = cols.findIndex((c) => LNG_KEYS.includes(c));
  if (li < 0 || gi < 0) {
    throw new Error("Couldn't find latitude/longitude columns in that file.");
  }
  const rows = body.filter((r) => r.some((v) => v.trim() !== ""));
  for (const r of rows) {
    const p = coordFrom({ latitude: num(r[li]), longitude: num(r[gi]) });
    if (p) points.push(p);
  }
  return { points, rows: rows.length };
}
