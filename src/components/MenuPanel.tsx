import { useState } from "react";
import { SETTINGS_BOUNDS, type FogSettings } from "../lib/constants";
import { FOG_NUDGES, DEFAULT_TUNING, type FogTuning } from "../lib/fogTuning";
import type { Pin } from "../lib/types";
import { PinSearch } from "./PinSearch";

interface Props {
  email: string;
  settings: FogSettings;
  tuning: FogTuning;
  zoom: number;
  pins: Pin[];
  onSettings: (s: FogSettings) => void;
  onTuning: (t: FogTuning) => void;
  onPickPlace: (p: { name: string; lng: number; lat: number }) => void;
  onPinRadius: (id: string, radiusM: number) => void;
  onDeletePin: (id: string) => void;
  onOpenImport: () => void;
  onOpenStrava: () => void;
  onOpenPhotos: () => void;
  onBackup: () => void;
  onRestore: (file: File) => void;
  onSignOut: () => void;
  onClose: () => void;
}

function fmtDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

export function MenuPanel(p: Props) {
  const { settings, tuning } = p;
  const [labOpen, setLabOpen] = useState(false);

  return (
    <aside className="panel">
      <div className="panel-head">
        <h2>Atlas</h2>
        <button className="close" onClick={p.onClose} aria-label="Close">×</button>
      </div>

      <div className="section">
        <h3>Add a place</h3>
        <PinSearch onPick={p.onPickPlace} />
        <p className="hint" style={{ marginTop: 8 }}>Clears a candlelight around a city you've been to.</p>
      </div>

      {p.pins.length > 0 && (
        <div className="section">
          <h3>Your places</h3>
          {p.pins.map((pin) => (
            <div key={pin.id}>
              <div className="pin-row">
                <span className="nm">{pin.name}</span>
                <span className="rad">{fmtDist(pin.radiusM)}</span>
                <button className="del" onClick={() => p.onDeletePin(pin.id)} aria-label={`Remove ${pin.name}`}>×</button>
              </div>
              <input
                type="range"
                min={500}
                max={50000}
                step={500}
                value={pin.radiusM}
                onChange={(e) => p.onPinRadius(pin.id, +e.target.value)}
                style={{ width: "100%" }}
              />
            </div>
          ))}
        </div>
      )}

      <div className="section">
        <h3>Your travels</h3>
        <button className="btn block" onClick={p.onOpenImport}>Import Google Timeline</button>
        <button className="btn block" style={{ marginTop: 8 }} onClick={p.onOpenStrava}>Import Strava</button>
        <button className="btn block" style={{ marginTop: 8 }} onClick={p.onOpenPhotos}>Import photo locations</button>
        <p className="hint" style={{ marginTop: 8 }}>Reveal everywhere your location history, activities and photos have been.</p>
      </div>

      <div className="section">
        <h3>Backup</h3>
        <button className="btn ghost block" onClick={p.onBackup}>Download backup</button>
        <label className="btn ghost block" style={{ marginTop: 8 }}>
          Restore from backup
          <input
            type="file"
            accept="application/json,.json"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) p.onRestore(f);
            }}
          />
        </label>
        <p className="hint" style={{ marginTop: 8 }}>
          Explored cells, places and fog settings in one file. Restoring adds to your map and never
          removes anything.
        </p>
      </div>

      <div className="section">
        <h3>Account</h3>
        <p className="hint" style={{ marginBottom: 10 }}>Signed in as {p.email}</p>
        <button className="btn ghost block" onClick={p.onSignOut}>Sign out</button>
      </div>

      <div className="section">
        <button className="lab-toggle" onClick={() => setLabOpen((v) => !v)} aria-expanded={labOpen}>
          <span>Fog Lab</span>
          <span className="chev">{labOpen ? "▾" : "▸"}</span>
        </button>
        {labOpen && (
          <div style={{ marginTop: 12 }}>
            <div className="zoom-readout">
              <span>Current zoom</span>
              <b>{p.zoom.toFixed(2)}</b>
            </div>
            <div className="slider">
              <label>Unexplored darkness <b>{Math.round(settings.darkness * 100)}%</b></label>
              <input
                type="range"
                min={SETTINGS_BOUNDS.darkness.min}
                max={SETTINGS_BOUNDS.darkness.max}
                step={SETTINGS_BOUNDS.darkness.step}
                value={settings.darkness}
                onChange={(e) => p.onSettings({ ...settings, darkness: +e.target.value })}
              />
            </div>
            <p className="hint" style={{ margin: "2px 0 12px" }}>
              The fog's size, softness and spread adapt to zoom automatically. These nudge the whole
              curve up or down — 0 is the tuned default.
            </p>
            {FOG_NUDGES.map((n) => (
              <div className="slider" key={n.key}>
                <label>
                  {n.label} <b>{tuning[n.key] > 0 ? "+" : ""}{tuning[n.key].toFixed(2)}</b>
                </label>
                <input
                  type="range"
                  min={n.min}
                  max={n.max}
                  step={n.step}
                  value={tuning[n.key]}
                  onChange={(e) => p.onTuning({ ...tuning, [n.key]: +e.target.value })}
                />
              </div>
            ))}
            <button
              className="btn ghost block"
              style={{ marginTop: 6 }}
              onClick={() => p.onTuning({ ...DEFAULT_TUNING })}
            >
              Reset nudges
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
