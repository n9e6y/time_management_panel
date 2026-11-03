import { useCallback, useRef, useState } from "react";
import { fmtBytes, fmtRange } from "../lib/format";
import type { CalendarState } from "../lib/types";
import { useDismiss } from "./ui";

const DAY_MS = 86_400_000;

/** "as of 14:02" today, "as of Wed 23:10" within a day, "as of Mon 26 Oct (3 days ago)" when the export is old. */
export function asOfLabel(dataAsOf: string | null, now: Date = new Date()): { text: string; stale: boolean } {
  if (!dataAsOf) return { text: "", stale: false };
  const at = new Date(dataAsOf);
  const age = now.getTime() - at.getTime();
  if (age <= DAY_MS) {
    const sameDay = at.toDateString() === now.toDateString();
    const day = sameDay ? "" : `${at.toLocaleDateString("en-GB", { weekday: "short" })} `;
    return { text: `as of ${day}${at.toTimeString().slice(0, 5)}`, stale: false };
  }
  const date = at.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  return { text: `as of ${date} (${Math.floor(age / DAY_MS)} days ago)`, stale: true };
}

const longTime = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

interface Props {
  state: CalendarState;
  onReplace: () => void;
  onRemove: () => void;
  onRestore: () => void;
}

/** The loaded calendar in the top bar, with its facts and actions. */
export default function CalendarSlot({ state, onReplace, onRemove, onRestore }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, ref);
  const info = state.calendar;
  if (!info) return null;
  const asOf = asOfLabel(info.data_as_of);
  const act = (fn: () => void) => () => { setOpen(false); fn(); };
  return (
    <div className="slot" ref={ref}>
      <button className="slot-btn" aria-expanded={open} aria-label="Calendar file" onClick={() => setOpen(!open)}>
        <span className="mono">{info.name}</span>
        {asOf.text && <span className="asof wide-only">{asOf.text}</span>}
        {asOf.stale && <span className="glyph-warn">△</span>}
        <span className="caret">▾</span>
      </button>
      {open && (
        <div className="popover" role="dialog" aria-label="Calendar file details">
          <dl>
            <dt>File</dt><dd>{info.name} · {fmtBytes(info.size)} · {info.events.toLocaleString("en-US")} events</dd>
            {info.data_as_of && <><dt>Data as of</dt><dd>{longTime(info.data_as_of)}</dd></>}
            {info.first_day && info.last_day && <><dt>Covers</dt><dd>{fmtRange(info.first_day, info.last_day)}</dd></>}
            <dt>Saved</dt><dd>On this computer only, in <code>{state.folder}</code></dd>
          </dl>
          {asOf.stale && <p className="stale-note">△ Days after the export are not in this file. Export a new one from Google Calendar and replace it.</p>}
          <div className="menu">
            <button className="first" onClick={act(onReplace)}>Replace… <span>or drop an .ics anywhere</span></button>
            {state.has_previous && <button onClick={act(onRestore)}>Restore previous file</button>}
            <button className="quiet" onClick={act(onRemove)}>Remove from this computer</button>
          </div>
        </div>
      )}
    </div>
  );
}
