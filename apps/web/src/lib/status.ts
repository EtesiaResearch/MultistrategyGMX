import type { StatusResponse } from "@etesia/shared";

// Backend base URL (the GMX-aware NAV oracle service). CORS is wide-open there.
export const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8080";

export async function fetchStatus(): Promise<StatusResponse> {
  const res = await fetch(`${BACKEND_URL}/status`, { cache: "no-store" });
  if (!res.ok) throw new Error(`backend /status -> ${res.status}`);
  return (await res.json()) as StatusResponse;
}

export type { StatusResponse };
