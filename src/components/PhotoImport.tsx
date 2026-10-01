import { useState } from "react";
import {
  collectPhotoPoints,
  isSidecar,
  photosToCellIndexes,
  recordsToCsv,
  summarize,
  type PhotoRecord,
  type PhotoSummary,
} from "../lib/importPhotos";
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
  const [report, setReport] = useState<{ summary: PhotoSummary; records: PhotoRecord[] } | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setStatus("working");
    setError("");
    setReport(null);
    try {
      const sidecars: File[] = [];
      const media: File[] = [];
      for (let i = 0; i < files.length; i++) {
        if (isSidecar(files[i].name)) sidecars.push(files[i]);
        else media.push(files[i]);
      }
      if (sidecars.length === 0) {
        throw new Error(
          "No Takeout photo-metadata (.json) files found. Point this at your unzipped Takeout/Google Photos folder.",
        );
      }

      setDetail(`Reading ${sidecars.length.toLocaleString()} photos…`);
      const { points, records } = await collectPhotoPoints(
        sidecars,
        (read, total, found) => {
          setDetail(
            `Read ${read.toLocaleString()} / ${total.toLocaleString()} photos — ${found.toLocaleString()} with location…`,
          );
        },
        media,
      );
      setReport({ summary: summarize(records), records });

      if (points.length === 0) {
        throw new Error("Found photo metadata, but none of it had GPS coordinates.");
      }

      const cells = await photosToCellIndexes(points, (done, total) => {
        setDetail(`Mapping ${done.toLocaleString()} / ${total.toLocaleString()} located photos…`);
      });
      const idxs = Array.from(cells);

      // Reveal on the map right away — independent of the network save below, so
      // even a slow or flaky save still shows the result immediately.
      onImported(idxs);

      setDetail(`Saving ${cells.size.toLocaleString()} explored areas…`);
      try {
        await addCells(userId, cells, "photos", (done, total) => {
          setDetail(`Saving ${done.toLocaleString()} / ${total.toLocaleString()} explored areas…`);
        });
        setDetail(
          `Imported ${points.length.toLocaleString()} located photos → ${cells.size.toLocaleString()} explored areas.`,
        );
        setStatus("done");
      } catch (saveErr) {
        // Cells are already on the map; upserts are idempotent, so a re-run
        // resumes safely and skips whatever landed. Don't lose the whole import.
        setError(
          `Shown on your map, but saving was interrupted (${
            saveErr instanceof Error ? saveErr.message : String(saveErr)
          }). Run the import again to finish saving — it resumes where it left off.`,
        );
        setStatus("error");
      }
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

        {status === "working" && (
          <div className="msg ok" style={{ marginTop: 14 }}>
            {detail}
            <div className="hint" style={{ marginTop: 6 }}>Keep this tab open until it finishes.</div>
          </div>
        )}
        {status === "done" && (
          <>
            <div className="msg ok" style={{ marginTop: 14 }}>{detail}</div>
            <button className="btn primary block" style={{ marginTop: 12 }} onClick={onClose}>See my map</button>
          </>
        )}
        {status === "error" && <div className="msg err" style={{ marginTop: 14 }}>{error}</div>}
        {report && status !== "working" && <ImportReport {...report} />}

        <details style={{ marginTop: 18 }}>
          <summary className="hint" style={{ cursor: "pointer" }}>How do I get my photos' locations?</summary>
          <div className="hint" style={{ marginTop: 10, lineHeight: 1.6 }}>
            <b style={{ color: "var(--bone)" }}>Google Photos (recommended):</b> go to{" "}
            <a href="https://takeout.google.com" target="_blank" rel="noreferrer">takeout.google.com</a> →
            Deselect all → tick <i>Google Photos</i> → export → unzip the download → choose the
            <i> Takeout/Google Photos</i> folder above. Google keeps each photo's location in a small
            JSON file next to it, even when the photo itself has none.
            <br /><br />
            <b style={{ color: "var(--bone)" }}>A huge library?</b> Takeout splits Google Photos into
            <i> Photos from YYYY</i> folders. If the whole export is slow to pick, import one year
            folder at a time — re-running is safe, it never double-counts.
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

function pct(n: number, d: number): string {
  return d > 0 ? ` (${Math.round((n / d) * 100)}%)` : "";
}

/** What happened to every file in the batch, so a low yield can be explained. */
function ImportReport({ summary: s, records }: { summary: PhotoSummary; records: PhotoRecord[] }) {
  function download() {
    const blob = new Blob([recordsToCsv(records)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "photo-import-report.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const m = s.missingByKind;
  const row = (label: string, value: string, indent = false) => (
    <tr>
      <td style={{ paddingLeft: indent ? 14 : 0, paddingRight: 12 }}>{label}</td>
      <td style={{ textAlign: "right", color: "var(--bone)" }}>{value}</td>
    </tr>
  );
  return (
    <div className="hint" style={{ marginTop: 14 }}>
      <b style={{ color: "var(--bone)" }}>Import report</b>
      <table style={{ width: "100%", marginTop: 6, borderCollapse: "collapse" }}>
        <tbody>
          {row("Photos and videos", s.photos.toLocaleString())}
          {row("with a location", s.located.toLocaleString() + pct(s.located, s.photos), true)}
          {row("without a location", s.noLocation.toLocaleString() + pct(s.noLocation, s.photos), true)}
          {m.photo > 0 && row("· photos", m.photo.toLocaleString(), true)}
          {m.screenshot > 0 && row("· screenshots", m.screenshot.toLocaleString(), true)}
          {m.video > 0 && row("· videos", m.video.toLocaleString(), true)}
          {m.other > 0 && row("· other", m.other.toLocaleString(), true)}
          {s.inspected > 0 &&
            row("GPS found inside the photo file", `${s.gpsOnlyInFile.toLocaleString()} of ${s.inspected.toLocaleString()} checked`, true)}
          {s.notPhoto > 0 && row("Other .json files skipped", s.notPhoto.toLocaleString())}
          {s.unreadable > 0 && row("Unreadable files", s.unreadable.toLocaleString())}
        </tbody>
      </table>
      {s.gpsOnlyInFile > 0 && (
        <div style={{ marginTop: 6 }}>
          Some photos have GPS in the file that Takeout left out of its metadata. Those aren't on
          your map yet.
        </div>
      )}
      {s.noLocation > 0 && s.inspected === 0 && (
        <div style={{ marginTop: 6 }}>
          Photo files weren't checked. Choose the whole folder (not just the .json files) to see
          whether they carry GPS themselves.
        </div>
      )}
      <button className="btn block" style={{ marginTop: 10 }} onClick={download}>
        Download per-file report (CSV)
      </button>
    </div>
  );
}
