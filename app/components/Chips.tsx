import { Link, useLocation } from "react-router";

/**
 * Filter buttons with counts, e.g. "All 40 · CS 12 · IT 10". Each is a link that sets one URL
 * parameter and keeps the others, so filters combine and the page works without JavaScript.
 */
export function Chips<K extends string>({
  label,
  param,
  value,
  options,
  counts,
  allLabel,
}: {
  label: string;
  param: string;
  value: K | null;
  options: [K, string][];
  counts: Record<K | "all", number>;
  allLabel: string;
}) {
  const location = useLocation();
  const href = (v: K | null) => {
    const p = new URLSearchParams(location.search);
    if (v) p.set(param, v);
    else p.delete(param);
    const s = p.toString();
    return s ? `?${s}` : location.pathname;
  };
  return (
    <div className="chips" role="group" aria-label={label}>
      <span className="chips-label">{label}</span>
      <Link to={href(null)} className="chip" aria-current={value === null}>
        {allLabel} <b>{counts.all}</b>
      </Link>
      {options.map(([k, text]) => (
        <Link key={k} to={href(k)} className="chip" aria-current={value === k}>
          {text} <b>{counts[k]}</b>
        </Link>
      ))}
    </div>
  );
}
