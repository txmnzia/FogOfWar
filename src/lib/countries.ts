import type { Cell, Pin } from "./types";

// Country borders (Natural Earth 1:110m via world-atlas, ~100 KB) used to decide
// which kingdoms the user has set foot in. Coarse on purpose: borders are off by
// 10–20 km and microstates (Monaco, Andorra, Malta…) are missing, which is fine
// for "have I been to this country at all".

type Ring = Array<[number, number]>; // [lng, lat]
type Polygon = Ring[]; // outer ring first, then holes

export interface Country {
  name: string;
  /** Where the crest sits: the visual centre of the largest landmass. */
  lng: number;
  lat: number;
  polygons: Polygon[];
  bbox: [number, number, number, number]; // minLng, minLat, maxLng, maxLat
}

// world-atlas abbreviates some names; spell them out for the map.
const NAME_FIX: Record<string, string> = {
  "United States of America": "United States",
  "Dem. Rep. Congo": "DR Congo",
  "Dominican Rep.": "Dominican Republic",
  "Falkland Is.": "Falkland Islands",
  "Fr. S. Antarctic Lands": "French Southern Lands",
  "Central African Rep.": "Central African Republic",
  "Eq. Guinea": "Equatorial Guinea",
  eSwatini: "Eswatini",
  "Solomon Is.": "Solomon Islands",
  "N. Cyprus": "Northern Cyprus",
  "Bosnia and Herz.": "Bosnia and Herzegovina",
  "S. Sudan": "South Sudan",
  "W. Sahara": "Western Sahara",
};

// The pole of inaccessibility is a good crest spot for most shapes, but not for
// a boot: Italy's lands in the Po valley. Hand-placed exceptions, [lng, lat].
const LABEL_FIX: Record<string, [number, number]> = {
  Italy: [12.6, 42.9],
};

// Coastal places can fall just outside the coarse 1:110m outlines (Palermo,
// small islands), so a point outside every country snaps to the nearest one
// within this distance.
const SNAP_KM = 30;

let loading: Promise<Country[]> | null = null;

/** Load (once) and prepare the country borders. */
export function loadCountries(): Promise<Country[]> {
  if (!loading) loading = build();
  return loading;
}

async function build(): Promise<Country[]> {
  const [{ feature }, polylabel, topo] = await Promise.all([
    import("topojson-client"),
    import("polylabel").then((m) => m.default),
    import("world-atlas/countries-110m.json").then((m) => m.default),
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fc = feature(topo as any, (topo as any).objects.countries) as unknown as GeoJSON.FeatureCollection;
  const out: Country[] = [];
  for (const f of fc.features) {
    const g = f.geometry;
    if (!g) continue;
    const polygons: Polygon[] =
      g.type === "Polygon"
        ? [g.coordinates as Polygon]
        : g.type === "MultiPolygon"
          ? (g.coordinates as Polygon[])
          : [];
    if (polygons.length === 0) continue;
    const raw = String((f.properties as { name?: string } | null)?.name ?? "");
    if (!raw || raw === "Antarctica") continue;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let main = polygons[0];
    let mainArea = -1;
    for (const p of polygons) {
      for (const [x, y] of p[0]) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      const a = Math.abs(ringArea(p[0]));
      if (a > mainArea) {
        mainArea = a;
        main = p;
      }
    }
    const name = NAME_FIX[raw] ?? raw;
    const [lng, lat] = LABEL_FIX[name] ?? polylabel(main, 0.05);
    out.push({ name, lng, lat, polygons, bbox: [minX, minY, maxX, maxY] });
  }
  return out;
}

function ringArea(r: Ring): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]);
  return a / 2;
}

function inRing(x: number, y: number, r: Ring): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i];
    const [xj, yj] = r[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function contains(c: Country, lng: number, lat: number): boolean {
  const [a, b, cc, d] = c.bbox;
  if (lng < a || lng > cc || lat < b || lat > d) return false;
  for (const p of c.polygons) {
    if (!inRing(lng, lat, p[0])) continue;
    let hole = false;
    for (let k = 1; k < p.length && !hole; k++) hole = inRing(lng, lat, p[k]);
    if (!hole) return true;
  }
  return false;
}

/** Countries containing at least one explored cell or pin. */
export function discoveredCountries(countries: Country[], cells: Cell[], pins: Pin[]): Country[] {
  // The borders are only good to ~10 km, so snap points to a ~5 km grid first:
  // tens of thousands of cells collapse to a few hundred tests.
  const seen = new Set<string>();
  const pts: Array<[number, number]> = [];
  const add = (lng: number, lat: number) => {
    const k = Math.round(lng * 20) + "|" + Math.round(lat * 20);
    if (seen.has(k)) return;
    seen.add(k);
    pts.push([lng, lat]);
  };
  for (const c of cells) add(c.lng, c.lat);
  for (const p of pins) add(p.lng, p.lat);

  const found = new Set<Country>();
  for (const [lng, lat] of pts) {
    let hit = false;
    for (const c of countries) {
      if (contains(c, lng, lat)) {
        found.add(c);
        hit = true;
        break;
      }
    }
    if (!hit) {
      const near = nearest(countries, lng, lat);
      if (near) found.add(near);
    }
  }
  return countries.filter((c) => found.has(c));
}

/** Nearest country whose outline is within SNAP_KM of the point, if any. */
function nearest(countries: Country[], lng: number, lat: number): Country | null {
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180);
  const ky = 110.57;
  const padLat = SNAP_KM / ky;
  const padLng = SNAP_KM / Math.max(kx, 1);
  let best: Country | null = null;
  let bestD = SNAP_KM;
  for (const c of countries) {
    const [a, b, cc, d] = c.bbox;
    if (lng < a - padLng || lng > cc + padLng || lat < b - padLat || lat > d + padLat) continue;
    for (const p of c.polygons) {
      const r = p[0];
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        // Distance to segment in a local km plane.
        const ax = (r[j][0] - lng) * kx, ay = (r[j][1] - lat) * ky;
        const bx = (r[i][0] - lng) * kx, by = (r[i][1] - lat) * ky;
        const dx = bx - ax, dy = by - ay;
        const len = dx * dx + dy * dy;
        const t = len > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
        const dist = Math.hypot(ax + t * dx, ay + t * dy);
        if (dist < bestD) {
          bestD = dist;
          best = c;
        }
      }
    }
  }
  return best;
}
