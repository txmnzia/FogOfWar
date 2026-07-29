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

/** Insert new explored cells, ignoring any that already exist. Returns count of rows sent. */
export async function addCells(
  userId: string,
  indexes: Iterable<string>,
  source: string,
): Promise<number> {
  const db = client();
  const rows = Array.from(indexes, (h3) => ({ user_id: userId, h3, source }));
  const chunk = 500;
  for (let i = 0; i < rows.length; i += chunk) {
    const { error } = await db
      .from("explored_cells")
      .upsert(rows.slice(i, i + chunk), { onConflict: "user_id,h3", ignoreDuplicates: true });
    if (error) throw error;
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

export async function fetchSettings(): Promise<FogSettings> {
  const db = client();
  const { data, error } = await db
    .from("settings")
    .select("darkness,reach_m")
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ...DEFAULT_SETTINGS };
  return { darkness: data.darkness, reachM: data.reach_m };
}

export async function saveSettings(userId: string, s: FogSettings): Promise<void> {
  const db = client();
  const { error } = await db
    .from("settings")
    .upsert({ user_id: userId, darkness: s.darkness, reach_m: s.reachM }, { onConflict: "user_id" });
  if (error) throw error;
}
