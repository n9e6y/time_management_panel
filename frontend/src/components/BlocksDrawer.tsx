import { useEffect } from "react";
import { fmtDay, fmtHM } from "../lib/format";
import { ISSUE_INFO } from "../lib/issues";
import type { Block } from "../lib/types";

/** Detail behind a chart: the calendar blocks of one slice, newest first. */
export default function BlocksDrawer({ title, blocks, onClose, onIssue }: {
  title: string; blocks: Block[]; onClose: () => void; onIssue: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const sorted = [...blocks].sort((a, b) => b.start_local.localeCompare(a.start_local));
  const hours = blocks.reduce((a, b) => a + b.duration_min / 60, 0);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={title}>
        <header><h2>{title}</h2><button className="btn close" onClick={onClose}>Close</button></header>
        <div className="muted small">{blocks.length} blocks · {fmtHM(hours)} in total · whole blocks, before any split</div>
        <ul>
          {sorted.map((b) => (
            <li key={b.block_id}>
              <div className="small faint">{fmtDay(b.start_local.slice(0, 10))} · {b.start_local.slice(11, 16)}–{b.end_local.slice(11, 16)} · {fmtHM(b.duration_min / 60)}</div>
              <div><span className="cat">{b.category}</span> {b.task}</div>
              <div>
                {b.tags.map((t) => <span key={t} className="chip">#{t}</span>)}
                {b.projects.map((t) => <span key={t} className="chip">+{t}</span>)}
                {b.score !== null && <span className="chip">score {b.score}</span>}
                {b.issues.map((i) => <button key={i} className="chip warn linkbtn" onClick={onIssue}>⚠ {ISSUE_INFO[i]?.label ?? i}</button>)}
              </div>
              {b.comment && <div className="small faint" style={{ fontStyle: "italic" }}>{b.comment}</div>}
            </li>
          ))}
        </ul>
      </aside>
    </>
  );
}
