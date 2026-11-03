import { useEffect, type CSSProperties, type ReactNode, type RefObject } from "react";
import { colorVar } from "../lib/theme";
import type { Settings } from "../lib/types";

/**
 * One chart card (new-ui): the question is the small label and the computed takeaway is the headline.
 * Without a takeaway the question itself is the headline.
 */
export function Card({ title, lede, controls, caption, className, dot, children }: {
  /** Kept for the page's own bookkeeping (O1, R4, D2…); not drawn. */
  code?: string;
  title: string;
  /** The chart's answer in one sentence, computed from the same numbers. */
  lede?: ReactNode;
  controls?: ReactNode; caption?: ReactNode; className?: string;
  /** A category dot before the question (O2 follows the category picked in O1). */
  dot?: string;
  children: ReactNode;
}) {
  return (
    <section className={`card ${className ?? ""}`} aria-label={title}>
      <header className="card-head">
        <div className="titles">
          {lede ? (
            <>
              <h2 className="question">{dot && <span className="dot8" style={{ background: dot }} />}{title}</h2>
              <p className="takeaway">{lede}</p>
            </>
          ) : <h2 className="takeaway">{title}</h2>}
        </div>
        {controls && <div className="controls">{controls}</div>}
      </header>
      {children}
      {caption && <div className="caption">{caption}</div>}
    </section>
  );
}

/** "WHERE IT WENT · 30 Sep – 29 Oct": the small heading between groups of cards. */
export function SectionHead({ title, note }: { title: string; note?: ReactNode }) {
  return (
    <div className="sechead">
      <h2 className="eyebrow strong">{title}</h2>
      {note && <span>{note}</span>}
    </div>
  );
}

export function StatTile({ label, value, unit, context, context2, previous, previousPrefix = true, children }: {
  label: string; value: string; unit?: string; context?: ReactNode;
  /** A second, quieter context line (Rhythm's "days off 01:38"). */
  context2?: ReactNode;
  /** The previous period's value; drawn as "prev. 92%". */
  previous?: string | null;
  previousPrefix?: boolean;
  /** A small picture under the context: the Logged meter, the Per day sparkline. */
  children?: ReactNode;
}) {
  return (
    <div className="tile">
      <div className="label">{label}</div>
      <div className="value">{value}{unit && <span className="unit">{unit}</span>}</div>
      {context && <div className={`ctx${context2 ? " strong" : ""}`}>{context}</div>}
      {context2 && <div className="ctx">{context2}</div>}
      {children}
      {previous && <div className="prev">{previousPrefix ? `prev. ${previous}` : previous}</div>}
    </div>
  );
}

/** O4's category mix: one bar per category, in the category colors. */
export function MixBar({ parts, settings }: { parts: { key: string; hours: number }[]; settings: Settings }) {
  const total = parts.reduce((a, part) => a + part.hours, 0) || 1;
  return (
    <span className="mixbar" role="img" aria-label={parts.map((part) => `${part.key} ${part.hours.toFixed(1)} h`).join(", ")}>
      {parts.map((part) => (
        <span key={part.key} title={`${part.key} ${part.hours.toFixed(1)} h`}
          style={{ width: `${(part.hours / total) * 100}%`, background: `var(--${colorVar(part.key, settings)})` }} />
      ))}
    </span>
  );
}

export function NotEnoughData({ first, second, action }: { first: string; second: string; action?: ReactNode }) {
  return (
    <div className="empty" role="status">
      <div className="first">{first}</div>
      <div className="second">{second}</div>
      {action}
    </div>
  );
}

/** A segmented control (period, day type, "divide by"). */
export function Segmented<T extends string>({ options, value, onChange, disabled = {}, label, labels }: {
  options: T[]; value: T; onChange: (v: T) => void;
  /** Option -> why it can't be chosen (shown as its tooltip). */
  disabled?: Partial<Record<T, string>>;
  label?: string;
  labels?: Partial<Record<T, string>>;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o} type="button" aria-pressed={o === value} disabled={!!disabled[o]} title={disabled[o]}
          onClick={() => onChange(o)}>
          {labels?.[o] ?? o}
        </button>
      ))}
    </div>
  );
}

/** Close a popover on Escape or on a press outside `ref`. */
export function useDismiss(open: boolean, close: () => void, ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onPress = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("mousedown", onPress);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onPress); window.removeEventListener("keydown", onKey); };
  }, [open, close, ref]);
}

export interface TipRow {
  name: string;
  value: string;
  /** Swatch background; "nif" draws the dotted "not yet" swatch, "hatch" the unlogged one. */
  fill: string;
}

/** The hover card over the HTML charts. */
export function Tooltip({ style, title, tag, rows = [], line, foot }: {
  style: CSSProperties; title: string; tag?: string; rows?: TipRow[]; line?: ReactNode; foot?: ReactNode;
}) {
  return (
    <div className="tip" style={style}>
      <div className="tip-head"><span>{title}</span>{tag && <span>{tag}</span>}</div>
      {rows.map((r) => (
        <div className="tip-row" key={r.name}>
          <Swatch fill={r.fill} />
          <span className="name">{r.name}</span><span className="val">{r.value}</span>
        </div>
      ))}
      {line && <div className="tip-line">{line}</div>}
      {foot && <div className={rows.length ? "tip-foot" : "tip-quiet"}>{foot}</div>}
    </div>
  );
}

/** A small key square in a category fill, the hatch, or the dotted "not yet" outline. */
export function Swatch({ fill }: { fill: string }) {
  if (fill === "nif") return <span className="sw8 nif" />;
  const unlogged = fill === "var(--hatch)";
  return <span className="sw8" style={{ background: fill, boxShadow: unlogged ? "inset 0 0 0 1px var(--unlogged-edge)" : undefined }} />;
}
