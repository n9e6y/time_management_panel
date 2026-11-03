import type { ReactNode } from "react";
import { colorVar } from "../lib/theme";
import type { Settings } from "../lib/types";

export function Card({ code, title, lede, controls, caption, className, children }: {
  code?: string; title: string;
  /** The chart's answer in one sentence, computed from the same numbers (tokens.md `--fs-lede`). */
  lede?: ReactNode;
  controls?: ReactNode; caption?: ReactNode; className?: string; children: ReactNode;
}) {
  return (
    <section className={`card ${className ?? ""}`} aria-label={title}>
      <header>
        {code && <span className="code">{code}</span>}
        <h2>{title}</h2>
        {controls && <div className="controls">{controls}</div>}
      </header>
      {lede && <p className="lede">{lede}</p>}
      {children}
      {caption && <div className="caption">{caption}</div>}
    </section>
  );
}

/** DAY, WEEK, NIGHTS, MONTHS on Rhythm: small headings that help scanning, not tabs. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return <h3 className="sectionlabel">{children}</h3>;
}

export function StatTile({ label, value, unit, context, previous, previousPrefix = true }: {
  label: string; value: string; unit?: string; context?: ReactNode;
  /** A second context line. On Overview's tiles it is the previous period, so it reads "prev. 92%". */
  previous?: ReactNode;
  /** false on tiles where the second line is not a previous-period number (R4's medians). */
  previousPrefix?: boolean;
}) {
  return (
    <div className="tile">
      <div className="label">{label}</div>
      <div className="value">{value}{unit && <span className="unit">{" "}{unit}</span>}</div>
      {context && <div className="ctx">{context}</div>}
      {previous && <div className="ctx prev">{previousPrefix ? "prev. " : ""}{previous}</div>}
    </div>
  );
}

/** O4's category mix: one stacked bar per row, 10px high, in the same category colors (tokens.md §12). */
export function MixBar({ parts, settings, width = 140 }: {
  parts: { key: string; hours: number }[]; settings: Settings; width?: number;
}) {
  const total = parts.reduce((a, part) => a + part.hours, 0) || 1;
  let x = 0;
  return (
    <svg width={width} height={10} role="img"
      aria-label={parts.map((part) => `${part.key} ${part.hours.toFixed(1)} h`).join(", ")}>
      {parts.map((part) => {
        const w = (part.hours / total) * width;
        const rect = (
          <rect key={part.key} x={x} y={0} width={Math.max(1, w)} height={10} rx={1}
            fill={`var(--${colorVar(part.key, settings)})`} />
        );
        x += w;
        return rect;
      })}
    </svg>
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

export function Segmented<T extends string>({ options, value, onChange, disabled = {} }: {
  options: T[]; value: T; onChange: (v: T) => void; disabled?: Partial<Record<T, string>>;
}) {
  return (
    <div className="segmented" role="group">
      {options.map((o) => (
        <button key={o} type="button" aria-pressed={o === value} disabled={!!disabled[o]} title={disabled[o]} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}
