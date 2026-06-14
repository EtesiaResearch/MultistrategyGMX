import type { StatusPosition } from "@etesia/shared";
import { formatPercent, formatPrice, formatSignedUsd, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

export function PositionsTable({
  positions,
  loading,
}: {
  positions: StatusPosition[];
  loading: boolean;
}): React.JSX.Element {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead className="bg-surface text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-4 py-3">Market</th>
            <th className="px-4 py-3 text-right">Size (USD)</th>
            <th className="px-4 py-3 text-right">Entry</th>
            <th className="px-4 py-3 text-right">Mark</th>
            <th className="px-4 py-3 text-right">PnL (ROE %)</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td className="px-4 py-6 text-muted" colSpan={5}>
                Loading…
              </td>
            </tr>
          ) : positions.length === 0 ? (
            <tr>
              <td className="px-4 py-6 text-faint" colSpan={5}>
                No open positions.
              </td>
            </tr>
          ) : (
            positions.map((p) => {
              // Defensive: an older backend won't send pnl/price fields.
              const hasPnl = Number.isFinite(p.pnlUsd);
              const up = hasPnl && p.pnlUsd >= 0;
              return (
                <tr key={`${p.symbol}-${p.isLong}`} className="border-t border-border">
                  <td className={cn("border-l-2 px-4 py-3", p.isLong ? "border-accent" : "border-negative")}>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-ink">{p.symbol}</span>
                      {p.leverage != null && (
                        <span className="rounded bg-faint/20 px-1.5 py-0.5 text-[10px] font-semibold text-muted ring-1 ring-inset ring-faint/40">
                          {p.leverage % 1 === 0 ? p.leverage : p.leverage.toFixed(1)}x
                        </span>
                      )}
                    </div>
                    <div className={cn("text-xs", p.isLong ? "text-accent" : "text-negative")}>
                      {p.isLong ? "Long" : "Short"}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono">{formatUsd(p.sizeUsd)}</td>
                  <td className="px-4 py-3 text-right font-mono">{formatPrice(String(p.entryPrice))}</td>
                  <td className="px-4 py-3 text-right font-mono">{formatPrice(String(p.markPrice))}</td>
                  <td className={cn("px-4 py-3 text-right font-mono", !hasPnl ? "text-faint" : up ? "text-accent" : "text-negative")}>
                    <div>{hasPnl ? formatSignedUsd(p.pnlUsd) : "—"}</div>
                    {hasPnl && p.roePct != null && (
                      <div className="text-xs opacity-80">({formatPercent(p.roePct)})</div>
                    )}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
