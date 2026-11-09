export function Field({
  label,
  name,
  error,
  hint,
  ...input
}: { label: string; name: string; error?: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="field">
      <span>
        {label} {hint && <small>{hint}</small>}
      </span>
      <input name={name} aria-invalid={Boolean(error)} {...input} />
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

export function Choice({
  legend,
  name,
  options,
  error,
  defaultValue,
  stacked,
}: {
  legend: string;
  name: string;
  options: [string, string][];
  error?: string;
  defaultValue?: string;
  stacked?: boolean;
}) {
  return (
    <fieldset className="field" aria-invalid={Boolean(error)}>
      <legend>{legend}</legend>
      <div className={stacked ? "choices choices--stacked" : "choices"}>
        {options.map(([value, label]) => (
          <label key={value}>
            <input type="radio" name={name} value={value} defaultChecked={defaultValue === value} /> {label}
          </label>
        ))}
      </div>
      {error && <span className="field-error">{error}</span>}
    </fieldset>
  );
}
