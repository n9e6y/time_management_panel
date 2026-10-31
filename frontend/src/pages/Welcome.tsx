import { useRef, useState } from "react";
import type { Settings } from "../lib/types";

interface Props {
  settings: Settings | null;
  loading: string | null;
  error: string | null;
  onFile: (file: File) => void;
  onOpenSettings: () => void;
}

/** First run: choose the .ics export. The file stays in this tab's memory only. */
export default function Welcome({ settings, loading, error, onFile, onOpenSettings }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div className="welcome">
      <h1>See where your time goes</h1>
      <p className="muted">Load the .ics export of the Google Calendar you log your time in. The file is read by the
        server on this computer and is never saved; reloading the page forgets it.</p>
      <div className={`drop ${over ? "over" : ""}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}>
        {loading ? <p>Reading {loading}…</p> : <>
          <p>Drop your .ics file here</p>
          <button className="btn primary" onClick={() => input.current?.click()}>Choose file</button>
        </>}
        <input ref={input} type="file" accept=".ics,text/calendar" hidden aria-label="Calendar file" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
      </div>
      {error && <div className="notice error" role="alert">{error}</div>}
      {settings && <p className="faint small">Your week starts on {settings.week_start}; days off: {settings.days_off.join(", ") || "none"}. <button className="linkbtn" onClick={onOpenSettings}>Change</button></p>}
      <p className="faint small">Google Calendar → Settings → Import &amp; export → Export, then unzip and choose the .ics.</p>
    </div>
  );
}
