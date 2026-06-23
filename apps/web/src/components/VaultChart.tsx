"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fetchLagoonHistory, type SeriesPoint, type VaultHistory } from "@/lib/lagoon";
import { formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

type Metric = "price" | "nav";
type Range = "7D" | "30D" | "ALL";

const RANGES: Range[] = ["7D", "30D", "ALL"];
const RANGE_MS: Record<Range, number> = { "7D": 604_800_000, "30D": 2_592_000_000, ALL: Infinity };

// One mark per day — date-only axis labels; the tooltip still shows the real
// settle time (the series is already downsampled to one point per UTC day in
// fetchLagoonHistory, keeping each kept point's true timestamp).
const axisFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const tipFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

function ChartTooltip({
  active,
  payload,
  metric,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload: SeriesPoint }>;
  metric: Metric;
}): React.JSX.Element | null {
  const p = active && payload && payload.length > 0 ? payload[0]!.payload : null;
  if (!p) return null;
  return (
    <div className="rounded-md border border-border bg-bg px-3 py-2 text-xs shadow-lg">
      <div className="text-faint">{tipFmt.format(new Date(p.t))}</div>
      <div className="mt-0.5 font-mono text-ink">
        {metric === "price" ? p.v.toFixed(4) : formatUsd(p.v)}
      </div>
    </div>
  );
}

export function VaultChart(): React.JSX.Element {
  // Sourced from Lagoon's indexer (on-chain settlement history) — durable,
  // survives backend redeploys, nothing stored on our side.
  const { data, error } = useSWR<VaultHistory>("lagoon-history", fetchLagoonHistory, {
    refreshInterval: 60_000,
    keepPreviousData: true,
  });
  const [metric, setMetric] = useState<Metric>("price");
  const [range, setRange] = useState<Range>("ALL");

  const points = useMemo<SeriesPoint[]>(() => {
    // Series is already one-point-per-UTC-day (downsampled in fetchLagoonHistory).
    const all = (metric === "price" ? data?.sharePrice : data?.nav) ?? [];
    const cutoff = range === "ALL" ? 0 : (all.at(-1)?.t ?? 0) - RANGE_MS[range];
    return all.filter((p) => p.t >= cutoff);
  }, [data, metric, range]);

  const up = points.length >= 2 && points.at(-1)!.v >= points[0]!.v;
  const stroke = up ? "#3DA5B0" : "#A74F39"; // accent / negative — never generic green/red

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex rounded-md border border-border" role="tablist" aria-label="Chart metric">
          {(
            [
              { id: "price", label: "Share price" },
              { id: "nav", label: "NAV" },
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={metric === m.id}
              onClick={() => setMetric(m.id)}
              className={cn(
                "px-3 py-1.5 text-xs font-semibold transition-colors",
                metric === m.id ? "bg-brand text-ink" : "text-muted hover:text-ink",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="flex rounded-md border border-border">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={cn(
                "px-2.5 py-1 text-[11px] font-semibold transition-colors",
                range === r ? "bg-brand text-ink" : "text-muted hover:text-ink",
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="h-64">
        {points.length < 2 ? (
          <div className="flex h-full items-center justify-center text-center text-sm text-faint">
            {error ? "Couldn't load history." : "No settlement history yet."}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="navFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={stroke} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="t"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(t: number) => axisFmt.format(new Date(t))}
                stroke="#466267"
                tick={{ fill: "#92B0B3", fontSize: 11 }}
                tickLine={false}
                minTickGap={48}
              />
              <YAxis
                domain={["auto", "auto"]}
                width={64}
                tickFormatter={(v: number) =>
                  metric === "price" ? v.toFixed(4) : `$${Math.round(v).toLocaleString("en-US")}`
                }
                stroke="#466267"
                tick={{ fill: "#92B0B3", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              {metric === "price" && <ReferenceLine y={1} stroke="#466267" strokeDasharray="4 4" />}
              <Tooltip
                content={(props) => (
                  <ChartTooltip
                    active={props.active}
                    payload={props.payload as ReadonlyArray<{ payload: SeriesPoint }> | undefined}
                    metric={metric}
                  />
                )}
              />
              <Area
                type="monotone"
                dataKey="v"
                stroke={stroke}
                strokeWidth={2}
                fill="url(#navFill)"
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}
