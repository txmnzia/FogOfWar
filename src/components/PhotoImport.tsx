import { useRef, useState } from "react";
import { coordFromSidecar, isSidecar, photosToCellIndexes } from "../lib/importPhotos";
import { addCells } from "../data/repo";

interface Props {
  userId: string;
  onClose: () => void;
  onImported: (indexes: string[]) => void;
}

type Status = "idle" | "working" | "done" | "error";

// webkitdirectory isn't in the standard input typings.
interface DirInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  webkitdirectory?: string;
  directory?: string;
}

export function PhotoImport({ userId, onClose, onImported }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [detail, setDetail] = useState("");
  const [error, setError] = useState("");
  const cancelled = useRef(false);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    cancelled.current = false;
    setStatus("working");
    setError("");
    try {
      const sidecars: File[] = [];
      for (let i = 0; i < files.length; i++) {
        if (isSidecar(files[i].name)) sidecars.push(files[i]);
      }
      if (sidecars.length === 0) {
        throw new Error(
          "No Takeout photo-metadata (.json) files found. Point this at your unzipped Takeout/Google Photos folder.",
        );
      }

      const points: Array<[number, number]> = [];
      let read = 0;
      for (const file of sidecars) {
        if (cancelled.current) return;
        const pt = coordFromSidecar(await file.text());
        if (pt) points.push(pt);
        if (++read % 200 === 0 || read === sidecars.length) {
          setDetail(
            `Read ${read.toLocaleString()} / ${sidecars.length.toLocaleString()} photos — ${points.length.toLocaleString()} with location…`,
          );
        }
      }

      if (points.length === 0) {
        throw new Error("Found photo metadata, but none of it had GPS coordinates.");
      }

      setDetail(`Mapping ${points.length.toLocaleString()} located photos…`);
      const cells = photosToCellIndexes(points);
      setDetail(`Saving ${cells.size.toLocaleString()} explored areas…`);
      await addCells(userId, cells, "photos");
      onImported(Array.from(cells));
      setDetail(
        `Imported ${points.length.toLocaleString()} located photos → ${cells.size.toLocaleString()} explored areas.`,
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
          <h2 style={{ fontFamily: "var(--serif)" }}>Import photo locations</h2>
          <button className="close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <p className="hint" style={{ marginBottom: 16 }}>
          Reveal the map wherever your photos were taken. Select your unzipped Google Takeout
          <i> Google Photos</i> folder — only the small metadata files are read, and everything
          stays on this device. Your photos are never uploaded.
        </p>

        <label className="dropzone">
          <input
            type="file"
            // A whole folder, recursively — we filter to the .json sidecars.
            {...({ webkitdirectory: "", directory: "", multiple: true } as DirInputProps)}
            style={{ display: "none" }}
            onChange={(e) => handleFiles(e.target.files)}
          />
          <b style={{ color: "var(--brass-bright)" }}>Choose your Takeout folder</b><br />
          the “Google Photos” folder from your unzipped export
        </label>

        <label className="dropzone" style={{ marginTop: 10 }}>
          <input
            type="file"
            accept=".json,application/json"
            multiple
            style={{ display: "none" }}
            onChange={(e) => handleFiles(e.target.files)}
          />
          <b style={{ color: "var(--brass-bright)" }}>…or pick the .json files</b><br />
          if your browser won’t let you choose a folder
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
          <summary className="hint" style={{ cursor: "pointer" }}>How do I get my photos' locations?</summary>
          <div className="hint" style={{ marginTop: 10, lineHeight: 1.6 }}>
            <b style={{ color: "var(--bone)" }}>Google Photos (recommended):</b> go to{" "}
            <a href="https://takeout.google.com" target="_blank" rel="noreferrer">takeout.google.com</a> →
            Deselect all → tick <i>Google Photos</i> → export → unzip the download → choose the
            <i> Takeout/Google Photos</i> folder above. Google keeps each photo's location in a small
            JSON file next to it, even when the photo itself has none.
            <br /><br />
            <b style={{ color: "var(--bone)" }}>iCloud / local photos:</b> those exports don't include
            the same sidecar files, so they aren't supported yet — read directly from the photos'
            EXIF is a later step. For now, if your library is also in Google Photos, use Takeout.
          </div>
        </details>
      </div>
    </div>
  );
}
