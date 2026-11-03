import { useEffect, useState } from "react";
import type { Goal, GoalEvery, GoalType, Settings } from "../lib/types";

const TYPES: { value: GoalType; label: string }[] = [
  { value: "floor", label: "at least" },
  { value: "cap", label: "at most" },
  { value: "range", label: "between" },
  { value: "fixed", label: "fixed schedule" },
];

const blank = (category: string): Goal =>
  ({ id: `${category.toLowerCase()}-week`, scope: category, every: "week", type: "floor", hours: 10 });

interface Props {
  goals: Goal[];
  path: string;
  settings: Settings;
  onSave: (goals: Goal[]) => Promise<string[] | null>;  // problems, or null when saved
}

/** Add, change and remove goals. Editing a goal's hours changes it everywhere, including past periods. */
export default function GoalsEditor({ goals, path, settings, onSave }: Props) {
  const [draft, setDraft] = useState<Goal[]>(structuredClone(goals));
  const [problems, setProblems] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(structuredClone(goals)), [goals]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(goals);
  const categories = Object.keys(settings.categories);

  const change = (i: number, patch: Partial<Goal>) => {
    setDraft(draft.map((goal, at) => (at === i ? { ...goal, ...patch } : goal)));
    setSaved(false);
  };
  const save = async () => {
    setBusy(true);
    const result = await onSave(draft);
    setBusy(false);
    setProblems(result ?? []);
    setSaved(result === null);
  };

  return (
    <div className="field">
      <label>Goals</label>
      <div className="hint">
        What you want your weeks and months to look like. Shown at the top of Overview, judged over this week and
        this calendar month. Saved in <code>{path}</code>. Changing a goal's hours re-judges earlier periods too.
      </div>
      {problems.length > 0 && <div className="notice error" role="alert">These goals can't be saved:<ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul></div>}
      {saved && <div className="notice ok" role="status">Goals saved.</div>}

      {draft.length === 0 && <p className="faint">No goals yet.</p>}
      {draft.map((goal, i) => (
        <div className="goaledit" key={i}>
          <select className="select" aria-label="Category" value={goal.scope.split(":")[0].trim()}
            onChange={(e) => change(i, { scope: goal.scope.includes(":") ? `${e.target.value}: ${goal.scope.split(":")[1].trim()}` : e.target.value })}>
            {categories.map((c) => <option key={c}>{c}</option>)}
          </select>
          <input className="input" aria-label="Sub-category (optional)" placeholder="sub-category (optional)"
            value={goal.scope.includes(":") ? goal.scope.split(":")[1].trim() : ""}
            onChange={(e) => change(i, { scope: e.target.value.trim() ? `${goal.scope.split(":")[0].trim()}: ${e.target.value}` : goal.scope.split(":")[0].trim() })} />
          <select className="select" aria-label="Every" value={goal.every}
            onChange={(e) => change(i, { every: e.target.value as GoalEvery })}>
            <option value="week">every week</option>
            <option value="month">every month</option>
          </select>
          <select className="select" aria-label="Goal type" value={goal.type}
            onChange={(e) => change(i, { type: e.target.value as GoalType })}>
            {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          {goal.type === "range" ? (
            <>
              <input className="input hours" type="number" min={0} step={0.5} aria-label="Minimum hours"
                value={goal.min ?? 0} onChange={(e) => change(i, { min: Number(e.target.value) })} />
              <span className="faint">–</span>
              <input className="input hours" type="number" min={0} step={0.5} aria-label="Maximum hours"
                value={goal.max ?? 0} onChange={(e) => change(i, { max: Number(e.target.value) })} />
              <span className="faint">h</span>
            </>
          ) : goal.type === "fixed" ? <span className="faint small">hours are shown, never judged</span> : (
            <>
              <input className="input hours" type="number" min={0} step={0.5} aria-label="Hours"
                value={goal.hours ?? 0} onChange={(e) => change(i, { hours: Number(e.target.value) })} />
              <span className="faint">h</span>
            </>
          )}
          <button className="btn" onClick={() => { setDraft(draft.filter((_, at) => at !== i)); setSaved(false); }}
            aria-label={`Remove the ${goal.scope} goal`}>Remove</button>
        </div>
      ))}
      <div className="goaledit">
        <button className="btn" onClick={() => { setDraft([...draft, blank(categories[0] ?? "LEARN")]); setSaved(false); }}>
          Add a goal
        </button>
        <button className="btn primary" disabled={!dirty || busy} onClick={save}>{busy ? "Saving…" : "Save goals"}</button>
      </div>
    </div>
  );
}
