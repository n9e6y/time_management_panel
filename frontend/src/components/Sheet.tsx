import type { ReactNode } from "react";

/** A small modal question. The safe choice comes first and is the main button. */
export default function Sheet({ title, children, actions }: { title: string; children: ReactNode; actions: ReactNode }) {
  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
      <div className="box">
        <h2>{title}</h2>
        {children}
        <div className="actions">{actions}</div>
      </div>
    </div>
  );
}

export function Toast({ message, action, onAction }: { message: string; action?: string; onAction?: () => void }) {
  return (
    <div className="toast" role="status">
      <span>{message}</span>
      {action && <button className="linkbtn" onClick={onAction}>{action}</button>}
    </div>
  );
}
