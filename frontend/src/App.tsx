import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import BlocksDrawer from "./components/BlocksDrawer";
import CalendarSlot from "./components/CalendarSlot";
import Sheet, { Toast } from "./components/Sheet";
import DataQuality from "./pages/DataQuality";
import Overview from "./pages/Overview";
import SettingsPage from "./pages/Settings";
import Welcome from "./pages/Welcome";
import {
  analyze, ApiError, checkCalendar, getCalendar, getPeriods, getSettings, pickFile, removeCalendar, restoreCalendar,
  saveCalendar, saveSettings, type PickedFile,
} from "./lib/api";
import { totals, type Ctx } from "./lib/aggregate";
import { fmtRange } from "./lib/format";
import { todayIn } from "./lib/time";
import type {
  Analysis, Block, CalendarCheck, CalendarState, Period, PeriodPreset, Settings,
} from "./lib/types";

type Page = "overview" | "quality" | "settings";

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

const WARNING_TEXT: Record<string, (w: { current: number | string; new: number | string }) => string> = {
  shorter_span: (w) => `it covers ${w.new} days, against ${w.current} in the current file`,
  ends_earlier: (w) => `it ends on ${w.new}, before the current file (${w.current})`,
  few_known_categories: (w) => `${Math.round(Number(w.new) * 100)}% of its titles have a known category (yours: ${Math.round(Number(w.current) * 100)}%)`,
};

export default function App() {
  const [page, setPage] = useState<Page>("overview");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [source, setSource] = useState("");
  const [presets, setPresets] = useState<PeriodPreset[]>([]);
  const [period, setPeriod] = useState<Period>(periodFromUrl);
  const [calendar, setCalendar] = useState<CalendarState | null>(null);
  const [welcomeStep, setWelcomeStep] = useState<1 | 2>(1);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "updating">("idle");
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<{ title: string; blocks: Block[] } | null>(null);
  const [customOpen, setCustomOpen] = useState("start" in period);
  const [pending, setPending] = useState<{ file: PickedFile; check: CalendarCheck } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [toast, setToast] = useState<{ message: string; undo?: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const inFlight = useRef<AbortController | null>(null);
  const replaceInput = useRef<HTMLInputElement>(null);

  const run = useCallback(async (which: Period, keepOld: boolean) => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setStatus(keepOld ? "updating" : "loading");
    try {
      setAnalysis(await analyze(which, controller.signal));
      setError(null);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError((e as Error).message);  // on error the previous results stay
    }
    if (inFlight.current === controller) setStatus("idle");
  }, []);

  useEffect(() => {
    Promise.all([getSettings(), getPeriods(), getCalendar()])
      .then(([s, p, c]) => {
        setSettings(s.settings); setSource(s.source); setPresets(p.presets); setCalendar(c);
        if (c.calendar) run(periodFromUrl(), false);  // returning user: straight to the dashboard
      })
      .catch((e: ApiError) => setError(e.message));
  }, [run]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 8000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // --- calendar file: first load, replace (with the wrong-file check), restore, remove -------

  const firstLoad = async (f: File) => {
    setStatus("loading");
    try {
      setCalendar(await saveCalendar(await pickFile(f)));
      setError(null);
      setWelcomeStep(2);
    } catch (e) {
      setError((e as Error).message);
    }
    setStatus("idle");
  };

  const swapIn = async (file: PickedFile) => {
    setPending(null);
    try {
      setCalendar(await saveCalendar(file));
      setToast({ message: `Loaded ${file.name}.`, undo: true });
      await run(period, true);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const replace = async (f: File) => {
    try {
      const file = await pickFile(f);
      const check = await checkCalendar(file);
      if (check.warnings.length) setPending({ file, check });
      else await swapIn(file);
    } catch (e) {
      setError((e as Error).message);  // the current file and results stay
    }
  };

  const undo = async () => {
    setToast(null);
    setCalendar(await restoreCalendar());
    await run(period, true);
  };

  const remove = async () => {
    setConfirmRemove(false);
    setCalendar(await removeCalendar());
    setAnalysis(null);
    setWelcomeStep(1);
    setPage("overview");
  };

  // Dropping an .ics anywhere replaces the calendar (ux-v2 shell.md).
  useEffect(() => {
    if (!calendar?.calendar) return;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const over = (e: DragEvent) => { if (hasFiles(e)) { e.preventDefault(); setDragging(true); } };
    const leave = (e: DragEvent) => { if (!e.relatedTarget) setDragging(false); };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer?.files[0];
      if (f) replace(f);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => { window.removeEventListener("dragover", over); window.removeEventListener("dragleave", leave); window.removeEventListener("drop", drop); };
  });

  // --- period and settings ----------------------------------------------------------------------

  const choosePeriod = (next: Period) => {
    setPeriod(next);
    periodToUrl(next);
    if (calendar?.calendar) run(next, true);
  };

  const onSaveSettings = async (next: Settings): Promise<string[] | null> => {
    try {
      const saved = await saveSettings(next);
      setSettings(saved.settings);
      setSource(saved.source);
      if (calendar?.calendar) await run(period, true);
      return null;
    } catch (e) {
      const err = e as ApiError;
      return err.problems?.length ? err.problems : [err.message];
    }
  };

  const confirmWeek = async (next: Settings): Promise<string[] | null> => {
    const problems = JSON.stringify(next) === JSON.stringify(settings) ? null : await onSaveSettings(next);
    if (!problems) await run(period, false);
    return problems;
  };

  const ctx: Ctx | null = useMemo(() => {
    if (!analysis || !settings) return null;
    const tz = analysis.range.timezone;
    const asOf = calendar?.calendar?.data_as_of;
    return { analysis, settings, today: todayIn(tz), dataAsOf: asOf ? todayIn(tz, new Date(asOf)) : null };
  }, [analysis, settings, calendar]);
  const issueCount = ctx ? totals(ctx).issues : 0;
  const hasCalendar = !!calendar?.calendar;

  if (!settings && !error) return <main className="faint">Connecting to the Time Analyzer server…</main>;
  if (!hasCalendar || (welcomeStep === 2 && !analysis)) {
    if (page === "settings" && settings) {
      return <><TopBar page={page} setPage={setPage} hasData={false} issues={0} /><main><SettingsPage settings={settings} source={source} onSave={onSaveSettings} /></main></>;
    }
    return <Welcome step={hasCalendar ? 2 : 1} settings={settings} folder={calendar?.folder ?? ""} loading={status === "loading" ? "your calendar" : null}
      error={error} onFile={firstLoad} onConfirm={confirmWeek} />;
  }

  const slot = (
    <CalendarSlot state={calendar!} onReplace={() => replaceInput.current?.click()} onRemove={() => setConfirmRemove(true)}
      onRestore={undo} onCheckQuality={() => setPage("quality")} />
  );
  return (
    <>
      <TopBar page={page} setPage={setPage} hasData issues={issueCount} slot={slot} />
      <input ref={replaceInput} type="file" accept=".ics,text/calendar" hidden aria-label="Replace calendar file" onChange={(e) => { const f = e.target.files?.[0]; if (f) replace(f); e.target.value = ""; }} />
      {ctx ? (
        <>
          <ContextLine ctx={ctx} period={period} presets={presets} customOpen={customOpen} status={status}
            onCustom={setCustomOpen} onPeriod={choosePeriod} />
          <main className={status === "updating" ? "updating" : ""}>
            {error && <div className="notice error" role="alert">{error}</div>}
            {page === "overview" && <Overview ctx={ctx} onShowBlocks={(title, blocks) => setDrawer({ title, blocks })} onUsePreset={(p) => { setCustomOpen(false); choosePeriod({ preset: p }); }} />}
            {page === "quality" && <DataQuality ctx={ctx} onOpenSettings={() => setPage("settings")} />}
            {page === "settings" && <SettingsPage settings={settings!} source={source} onSave={onSaveSettings} />}
          </main>
        </>
      ) : (
        <main>{error ? <div className="notice error" role="alert">{error}</div> : <p className="faint">Reading {calendar!.calendar!.name}…</p>}</main>
      )}
      {drawer && <BlocksDrawer title={drawer.title} blocks={drawer.blocks} onClose={() => setDrawer(null)} onIssue={() => { setDrawer(null); setPage("quality"); }} />}
      {pending && (
        <Sheet title="This file looks different" actions={<>
          <button className="btn primary" onClick={() => setPending(null)}>Cancel</button>
          <button className="btn" onClick={() => swapIn(pending.file)}>Replace anyway</button>
        </>}>
          <p>{pending.file.name} may be a different calendar than {pending.check.current?.name}:</p>
          <ul>{pending.check.warnings.map((w) => <li key={w.code}>{WARNING_TEXT[w.code]?.(w) ?? w.code}</li>)}</ul>
          {pending.check.new.first_day && pending.check.new.last_day && <p className="faint small">It covers {fmtRange(pending.check.new.first_day, pending.check.new.last_day)}, {pending.check.new.events} events.</p>}
        </Sheet>
      )}
      {confirmRemove && (
        <Sheet title={`Remove ${calendar!.calendar!.name} from this computer?`} actions={<>
          <button className="btn primary" onClick={() => setConfirmRemove(false)}>Cancel</button>
          <button className="btn" onClick={remove}>Remove</button>
        </>}>
          <p>Your settings stay. You can load a calendar again at any time.</p>
        </Sheet>
      )}
      {dragging && <div className="dropzone"><div>Release to replace {calendar!.calendar!.name}</div></div>}
      {toast && <Toast message={toast.message} action={toast.undo ? "Undo" : undefined} onAction={undo} />}
    </>
  );
}

function ContextLine({ ctx, period, presets, customOpen, status, onCustom, onPeriod }: {
  ctx: Ctx; period: Period; presets: PeriodPreset[]; customOpen: boolean; status: string;
  onCustom: (open: boolean) => void; onPeriod: (p: Period) => void;
}) {
  const { range } = ctx.analysis;
  const dayCount = Math.round((Date.parse(range.last_day) - Date.parse(range.first_day)) / 86_400_000) + 1;
  const presetValue = "preset" in period ? period.preset : "custom";
  const pastExport = ctx.dataAsOf && ctx.dataAsOf < range.last_day;
  return (
    <div className="context">
      <label className="faint" htmlFor="period">Period</label>
      <select id="period" className="select" value={customOpen ? "custom" : presetValue}
        onChange={(e) => { if (e.target.value === "custom") onCustom(true); else { onCustom(false); onPeriod({ preset: e.target.value }); } }}>
        {(["calendar", "rolling"] as const).map((kind) => (
          <optgroup key={kind} label={kind === "calendar" ? "Calendar" : "Rolling (up to today)"}>
            {presets.filter((p) => p.kind === kind).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </optgroup>
        ))}
        <option value="custom">Custom range…</option>
      </select>
      {customOpen && <CustomRange initial={"start" in period ? period : { start: range.first_day, end: range.last_day }} onApply={onPeriod} />}
      <span>{fmtRange(range.first_day, range.last_day)} · {dayCount} days · {range.timezone} · week starts {range.week_start.slice(0, 3)}
        {ctx.today >= range.first_day && ctx.today <= range.last_day ? " · today in progress" : ""}
        {pastExport ? ` · data as of ${ctx.dataAsOf}: later days are not in this file` : ""}</span>
      {status === "updating" && <span>Updating…</span>}
    </div>
  );
}

function TopBar({ page, setPage, hasData, issues, slot }: { page: Page; setPage: (p: Page) => void; hasData: boolean; issues: number; slot?: ReactNode }) {
  return (
    <nav className="topbar" aria-label="Main">
      <span className="brand">Time Analyzer</span>
      {hasData && (
        <div className="nav">
          <button aria-current={page === "overview" ? "page" : undefined} onClick={() => setPage("overview")}>Overview</button>
        </div>
      )}
      <div className="right">
        {slot}
        {hasData && <button className="badge" aria-current={page === "quality" ? "page" : undefined} onClick={() => setPage("quality")}>Data quality{issues > 0 && <> <span className="icon">△</span> {issues}</>}</button>}
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
