import type { EthDate } from "../lib/ethiopian";
import { useT } from "../lib/use-t";

export function EthDateFields({ value, error }: { value: EthDate; error?: string }) {
  const { tr } = useT();
  const e = tr.events;
  return (
    <fieldset className="field" aria-invalid={Boolean(error)}>
      <legend>{e.date}</legend>
      <div className="eth-date">
        <label>{e.day}<input name="ethDay" type="number" inputMode="numeric" min={1} max={30} defaultValue={value.day} required /></label>
        <label>{e.month}
          <select name="ethMonth" defaultValue={value.month}>
            {tr.months.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </label>
        <label>{e.year}<input name="ethYear" type="number" inputMode="numeric" defaultValue={value.year} required /></label>
      </div>
      {error && <span className="field-error">{error}</span>}
    </fieldset>
  );
}
