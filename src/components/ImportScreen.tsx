import { useState } from "react";
import { extractPointsFromFile } from "../lib/importTimeline";
import { pointsToCellIndexes } from "../lib/h3";
import { addCells } from "../data/repo";

interface Props {
  userId: string;
  onClose: () => void;
  onImported: (indexes: string[]) => void;
}

type Status = "idle" | "working" | "done" | "error";

export function ImportScreen({ userId, onClose, onImported }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [detail, setDetail] = useState("");
  const [error, setError] = useState("");

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setStatus("working");
    setError("");
    try {
      const all = new Set<string>();
      let points = 0;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setDetail(`Reading ${file.name} (${i + 1}/${files.length})…`);
        const pts = await extractPointsFromFile(file);
        points += pts.length;
        for (const idx of pointsToCellIndexes(pts)) all.add(idx);
      }
      setDetail(`Saving ${all.size.toLocaleString()} explored areas…`);
      await addCells(userId, all, "timeline");
      onImported(Array.from(all));
      setDetail(`Imported ${points.toLocaleString()} points → ${all.size.toLocaleString()} explored areas.`);
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
          <h2 style={{ fontFamily: "var(--serif)" }}>Import Google Timeline</h2>
          <button className="close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <p className="hint" style={{ marginBottom: 16 }}>
          Upload the JSON from a Google location export. Whatever format you have — the newer
          on-device Timeline export or an older Takeout download — it'll be read automatically.
          You can select multiple files at once.
        </p>

        <label className="dropzone">
          <input
            type="file"
            accept=".json,application/json"
            multiple
            style={{ display: "none" }}
            onChange={(e) => handleFiles(e.target.files)}
          />
          <b style={{ color: "var(--brass-bright)" }}>Choose file(s)</b><br />
          or drag a Timeline / Records JSON here
        </label>

        {status === "working" && <div className="msg ok" style={{ marginTop: 14 }}>{detail}</div>}
        {status === "done" && (
          <>
            <div className="msg ok" style={{ marginTop: 14 }}>{detail}</div>
            <button className="btn primary block" style={{ marginTop: 12 }} onClick={onClose}>See my map</button>
          </>
        )}
        {status === "error" && <div className="msg err" style={{ marginTop: 14 }}>Couldn't read that file: {error}</div>}

        <details style={{ marginTop: 18 }}>
          <summary className="hint" style={{ cursor: "pointer" }}>How do I get this file?</summary>
          <div className="hint" style={{ marginTop: 10, lineHeight: 1.6 }}>
            <b style={{ color: "var(--bone)" }}>On your phone (newest):</b> Google Maps app → tap your profile photo →
            <i> Your Timeline</i> → ⋯ or Settings → <i>Location &amp; privacy</i> → <b>Export Timeline data</b> → save the JSON, then upload it here.
            <br /><br />
            <b style={{ color: "var(--bone)" }}>Via Takeout:</b> go to <a href="https://takeout.google.com" target="_blank" rel="noreferrer">takeout.google.com</a> →
            Deselect all → tick <i>Location History (Timeline)</i> → export → unzip → upload the JSON file(s).
          </div>
        </details>
      </div>
    </div>
  );
}
