import { useEffect } from "react";
import { fmtHours, fmtWhen } from "../lib/format";
import { ISSUE_INFO } from "../lib/issues";
import type { Block } from "../lib/types";

/** Detail behind a chart: the calendar blocks of one slice, newest first, as they are titled. */
export default function BlocksDrawer({ title, blocks, note, onClose, onIssue }: {
  title: string; blocks: Block[];
  /** Replaces the default sub-line (block count, hours, "whole blocks"). */
  note?: string;
  onClose: () => void; onIssue: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const sorted = [...blocks].sort((a, b) => b.start_local.localeCompare(a.start_local));
  const hours = blocks.reduce((a, b) => a + b.duration_min / 60, 0);
  const sub = note ?? `${blocks.length} block${blocks.length === 1 ? "" : "s"} · ${fmtHours(hours)} in total · latest first · whole blocks, before any split`;
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={title}>
        <div className="drawer-head">
          <div className="row"><h2>{title}</h2><button className="drawer-close" onClick={onClose}>Close</button></div>
          <div className="sub">{sub}</div>
        </div>
        <div className="drawer-body">
          <ul>
            {sorted.map((b) => (
              <li key={b.block_id} className="drawer-item">
                <div className="when">{fmtWhen(b.start_local, b.end_local)}</div>
                <div className="hours">{fmtHours(b.duration_min / 60)}</div>
                <div className="title">{b.title}</div>
                {(b.comment || b.issues.length > 0) && (
                  <div className="extra">
                    {b.issues.map((i) => (
                      <button key={i} className="chip warn linkbtn" onClick={onIssue}>⚠ {ISSUE_INFO[i]?.label ?? i}</button>
                    ))}
                    {b.comment && <div className="comment">{b.comment}</div>}
                  </div>
                )}
              </li>
            ))}
          </ul>
          {!sorted.length && <div className="drawer-foot">No blocks in this period.</div>}
        </div>
      </aside>
    </>
  );
}
