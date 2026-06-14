import type { StatusPosition } from "@etesia/shared";
import { formatSignedUsd, formatUsd } from "@/lib/format";

export function PositionsTable({
  positions,
  loading,
}: {
  positions: StatusPosition[];
  loading: boolean;
}): React.JSX.Element {
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead className="bg-surface text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-4 py-3">Market</th>
            <th className="px-4 py-3">Side</th>
            <th className="px-4 py-3 text-right">Size (USD)</th>
            <th className="px-4 py-3 text-right">Net value</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td className="px-4 py-6 text-muted" colSpan={4}>
                Loading…
              </td>
            </tr>
          ) : positions.length === 0 ? (
            <tr>
              <td className="px-4 py-6 text-faint" colSpan={4}>
                No open positions.
              </td>
            </tr>
          ) : (
            positions.map((p) => (
              <tr key={`${p.symbol}-${p.isLong}`} className="border-t border-border">
                <td className="px-4 py-3 font-medium text-ink">{p.symbol}</td>
                <td className={`px-4 py-3 ${p.isLong ? "text-accent" : "text-negative"}`}>
                  {p.isLong ? "LONG" : "SHORT"}
                </td>
                <td className="px-4 py-3 text-right font-mono">{formatUsd(p.sizeUsd)}</td>
                <td className="px-4 py-3 text-right font-mono">{formatSignedUsd(p.netValueUsd)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
