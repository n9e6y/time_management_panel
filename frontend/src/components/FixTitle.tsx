import { useState } from "react";
import type { Correction } from "../lib/types";

interface Props {
  title: string;
  uid: string;
  /** How many events in this period carry exactly this title. */
  sameTitle: number;
  onFix: (correction: Correction) => Promise<string[] | null>;
}

/**
 * Rewrite one event's title from Data quality. The fix is stored beside the calendar and applied every time it is
 * read, so it survives a new export; the calendar file itself is never changed.
 */
export default function FixTitle({ title, uid, sameTitle, onFix }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(title);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  const save = async (scope: "event" | "title") => {
    setBusy(true);
    const result = await onFix(scope === "event" ? { title: draft.trim(), uid } : { title: draft.trim(), match_title: title });
    setBusy(false);
    setProblems(result ?? []);
    if (!result) setOpen(false);
  };

  if (!open) {
    return <button className="linkbtn" onClick={() => { setDraft(title); setOpen(true); }}>Fix title…</button>;
  }
  const changed = draft.trim() && draft.trim() !== title.trim();
  return (
    <div className="fixtitle">
      <input className="input" aria-label="Corrected title" value={draft} autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); if (e.key === "Enter" && changed) save("event"); }} />
      <div className="row">
        <button className="btn primary" disabled={!changed || busy} onClick={() => save("event")}>
          This event
        </button>
        <button className="btn" disabled={!changed || busy} onClick={() => save("title")}>
          All {sameTitle} written this way
        </button>
        <button className="linkbtn" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {problems.length > 0 && <div className="notice error" role="alert"><ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul></div>}
    </div>
  );
}
