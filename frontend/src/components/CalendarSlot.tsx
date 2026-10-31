import { useEffect, useRef, useState } from "react";
import { fmtBytes, fmtRange } from "../lib/format";
import type { CalendarState } from "../lib/types";

const DAY_MS = 86_400_000;

/** "as of Thu 14:02", or "as of Mon 26 Oct (3 days ago)" when the export is old. */
export function asOfLabel(dataAsOf: string | null, now: Date = new Date()): { text: string; stale: boolean } {
  if (!dataAsOf) return { text: "", stale: false };
  const at = new Date(dataAsOf);
  const age = now.getTime() - at.getTime();
  const day = at.toLocaleDateString("en-GB", { weekday: "short" });
  if (age <= DAY_MS) return { text: `as of ${day} ${at.toTimeString().slice(0, 5)}`, stale: false };
  const date = at.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  return { text: `as of ${date} (${Math.floor(age / DAY_MS)} days ago)`, stale: true };
}

interface Props {
  state: CalendarState;
  onReplace: () => void;
  onRemove: () => void;
  onRestore: () => void;
  onCheckQuality: () => void;
}

/** The loaded calendar in the top bar, with its facts and actions (ux-v2 shell.md). */
export default function CalendarSlot({ state, onReplace, onRemove, onRestore, onCheckQuality }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("keydown", close); };
  }, [open]);
  const info = state.calendar;
  if (!info) return null;
  const asOf = asOfLabel(info.data_as_of);
  const act = (fn: () => void) => () => { setOpen(false); fn(); };
  return (
    <div className="slot" ref={ref}>
      <button aria-expanded={open} aria-label="Calendar file" onClick={() => setOpen(!open)}>
        {info.name}{asOf.text && <> · {asOf.text}</>}{asOf.stale && <span className="stale"> △</span>} ▾
      </button>
      {open && (
        <div className="popover" role="dialog" aria-label="Calendar file details">
          <dl>
            <dt>File</dt><dd>{info.name} · {fmtBytes(info.size)} · {info.events} events</dd>
            <dt>Loaded</dt><dd>{new Date(info.loaded_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</dd>
            {info.data_as_of && <><dt>Data as of</dt><dd>{new Date(info.data_as_of).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</dd></>}
            {info.first_day && info.last_day && <><dt>Covers</dt><dd>{fmtRange(info.first_day, info.last_day)}</dd></>}
            <dt>Saved</dt><dd>On this computer only, in <code>{state.folder}</code></dd>
          </dl>
          {asOf.stale && <p className="small" style={{ color: "var(--warn)" }}>△ Days after the export are not in this file. Export a new one from Google Calendar and replace it.</p>}
          <div className="actions">
            <button className="btn" onClick={act(onReplace)}>Replace…</button>
            {state.has_previous && <button className="btn" onClick={act(onRestore)}>Restore previous file</button>}
            <button className="btn" onClick={act(onCheckQuality)}>Check data quality</button>
            <button className="btn" onClick={act(onRemove)}>Remove from this computer</button>
          </div>
        </div>
      )}
    </div>
  );
}
