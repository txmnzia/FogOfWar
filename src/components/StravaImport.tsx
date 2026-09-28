import { useState } from "react";
import type { StravaProgress } from "../lib/importStrava";
import { addCells } from "../data/repo";

interface Props {
  userId: string;
  onClose: () => void;
  onImported: (indexes: string[]) => void;
}

type Status = "idle" | "working" | "done" | "error";

export function StravaImport({ userId, onClose, onImported }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [detail, setDetail] = useState("");
  const [error, setError] = useState("");

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setStatus("working");
    setError("");
    try {
      setDetail("Reading archive…");
      const { extractCellsFromStrava } = await import("../lib/importStrava");
      const onProgress = (p: StravaProgress) => setDetail(`Reading ${p.file} (${p.index}/${p.total})…`);
      const { cells, points, activities } = await extractCellsFromStrava(Array.from(files), onProgress);
      if (cells.size === 0) {
        setError("No GPS tracks found in that file. Make sure it's your Strava export ZIP (or .gpx/.tcx/.fit files).");
        setStatus("error");
        return;
      }
      setDetail(`Saving ${cells.size.toLocaleString()} explored areas…`);
      await addCells(userId, cells, "strava");
      onImported(Array.from(cells));
      setDetail(
        `Imported ${activities.toLocaleString()} activities · ${points.toLocaleString()} points → ${cells.size.toLocaleString()} explored areas.`,
      );
      setStatus("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  return (
    <div className="center" style={{ zIndex: 20 }}>
      <div className="card">
        <div className="panel-head">
          <h2 style={{ fontFamily: "var(--serif)" }}>Import Strava</h2>
          <button className="close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <p className="hint" style={{ marginBottom: 16 }}>
          Upload your Strava export — the whole <b style={{ color: "var(--bone)" }}>.zip</b> is easiest, and I'll read
          every run, ride and hike inside it (GPX, TCX or FIT). You can also drop loose activity files.
        </p>

        <label className="dropzone">
          <input
            type="file"
            accept=".zip,.gpx,.tcx,.fit,.gz,application/zip"
            multiple
            style={{ display: "none" }}
            onChange={(e) => handleFiles(e.target.files)}
          />
          <b style={{ color: "var(--brass-bright)" }}>Choose your Strava .zip</b><br />
          or drag it here
        </label>

        {status === "working" && <div className="msg ok" style={{ marginTop: 14 }}>{detail}</div>}
        {status === "done" && (
          <>
            <div className="msg ok" style={{ marginTop: 14 }}>{detail}</div>
            <button className="btn primary block" style={{ marginTop: 12 }} onClick={onClose}>See my map</button>
          </>
        )}
        {status === "error" && <div className="msg err" style={{ marginTop: 14 }}>{error}</div>}

        <details style={{ marginTop: 18 }}>
          <summary className="hint" style={{ cursor: "pointer" }}>How do I get my Strava archive?</summary>
          <div className="hint" style={{ marginTop: 10, lineHeight: 1.6 }}>
            On the Strava website: <b style={{ color: "var(--bone)" }}>Settings → My Account →
            "Download or Delete Your Account" → Get Started</b>, then under <i>Download Request</i> click
            <b style={{ color: "var(--bone)" }}> Request your archive</b>. Strava emails you a download link
            (it can take a few hours). Unzip nothing — just upload the ZIP here.
          </div>
        </details>
      </div>
    </div>
  );
}
