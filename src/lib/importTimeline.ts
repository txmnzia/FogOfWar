// Robust extractor for Google location exports. Google has shipped several
// incompatible shapes over the years (Takeout Records.json, Takeout Semantic
// Location History, and the new on-device Timeline export), and they keep
// changing. Rather than special-casing each, we walk the whole JSON tree and
// pull out every coordinate we recognise — resilient to format drift.

type Pt = [number, number];

const LATLNG_RE = /(-?\d+(?:\.\d+)?)\s*°?\s*,\s*(-?\d+(?:\.\d+)?)\s*°?/;

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

function pushLatLngString(s: string, out: Pt[]) {
  const m = s.replace(/^geo:/, "").match(LATLNG_RE);
  if (m) {
    const lat = parseFloat(m[1]);
    const lng = parseFloat(m[2]);
    if (valid(lat, lng)) out.push([lat, lng]);
  }
}

function walk(node: unknown, out: Pt[], depth: number) {
  if (node == null || depth > 40) return;

  if (typeof node === "string") {
    if (node.includes(",")) pushLatLngString(node, out);
    return;
  }
  if (typeof node !== "object") return;

  if (Array.isArray(node)) {
    for (const v of node) walk(v, out, depth + 1);
    return;
  }

  const obj = node as Record<string, unknown>;

  // E7 integer pairs (Takeout).
  if (typeof obj.latitudeE7 === "number" && typeof obj.longitudeE7 === "number") {
    const lat = (obj.latitudeE7 as number) / 1e7;
    const lng = (obj.longitudeE7 as number) / 1e7;
    if (valid(lat, lng)) out.push([lat, lng]);
  }
  // Plain decimal pairs.
  if (typeof obj.latitude === "number" && typeof obj.longitude === "number") {
    if (valid(obj.latitude as number, obj.longitude as number)) out.push([obj.latitude as number, obj.longitude as number]);
  }
  if (typeof obj.lat === "number" && typeof obj.lng === "number") {
    if (valid(obj.lat as number, obj.lng as number)) out.push([obj.lat as number, obj.lng as number]);
  }
  // New Timeline export: "latLng" / "point" string fields.
  if (typeof obj.latLng === "string") pushLatLngString(obj.latLng as string, out);
  if (typeof obj.point === "string") pushLatLngString(obj.point as string, out);

  for (const key in obj) walk(obj[key], out, depth + 1);
}

/** Parse a Google export JSON file and return every coordinate found. */
export async function extractPointsFromFile(file: File): Promise<Pt[]> {
  const text = await file.text();
  const json = JSON.parse(text);
  const out: Pt[] = [];
  walk(json, out, 0);
  return out;
}
