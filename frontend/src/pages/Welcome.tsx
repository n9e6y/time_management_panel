import { useRef, useState } from "react";
import { WEEKDAYS } from "../lib/time";
import type { Settings } from "../lib/types";

interface Props {
  step: 1 | 2;
  settings: Settings | null;
  folder: string;
  loading: string | null;
  error: string | null;
  onFile: (file: File) => void;
  /** Step 2: confirm how the week is read; saves only when something changed. */
  onConfirm: (settings: Settings) => Promise<string[] | null>;
}

/** First run only (ux-v2 page-welcome.md): 1 load the calendar, 2 check your week. Goals come with Stage 4. */
export default function Welcome({ step, settings, folder, loading, error, onFile, onConfirm }: Props) {
  return (
    <div className="welcome">
      <h1>Where did your time go, and is it going where you want?</h1>
      <div className="steps">{step === 1 ? <b>1 Calendar</b> : "1 Calendar"} · {step === 2 ? <b>2 Your week</b> : "2 Your week"}</div>
      {step === 1
        ? <LoadStep folder={folder} loading={loading} error={error} onFile={onFile} />
        : settings && <WeekStep settings={settings} onConfirm={onConfirm} />}
    </div>
  );
}

function LoadStep({ folder, loading, error, onFile }: Pick<Props, "folder" | "loading" | "error" | "onFile">) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <>
      <p className="muted">Load the .ics export of the Google Calendar you log your time in.</p>
      <div className={`drop ${over ? "over" : ""}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}>
        {loading ? <p>Reading {loading}…</p> : <>
          <p>Drop your .ics file here, or</p>
          <button className="btn primary" onClick={() => input.current?.click()}>Choose file</button>
        </>}
        <p className="faint small">Saved on this computer only{folder && <>, in <code>{folder}</code></>}. Nothing is sent anywhere.
          You can replace or remove it at any time from the top bar.</p>
        <input ref={input} type="file" accept=".ics,text/calendar" hidden aria-label="Calendar file" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
      </div>
      {error && <div className="notice error" role="alert">{error}</div>}
      <p className="faint small">Google Calendar → Settings → your time-log calendar → Export calendar, then unzip and choose the .ics.
        Name events like <code>LEARN: calculus ch.4 #deep [4]</code>.</p>
    </>
  );
}

function WeekStep({ settings, onConfirm }: { settings: Settings; onConfirm: Props["onConfirm"] }) {
  const [draft, setDraft] = useState(settings);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    setProblems((await onConfirm(draft)) ?? []);
    setBusy(false);
  };
  return (
    <div className="form">
      <p className="muted">Check how your weeks are read. Weekly totals follow your week start; days off are your weekend.</p>
      {problems.length > 0 && <div className="notice error" role="alert"><ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul></div>}
      <div className="field">
        <label htmlFor="w-tz">Timezone</label>
        <input id="w-tz" className="input" value={draft.timezone} onChange={(e) => setDraft({ ...draft, timezone: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="w-ws">Week starts on</label>
        <select id="w-ws" className="select" value={draft.week_start} onChange={(e) => setDraft({ ...draft, week_start: e.target.value })}>
          {WEEKDAYS.map((d) => <option key={d}>{d}</option>)}
        </select>
      </div>
      <fieldset className="field" style={{ border: 0, padding: 0 }}>
        <legend style={{ fontWeight: 500, marginBottom: 4 }}>Days off</legend>
        <div className="days">
          {WEEKDAYS.map((d) => (
            <label key={d} style={{ fontWeight: 400 }}>
              <input type="checkbox" checked={draft.days_off.includes(d)}
                onChange={(e) => setDraft({ ...draft, days_off: e.target.checked ? WEEKDAYS.filter((x) => x === d || draft.days_off.includes(x)) : draft.days_off.filter((x) => x !== d) })} /> {d}
            </label>
          ))}
        </div>
      </fieldset>
      <div><button className="btn primary" disabled={busy} onClick={confirm}>Looks right</button></div>
    </div>
  );
}
