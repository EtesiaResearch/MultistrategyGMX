import type { HistorySample, StatusResponse } from "@etesia/shared";

// Backend base URL (the GMX-aware NAV oracle service). CORS is wide-open there.
export const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8080";

export async function fetchStatus(): Promise<StatusResponse> {
  const res = await fetch(`${BACKEND_URL}/status`, { cache: "no-store" });
  if (!res.ok) throw new Error(`backend /status -> ${res.status}`);
  return (await res.json()) as StatusResponse;
}

// NAV/share-price time series for the chart (one sample per backend NAV cycle).
export async function fetchHistory(): Promise<HistorySample[]> {
  const res = await fetch(`${BACKEND_URL}/history`, { cache: "no-store" });
  if (!res.ok) throw new Error(`backend /history -> ${res.status}`);
  return (await res.json()) as HistorySample[];
}

export type { HistorySample, StatusResponse };
