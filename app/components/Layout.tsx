import type { ReactNode } from "react";
import { Link } from "react-router";

/** Blue title bar at the top of a page, with an optional ← Back button and actions on the right. */
export function PageHead({ title, sub, back, actions }: { title: ReactNode; sub?: ReactNode; back?: { to: string; label: string }; actions?: ReactNode }) {
  return (
    <header className="page-head">
      {(back || actions) && (
        <div className="page-head-top">
          {back ? <Link to={back.to} className="back-btn">← {back.label}</Link> : <span />}
          {actions && <div className="page-head-actions">{actions}</div>}
        </div>
      )}
      <h1>{title}</h1>
      {sub && <p className="page-head-sub">{sub}</p>}
    </header>
  );
}

export type Tab = { key: string; to: string; label: string; icon: string; count?: number; alert?: boolean };

/** Big icon buttons that switch between parts of a department; the current one is green. */
export function TabBar({ tabs, active }: { tabs: Tab[]; active: string }) {
  return (
    <nav className="tabbar" aria-label="Sections">
      {tabs.map((t) => (
        <Link key={t.key} to={t.to} className={`tab${t.key === active ? " is-active" : ""}`} aria-current={t.key === active ? "page" : undefined} preventScrollReset>
          <span className="tab-icon" aria-hidden="true">{t.icon}</span>
          <span className="tab-label">{t.label}</span>
          {t.count !== undefined && <span className={`tab-count${t.alert && t.count ? " is-alert" : ""}`}>{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

/** A form that stays folded behind a "＋ Add …" button until tapped. */
export function AddPanel({ label, open, children }: { label: string; open?: boolean; children: ReactNode }) {
  return (
    <details className="add-panel" open={open || undefined}>
      <summary><span className="add-icon" aria-hidden="true">＋</span>{label}</summary>
      <div className="add-panel-body">{children}</div>
    </details>
  );
}

/** White card around a block (filters, a table, a list). */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className}`}>{children}</div>;
}
