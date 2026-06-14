/** A single metric card. Shows a pulsing placeholder while the first sample loads. */
export function Stat({
  label,
  value,
  hint,
  loading = false,
}: {
  label: string;
  value: string;
  hint?: string | undefined;
  loading?: boolean;
}): React.JSX.Element {
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      {loading ? (
        <div className="mt-2 h-8 w-24 animate-pulse rounded bg-border/70" />
      ) : (
        <div className="mt-2 font-mono text-2xl text-ink">{value}</div>
      )}
      {hint ? <div className="mt-1 text-xs text-faint">{hint}</div> : null}
    </div>
  );
}
