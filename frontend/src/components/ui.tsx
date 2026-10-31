import type { ReactNode } from "react";

export function Card({ code, title, controls, caption, className, children }: {
  code?: string; title: string; controls?: ReactNode; caption?: ReactNode; className?: string; children: ReactNode;
}) {
  return (
    <section className={`card ${className ?? ""}`} aria-label={title}>
      <header>
        {code && <span className="code">{code}</span>}
        <h2>{title}</h2>
        {controls && <div className="controls">{controls}</div>}
      </header>
      {children}
      {caption && <div className="caption">{caption}</div>}
    </section>
  );
}

export function StatTile({ label, value, unit, context }: { label: string; value: string; unit?: string; context?: ReactNode }) {
  return (
    <div className="tile">
      <div className="label">{label}</div>
      <div className="value">{value}{unit && <span className="unit">{" "}{unit}</span>}</div>
      {context && <div className="ctx">{context}</div>}
    </div>
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
