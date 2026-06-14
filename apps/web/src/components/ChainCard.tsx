/** Static "CHAIN" card — this vault runs on Arbitrum One. Matches the Stat card shell. */
export function ChainCard(): React.JSX.Element {
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="text-xs uppercase tracking-wide text-muted">Chain</div>
      <div className="mt-2 flex items-center gap-2">
        {/* Local asset (trustwallet Arbitrum mark) — next/image is overkill for a 28px icon. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/arbitrum.png" alt="" className="h-7 w-7" />
        <span className="text-2xl text-ink">Arbitrum</span>
      </div>
    </div>
  );
}
