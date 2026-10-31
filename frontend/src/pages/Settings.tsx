import { useEffect, useState } from "react";
import { WEEKDAYS } from "../lib/time";
import type { Settings as SettingsT } from "../lib/types";

const SLOTS = 9;

interface Props {
  settings: SettingsT;
  source: string;
  onSave: (settings: SettingsT) => Promise<string[] | null>;  // problems, or null when saved
}

/** Edit config.yaml through the API. Saving re-runs the analysis when a file is loaded. */
export default function Settings({ settings, source, onSave }: Props) {
  const [draft, setDraft] = useState<SettingsT>(structuredClone(settings));
  const [problems, setProblems] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  useEffect(() => setDraft(structuredClone(settings)), [settings]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  const update = (change: Partial<SettingsT>) => { setDraft({ ...draft, ...change }); setSaved(false); };
  const names = Object.keys(draft.categories);
  const move = (name: string, by: number) => {
    const order = [...names];
    const i = order.indexOf(name);
    order.splice(i, 1);
    order.splice(Math.max(0, Math.min(order.length, i + by)), 0, name);
    update({ categories: Object.fromEntries(order.map((n) => [n, draft.categories[n]])) });
  };
  const addCategory = () => {
    const name = newCategory.trim().toUpperCase();
    if (!name || name in draft.categories) return;
    const used = new Set(Object.values(draft.categories).map((c) => c.color));
    const free = Array.from({ length: SLOTS }, (_, i) => i + 1).find((s) => !used.has(s)) ?? null;
    update({ categories: { ...draft.categories, [name]: { focus: false, color: free } } });
    setNewCategory("");
  };
  const remove = (name: string) => {
    const { [name]: _, ...rest } = draft.categories;
    update({ categories: rest });
  };
  const save = async () => {
    setBusy(true);
    const result = await onSave(draft);
    setBusy(false);
    setProblems(result ?? []);
    setSaved(result === null);
  };

  return (
    <div className="form">
      <h1>Settings</h1>
      <p className="faint small">Saved in {source === "config.yaml" ? "your config.yaml" : "config.yaml (you are using the example settings until you save)"}. Saving rewrites the file; hand-written comments in it are not kept.</p>
      {problems.length > 0 && <div className="notice error" role="alert">These settings can't be saved:<ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul></div>}
      {saved && <div className="notice ok" role="status">Saved. Results updated.</div>}

      <div className="field">
        <label htmlFor="tz">Timezone</label>
        <input id="tz" className="input" value={draft.timezone} onChange={(e) => update({ timezone: e.target.value })} />
        <div className="hint">A TZ database name, e.g. Asia/Tehran or Europe/Berlin.</div>
      </div>
      <div className="field">
        <label htmlFor="ws">Week starts on</label>
        <select id="ws" className="select" value={draft.week_start} onChange={(e) => update({ week_start: e.target.value })}>
          {WEEKDAYS.map((d) => <option key={d}>{d}</option>)}
        </select>
      </div>
      <fieldset className="field" style={{ border: 0, padding: 0 }}>
        <legend style={{ fontWeight: 500, marginBottom: 4 }}>Days off (your weekend)</legend>
        <div className="days">
          {WEEKDAYS.map((d) => (
            <label key={d} style={{ fontWeight: 400 }}>
              <input type="checkbox" checked={draft.days_off.includes(d)}
                onChange={(e) => update({ days_off: e.target.checked ? WEEKDAYS.filter((x) => x === d || draft.days_off.includes(x)) : draft.days_off.filter((x) => x !== d) })} /> {d}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="field">
        <label>Categories</label>
        <div className="hint">Order = order in charts. Colors stay with the name. Focus = counts toward focus sessions. Categories after the 9th share a grey.</div>
        {names.map((name, i) => {
          const cat = draft.categories[name];
          return (
            <div className="catrow" key={name}>
              <span className="swatch" style={{ background: cat.color ? `var(--cat-${cat.color})` : "var(--other)" }} />
              <span className="name cat">{name}</span>
              <label style={{ fontWeight: 400 }}><input type="checkbox" checked={cat.focus} onChange={(e) => update({ categories: { ...draft.categories, [name]: { ...cat, focus: e.target.checked } } })} /> focus</label>
              <button className="btn" disabled={i === 0} onClick={() => move(name, -1)} aria-label={`Move ${name} up`}>↑</button>
              <button className="btn" disabled={i === names.length - 1} onClick={() => move(name, 1)} aria-label={`Move ${name} down`}>↓</button>
              <button className="btn" onClick={() => remove(name)} aria-label={`Remove ${name}`}>Remove</button>
            </div>
          );
        })}
        <div className="catrow">
          <input className="input" placeholder="New category, e.g. GYM" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCategory()} />
          <button className="btn" onClick={addCategory}>Add</button>
        </div>
      </div>

      <div className="field">
        <label htmlFor="fm">Focus block minimum (minutes)</label>
        <input id="fm" className="input" type="number" min={0} value={draft.focus.min_minutes} onChange={(e) => update({ focus: { min_minutes: Number(e.target.value) } })} />
      </div>
      <div className="field">
        <label htmlFor="tags">Known tags</label>
        <input id="tags" className="input" style={{ width: "100%" }} value={draft.tags.known.join(", ")} onChange={(e) => update({ tags: { known: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) } })} />
        <div className="hint">Comma separated, without #. Other tags are allowed but listed on Data quality.</div>
      </div>
      <div className="field">
        <label>Old categories</label>
        <div className="hint">{Object.entries(draft.legacy_categories).map(([n, r]) => `${n} → ${r.map_to ?? "own group"}${r.add_tags.length ? ` (+#${r.add_tags.join(" #")})` : ""}`).join(" · ") || "None"}. Edit in config.yaml.</div>
      </div>
      <div className="field">
        <label>Title syntax</label>
        <div className="hint"><code>CATEGORY: task #tag +project [score]</code>; <code>{draft.syntax.subcategory_separator}</code> splits a block's time evenly. Read-only.</div>
      </div>
      <div><button className="btn primary" disabled={!dirty || busy} onClick={save}>{busy ? "Saving…" : "Save"}</button></div>
    </div>
  );
}
