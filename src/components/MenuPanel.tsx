import { SETTINGS_BOUNDS, type FogSettings } from "../lib/constants";
import type { Pin } from "../lib/types";
import { PinSearch } from "./PinSearch";

interface Props {
  email: string;
  settings: FogSettings;
  pins: Pin[];
  onSettings: (s: FogSettings) => void;
  onPickPlace: (p: { name: string; lng: number; lat: number }) => void;
  onPinRadius: (id: string, radiusM: number) => void;
  onDeletePin: (id: string) => void;
  onOpenImport: () => void;
  onSignOut: () => void;
  onClose: () => void;
}

function fmtDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

export function MenuPanel(p: Props) {
  const { settings } = p;
  return (
    <aside className="panel">
      <div className="panel-head">
        <h2>Atlas</h2>
        <button className="close" onClick={p.onClose} aria-label="Close">×</button>
      </div>

      <div className="section">
        <h3>The fog</h3>
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
        <div className="slider">
          <label>Border fade <b>{Math.round(settings.fade * 100)}</b></label>
          <input
            type="range"
            min={SETTINGS_BOUNDS.fade.min}
            max={SETTINGS_BOUNDS.fade.max}
            step={SETTINGS_BOUNDS.fade.step}
            value={settings.fade}
            onChange={(e) => p.onSettings({ ...settings, fade: +e.target.value })}
          />
        </div>
        <p className="hint">How dark the unknown stays, and how gradually your explored land dissolves into it — no hard edge.</p>
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
        <p className="hint" style={{ marginTop: 8 }}>Reveal everywhere your location history has been.</p>
      </div>

      <div className="section">
        <h3>Account</h3>
        <p className="hint" style={{ marginBottom: 10 }}>Signed in as {p.email}</p>
        <button className="btn ghost block" onClick={p.onSignOut}>Sign out</button>
      </div>
    </aside>
  );
}
