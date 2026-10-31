import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BlocksDrawer from "./components/BlocksDrawer";
import DataQuality from "./pages/DataQuality";
import Overview from "./pages/Overview";
import SettingsPage from "./pages/Settings";
import Welcome from "./pages/Welcome";
import { analyze, ApiError, getPeriods, getSettings, saveSettings } from "./lib/api";
import { totals, type Ctx } from "./lib/aggregate";
import { fmtBytes, fmtRange } from "./lib/format";
import { todayIn } from "./lib/time";
import type { Analysis, Block, Period, PeriodPreset, Settings } from "./lib/types";

type Page = "overview" | "quality" | "settings";
interface LoadedFile { name: string; size: number; bytes: ArrayBuffer }

function periodFromUrl(): Period {
  const q = new URLSearchParams(window.location.search);
  const start = q.get("start");
  const end = q.get("end");
  return start && end ? { start, end } : { preset: q.get("period") ?? "1m" };
}

function periodToUrl(period: Period) {
  const q = "preset" in period ? `?period=${period.preset}` : `?start=${period.start}&end=${period.end}`;
  window.history.replaceState(null, "", `${q}${window.location.hash}`);
}

export default function App() {
  const [page, setPage] = useState<Page>("overview");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [source, setSource] = useState("");
  const [presets, setPresets] = useState<PeriodPreset[]>([]);
  const [period, setPeriod] = useState<Period>(periodFromUrl);
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "updating">("idle");
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<{ title: string; blocks: Block[] } | null>(null);
  const [customOpen, setCustomOpen] = useState("start" in period);
  const inFlight = useRef<AbortController | null>(null);
  const replaceInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    Promise.all([getSettings(), getPeriods()])
      .then(([s, p]) => { setSettings(s.settings); setSource(s.source); setPresets(p.presets); })
      .catch((e: ApiError) => setError(e.message));
  }, []);

  const run = useCallback(async (target: LoadedFile, which: Period, keepOld: boolean) => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setStatus(keepOld ? "updating" : "loading");
    try {
      const result = await analyze(target.bytes, which, controller.signal);
      setFile(target);
      setAnalysis(result);
      setError(null);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError((e as Error).message);  // on error the previous file and results stay
    }
    if (inFlight.current === controller) setStatus("idle");
  }, []);

  const loadFile = async (f: File) => run({ name: f.name, size: f.size, bytes: await f.arrayBuffer() }, period, !!analysis);
  const choosePeriod = (next: Period) => {
    setPeriod(next);
    periodToUrl(next);
    if (file) run(file, next, true);
  };
  const onSaveSettings = async (next: Settings): Promise<string[] | null> => {
    try {
      const saved = await saveSettings(next);
      setSettings(saved.settings);
      setSource(saved.source);
      if (file) await run(file, period, true);
      return null;
    } catch (e) {
      const err = e as ApiError;
      return err.problems?.length ? err.problems : [err.message];
    }
  };

  const ctx: Ctx | null = useMemo(() => (analysis && settings
    ? { analysis, settings, today: todayIn(analysis.range.timezone) } : null), [analysis, settings]);
  const issueCount = ctx ? totals(ctx).issues : 0;

  if (!settings && !error) return <main className="faint">Connecting to the Time Analyzer server…</main>;
  if (!ctx || page === "settings" && !analysis) {
    return page === "settings" && settings
      ? <><TopBar page={page} setPage={setPage} hasData={false} issues={0} /><main><SettingsPage settings={settings} source={source} onSave={onSaveSettings} /></main></>
      : <Welcome settings={settings} loading={status === "loading" ? "your calendar" : null} error={error} onFile={loadFile} onOpenSettings={() => setPage("settings")} />;
  }

  const { range } = ctx.analysis;
  const dayCount = Math.round((Date.parse(range.last_day) - Date.parse(range.first_day)) / 86_400_000) + 1;
  const presetValue = "preset" in period ? period.preset : "custom";
  return (
    <>
      <TopBar page={page} setPage={setPage} hasData issues={issueCount} />
      <div className="context">
        <label className="faint" htmlFor="period">Period</label>
        <select id="period" className="select" value={customOpen ? "custom" : presetValue}
          onChange={(e) => { if (e.target.value === "custom") setCustomOpen(true); else { setCustomOpen(false); choosePeriod({ preset: e.target.value }); } }}>
          {(["calendar", "rolling"] as const).map((kind) => (
            <optgroup key={kind} label={kind === "calendar" ? "Calendar" : "Rolling (up to today)"}>
              {presets.filter((p) => p.kind === kind).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </optgroup>
          ))}
          <option value="custom">Custom range…</option>
        </select>
        {customOpen && <CustomRange initial={"start" in period ? period : { start: range.first_day, end: range.last_day }} onApply={choosePeriod} />}
        <span>{fmtRange(range.first_day, range.last_day)} · {dayCount} days · {range.timezone} · week starts {range.week_start.slice(0, 3)}{ctx.today >= range.first_day && ctx.today <= range.last_day ? " · today in progress" : ""}</span>
        {status === "updating" && <span>Updating…</span>}
        <span className="file">Calendar: {file!.name} ({fmtBytes(file!.size)}) <button className="linkbtn" onClick={() => replaceInput.current?.click()}>Replace</button></span>
        <input ref={replaceInput} type="file" accept=".ics,text/calendar" hidden aria-label="Replace calendar file" onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = ""; }} />
      </div>
      <main className={status === "updating" ? "updating" : ""}>
        {error && <div className="notice error" role="alert">{error}</div>}
        {page === "overview" && <Overview ctx={ctx} onShowBlocks={(title, blocks) => setDrawer({ title, blocks })} onUsePreset={(p) => { setCustomOpen(false); choosePeriod({ preset: p }); }} />}
        {page === "quality" && <DataQuality ctx={ctx} onOpenSettings={() => setPage("settings")} />}
        {page === "settings" && <SettingsPage settings={settings!} source={source} onSave={onSaveSettings} />}
      </main>
      {drawer && <BlocksDrawer title={drawer.title} blocks={drawer.blocks} onClose={() => setDrawer(null)} onIssue={() => { setDrawer(null); setPage("quality"); }} />}
    </>
  );
}

function TopBar({ page, setPage, hasData, issues }: { page: Page; setPage: (p: Page) => void; hasData: boolean; issues: number }) {
  return (
    <nav className="topbar" aria-label="Main">
      <span className="brand">Time Analyzer</span>
      {hasData && (
        <div className="nav">
          <button aria-current={page === "overview" ? "page" : undefined} onClick={() => setPage("overview")}>Overview</button>
          <button aria-current={page === "quality" ? "page" : undefined} onClick={() => setPage("quality")}>Data quality</button>
        </div>
      )}
      <div className="right">
        {issues > 0 && <button className="badge" onClick={() => setPage("quality")}><span className="icon">⚠</span> {issues} issues</button>}
        <button className="iconbtn" aria-label="Settings" aria-current={page === "settings" ? "page" : undefined} onClick={() => setPage(page === "settings" && hasData ? "overview" : "settings")}>⚙</button>
      </div>
    </nav>
  );
}

function CustomRange({ initial, onApply }: { initial: { start: string; end: string }; onApply: (p: Period) => void }) {
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const valid = start && end && start <= end;
  return (
    <span>
      <input className="input" type="date" aria-label="Start date" value={start} onChange={(e) => setStart(e.target.value)} />{" – "}
      <input className="input" type="date" aria-label="End date" value={end} onChange={(e) => setEnd(e.target.value)} />{" "}
      <button className="btn" disabled={!valid} onClick={() => onApply({ start, end })}>Apply</button>
      {!valid && <span className="small" style={{ color: "var(--error)" }}> End must be on or after start.</span>}
    </span>
  );
}
