import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type Map as MlMap } from "maplibre-gl";
import { getHexagonAreaAvg } from "h3-js";
import { MapView } from "../map/MapView";
import { FogLayer } from "../map/FogLayer";
import { MenuPanel } from "./MenuPanel";
import { ImportScreen } from "./ImportScreen";
import { StravaImport } from "./StravaImport";
import { supabase } from "../lib/supabase";
import { DEFAULT_SETTINGS, H3_RES, type FogSettings } from "../lib/constants";
import { cellFromIndex } from "../lib/h3";
import type { Cell, Pin } from "../lib/types";
import {
  addPin,
  fetchAllCellIndexes,
  fetchPins,
  fetchSettings,
  removePin,
  saveSettings,
  updatePinRadius,
} from "../data/repo";
import { sampleCells } from "../data/seed";

const CELL_AREA_KM2 = getHexagonAreaAvg(H3_RES, "km2");

export function MapApp({ userId, email }: { userId: string; email: string }) {
  const [settings, setSettings] = useState<FogSettings>(DEFAULT_SETTINGS);
  const [cells, setCells] = useState<Cell[]>([]);
  const [pins, setPins] = useState<Pin[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [stravaOpen, setStravaOpen] = useState(false);

  const mapRef = useRef<MlMap | null>(null);
  const fogRef = useRef<FogLayer | null>(null);
  const fittedRef = useRef(false);
  const saveTimer = useRef<number>();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const usingSample = loaded && cells.length === 0 && pins.length === 0;
  const displayCells = useMemo(() => (usingSample ? sampleCells() : cells), [usingSample, cells]);
  const litKm2 = Math.round((usingSample ? 0 : cells.length) * CELL_AREA_KM2);

  // Initial data load.
  useEffect(() => {
    (async () => {
      try {
        const [s, indexes, p] = await Promise.all([fetchSettings(), fetchAllCellIndexes(), fetchPins()]);
        setSettings(s);
        setCells(indexes.map(cellFromIndex));
        setPins(p);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const onReady = useCallback((map: MlMap) => {
    mapRef.current = map;
    fogRef.current = new FogLayer(map, settingsRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push data + fit view once everything's available.
  useEffect(() => {
    const fog = fogRef.current;
    const map = mapRef.current;
    if (!fog || !map || !loaded) return;
    fog.setData(displayCells, pins);

    if (!fittedRef.current && (displayCells.length > 0 || pins.length > 0)) {
      fittedRef.current = true;
      const b = new maplibregl.LngLatBounds();
      for (const c of displayCells) b.extend([c.lng, c.lat]);
      for (const p of pins) b.extend([p.lng, p.lat]);
      if (!b.isEmpty()) map.fitBounds(b, { padding: 80, maxZoom: 9, duration: 0 });
    }
  }, [displayCells, pins, loaded]);

  useEffect(() => {
    fogRef.current?.setSettings(settings);
  }, [settings]);

  useEffect(() => () => fogRef.current?.destroy(), []);

  // --- handlers ---
  function changeSettings(s: FogSettings) {
    setSettings(s);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveSettings(userId, s).catch(() => {});
    }, 400);
  }

  async function pickPlace(place: { name: string; lng: number; lat: number }) {
    const pin = await addPin(userId, { name: place.name, lat: place.lat, lng: place.lng, radiusM: 3000 });
    setPins((prev) => [...prev, pin]);
    mapRef.current?.flyTo({ center: [place.lng, place.lat], zoom: 10, duration: 1200 });
  }

  function changePinRadius(id: string, radiusM: number) {
    setPins((prev) => prev.map((p) => (p.id === id ? { ...p, radiusM } : p)));
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => updatePinRadius(id, radiusM).catch(() => {}), 400);
  }

  async function deletePin(id: string) {
    setPins((prev) => prev.filter((p) => p.id !== id));
    await removePin(id).catch(() => {});
  }

  function onImported(indexes: string[]) {
    setCells((prev) => {
      const seen = new Set(prev.map((c) => c.h3));
      const merged = [...prev];
      for (const idx of indexes) if (!seen.has(idx)) merged.push(cellFromIndex(idx));
      return merged;
    });
  }

  return (
    <div className="map-app">
      <MapView onReady={onReady} />

      <div className="topbar">
        <div className="brand">
          <img className="mark" src={`${import.meta.env.BASE_URL}icon.svg`} alt="" />
          <div>
            <h1>Fog of War</h1>
            {!usingSample && <span className="lit">{litKm2.toLocaleString()} km² explored</span>}
          </div>
        </div>
        <div className="spacer" />
        <button className="pill" onClick={() => setMenuOpen(true)}>☰ Atlas</button>
      </div>

      {menuOpen && (
        <MenuPanel
          email={email}
          settings={settings}
          pins={pins}
          onSettings={changeSettings}
          onPickPlace={pickPlace}
          onPinRadius={changePinRadius}
          onDeletePin={deletePin}
          onOpenImport={() => setImportOpen(true)}
          onOpenStrava={() => setStravaOpen(true)}
          onSignOut={() => supabase?.auth.signOut()}
          onClose={() => setMenuOpen(false)}
        />
      )}

      {importOpen && (
        <ImportScreen userId={userId} onClose={() => setImportOpen(false)} onImported={onImported} />
      )}

      {stravaOpen && (
        <StravaImport userId={userId} onClose={() => setStravaOpen(false)} onImported={onImported} />
      )}

      {usingSample && (
        <div className="banner">
          <span>
            <span className="em">Sample journey shown.</span> Import your Timeline or add a place to begin your own map.
          </span>
        </div>
      )}
      {loadError && (
        <div className="banner">
          <span className="em">Couldn't load your data.</span>&nbsp;Have you run the setup SQL? ({loadError})
        </div>
      )}
    </div>
  );
}
