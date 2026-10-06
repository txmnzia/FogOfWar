import { supabase } from "../lib/supabase";
import type { Pin } from "../lib/types";
import { DEFAULT_SETTINGS, type FogSettings } from "../lib/constants";

function client() {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

/** Fetch every explored H3 index for the signed-in user (paginated). */
export async function fetchAllCellIndexes(): Promise<string[]> {
  const db = client();
  const page = 1000;
  const out: string[] = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await db
      .from("explored_cells")
      .select("h3")
      .range(from, from + page - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const row of data) out.push(row.h3 as string);
    if (data.length < page) break;
  }
  return out;
}

/**
 * Insert new explored cells, ignoring any that already exist. Returns count of
 * rows sent. Upserts are idempotent, so a failed run can simply be retried and
 * will skip whatever already landed. Each chunk is retried with backoff before
 * giving up, so a single network blip mid-import doesn't abort the whole thing.
 */
export async function addCells(
  userId: string,
  indexes: Iterable<string>,
  source: string,
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const db = client();
  const rows = Array.from(indexes, (h3) => ({ user_id: userId, h3, source }));
  const chunk = 1000;
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    let lastErr: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      const { error } = await db
        .from("explored_cells")
        .upsert(slice, { onConflict: "user_id,h3", ignoreDuplicates: true });
      if (!error) {
        lastErr = undefined;
        break;
      }
      lastErr = error;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt)); // 0.5s, 1s, 2s
    }
    if (lastErr) throw lastErr;
    onProgress?.(Math.min(i + chunk, rows.length), rows.length);
  }
  return rows.length;
}

export async function fetchPins(): Promise<Pin[]> {
  const db = client();
  const { data, error } = await db
    .from("pins")
    .select("id,name,lat,lng,radius_m,created_at")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    lat: r.lat as number,
    lng: r.lng as number,
    radiusM: r.radius_m as number,
    createdAt: r.created_at as string,
  }));
}

export async function addPin(
  userId: string,
  pin: { name: string; lat: number; lng: number; radiusM: number },
): Promise<Pin> {
  const db = client();
  const { data, error } = await db
    .from("pins")
    .insert({ user_id: userId, name: pin.name, lat: pin.lat, lng: pin.lng, radius_m: pin.radiusM })
    .select("id,name,lat,lng,radius_m,created_at")
    .single();
  if (error) throw error;
  return {
    id: data.id,
    name: data.name,
    lat: data.lat,
    lng: data.lng,
    radiusM: data.radius_m,
    createdAt: data.created_at,
  };
}

export async function updatePinRadius(id: string, radiusM: number): Promise<void> {
  const db = client();
  const { error } = await db.from("pins").update({ radius_m: radiusM }).eq("id", id);
  if (error) throw error;
}

export async function removePin(id: string): Promise<void> {
  const db = client();
  const { error } = await db.from("pins").delete().eq("id", id);
  if (error) throw error;
}

// `generosity` is a per-device display preference kept in localStorage, so it
// needs no column in the shared `settings` table (no SQL migration to run).
const GEN_KEY = "fow.generosity";
function readGenerosity(): number {
  try {
    const v = parseFloat(localStorage.getItem(GEN_KEY) ?? "");
    return Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : DEFAULT_SETTINGS.generosity;
  } catch {
    return DEFAULT_SETTINGS.generosity;
  }
}
function writeGenerosity(v: number) {
  try {
    localStorage.setItem(GEN_KEY, String(v));
  } catch {
    /* ignore */
  }
}

export async function fetchSettings(): Promise<FogSettings> {
  const db = client();
  const { data, error } = await db
    .from("settings")
    .select("darkness,fade")
    .maybeSingle();
  if (error) throw error;
  const generosity = readGenerosity();
  if (!data) return { ...DEFAULT_SETTINGS, generosity };
  return { darkness: data.darkness, fade: data.fade, generosity };
}

export async function saveSettings(userId: string, s: FogSettings): Promise<void> {
  writeGenerosity(s.generosity);
  const db = client();
  const { error } = await db
    .from("settings")
    .upsert({ user_id: userId, darkness: s.darkness, fade: s.fade }, { onConflict: "user_id" });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Backup / restore: everything the user owns, as one JSON file. Restore merges
// into whatever the signed-in account already has and never overwrites, so it
// also moves data between Supabase projects (rows are re-owned by whoever
// restores them).
// ---------------------------------------------------------------------------

export interface Backup {
  app: "fogofwar";
  version: 1;
  exportedAt: string;
  /** [h3, source, first_seen] */
  cells: [string, string, string][];
  pins: { name: string; lat: number; lng: number; radius_m: number; created_at: string }[];
  settings: { darkness: number; fade: number } | null;
}

export async function fetchBackup(onProgress?: (cells: number) => void): Promise<Backup> {
  const db = client();
  const page = 1000;
  const cells: Backup["cells"] = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await db
      .from("explored_cells")
      .select("h3,source,first_seen")
      .order("h3")
      .range(from, from + page - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data) cells.push([r.h3, r.source, r.first_seen]);
    onProgress?.(cells.length);
    if (data.length < page) break;
  }
  const { data: pins, error: pinErr } = await db
    .from("pins")
    .select("name,lat,lng,radius_m,created_at")
    .order("created_at", { ascending: true });
  if (pinErr) throw pinErr;
  const { data: settings, error: setErr } = await db
    .from("settings")
    .select("darkness,fade")
    .maybeSingle();
  if (setErr) throw setErr;
  return {
    app: "fogofwar",
    version: 1,
    exportedAt: new Date().toISOString(),
    cells,
    pins: pins ?? [],
    settings: settings ?? null,
  };
}

/** Accepts a full backup, or the older cells-only export (an array of H3 ids). */
export function parseBackup(json: unknown): Backup {
  if (Array.isArray(json) && json.every((x) => typeof x === "string")) {
    const now = new Date().toISOString();
    return {
      app: "fogofwar",
      version: 1,
      exportedAt: now,
      cells: json.map((h3) => [h3, "manual", now]),
      pins: [],
      settings: null,
    };
  }
  const b = json as Partial<Backup> | null;
  if (!b || b.app !== "fogofwar" || b.version !== 1 || !Array.isArray(b.cells) || !Array.isArray(b.pins)) {
    throw new Error("That file isn't a Fog of War backup.");
  }
  return b as Backup;
}

export async function restoreBackup(
  userId: string,
  b: Backup,
  onProgress?: (done: number, total: number) => void,
): Promise<{ cells: number; pins: number }> {
  const db = client();

  // Cells: insert-or-skip, keeping each cell's original source and date.
  const chunk = 1000;
  for (let i = 0; i < b.cells.length; i += chunk) {
    const rows = b.cells
      .slice(i, i + chunk)
      .map(([h3, source, first_seen]) => ({ user_id: userId, h3, source, first_seen }));
    let lastErr: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      const { error } = await db
        .from("explored_cells")
        .upsert(rows, { onConflict: "user_id,h3", ignoreDuplicates: true });
      if (!error) {
        lastErr = undefined;
        break;
      }
      lastErr = error;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
    if (lastErr) throw lastErr;
    onProgress?.(Math.min(i + chunk, b.cells.length), b.cells.length);
  }

  // Pins have no natural key: skip any already present at the same name and
  // spot, so restoring the same file twice doesn't duplicate them.
  const existing = await fetchPins();
  const key = (p: { name: string; lat: number; lng: number }) => `${p.name}|${p.lat}|${p.lng}`;
  const have = new Set(existing.map(key));
  const newPins = b.pins.filter((p) => !have.has(key(p)));
  if (newPins.length) {
    const { error } = await db.from("pins").insert(newPins.map((p) => ({ ...p, user_id: userId })));
    if (error) throw error;
  }

  // Settings: only fill in if this account has none yet.
  if (b.settings) {
    const { error } = await db
      .from("settings")
      .upsert({ user_id: userId, ...b.settings }, { onConflict: "user_id", ignoreDuplicates: true });
    if (error) throw error;
  }

  return { cells: b.cells.length, pins: newPins.length };
}
