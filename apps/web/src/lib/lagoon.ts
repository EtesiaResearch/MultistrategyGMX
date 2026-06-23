import { arbitrum } from "wagmi/chains";
import { VAULT_ADDRESS } from "./vault";

/**
 * Lagoon GraphQL client. The vault's price/NAV history is reconstructed from
 * on-chain settlement events by Lagoon's indexer — durable, survives any
 * backend redeploy, nothing to store on our side. Also used for the withdraw
 * countdown (the user's latest redeem-request timestamp).
 *
 * POST-only; CORS is `*` so the browser calls it directly. The BigInt scalar
 * serializes as a JSON number when small and a string when large — always go
 * through `BigInt(String(v))`.
 */
const LAGOON_API_URL =
  process.env.NEXT_PUBLIC_LAGOON_API_URL ?? "https://api.lagoon.finance/query";

const CHAIN_ID = arbitrum.id;

async function lagoonQuery<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(LAGOON_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Lagoon API responded ${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors !== undefined && json.errors.length > 0) {
    throw new Error(`Lagoon API: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  if (json.data === undefined) throw new Error("Lagoon API: empty response");
  return json.data;
}

/** One chart point — `t` in milliseconds (epoch), `v` a display float. */
export interface SeriesPoint {
  t: number;
  v: number;
}

export interface VaultHistory {
  /** Net price per share in asset terms (1.0 at inception) — one point per 12h (00:00 / 12:00 UTC). */
  sharePrice: SeriesPoint[];
  /** NAV (total assets) in USD — one point per 12h (00:00 / 12:00 UTC). */
  nav: SeriesPoint[];
}

interface RawDataPoint {
  x: number;
  y: number | string | null;
}

// Snap-to interval for chart downsampling. p.t is unix MILLIseconds and the epoch
// (1970-01-01) is a UTC midnight, so a 12h bucket lands exactly on 00:00 / 12:00
// UTC — the canonical NAV settle ticks. Set to 86_400_000 for once-daily points.
const BUCKET_MS = 12 * 60 * 60 * 1000; // 43_200_000

/**
 * Downsample a per-settlement series to ONE point per BUCKET_MS window: the
 * settlement closest to each bucket boundary. With BUCKET_MS = 12h the
 * boundaries are 00:00 and 12:00 UTC (the canonical NAV settles); off-cadence
 * intraday settles — and one-off pushes like a manual recovery — are dropped so
 * the chart reads as a clean vault curve.
 *
 * Bucketed by the NEAREST boundary (`round(t / BUCKET_MS)`), not a floor, so a
 * settle at 11:58 and one at 12:02 land in the same bucket and the closer one
 * wins. Pure UTC arithmetic — no timezone lib, DST-immune. The kept point keeps
 * its real settle timestamp (honest tooltip). (Ported from UIVaultHL.)
 */
export function downsampleToBucket(points: readonly SeriesPoint[]): SeriesPoint[] {
  const best = new Map<number, SeriesPoint>();
  for (const p of points) {
    const idx = Math.round(p.t / BUCKET_MS);
    const dist = Math.abs(p.t - idx * BUCKET_MS);
    const cur = best.get(idx);
    if (cur === undefined || dist < Math.abs(cur.t - idx * BUCKET_MS)) best.set(idx, p);
  }
  return [...best.values()].sort((a, b) => a.t - b.t);
}

const HISTORY_QUERY = `
  query VaultHistory($address: Address!, $chainId: Int!) {
    vaultByAddress(address: $address, chainId: $chainId) {
      asset { decimals }
      stateHistory {
        pricePerShare { x y }
        totalAssetsUsd { x y }
      }
    }
  }
`;

/**
 * Price-per-share + NAV history, sourced from Lagoon's indexer (one raw point
 * per settlement — the price only moves on settle), then downsampled to one
 * point per 12h (00:00 / 12:00 UTC). This is the same on-chain data the Lagoon
 * app charts, and it is permanent: it lives on-chain, not on our backend's disk.
 */
export async function fetchLagoonHistory(): Promise<VaultHistory> {
  const data = await lagoonQuery<{
    vaultByAddress: {
      asset: { decimals: number };
      stateHistory: { pricePerShare: RawDataPoint[]; totalAssetsUsd: RawDataPoint[] };
    } | null;
  }>(HISTORY_QUERY, { address: VAULT_ADDRESS, chainId: CHAIN_ID });

  if (data.vaultByAddress === null) return { sharePrice: [], nav: [] };

  const { asset, stateHistory } = data.vaultByAddress;
  const scale = 10 ** asset.decimals;

  const sharePrice = stateHistory.pricePerShare
    .filter((p) => p.y !== null)
    .map((p) => ({ t: p.x * 1000, v: Number(BigInt(String(p.y))) / scale }));
  const nav = stateHistory.totalAssetsUsd
    .filter((p) => p.y !== null)
    .map((p) => ({ t: p.x * 1000, v: Number(p.y) }));

  return {
    sharePrice: downsampleToBucket(sharePrice),
    nav: downsampleToBucket(nav),
  };
}

const LATEST_REDEEM_REQUEST_QUERY = `
  query LatestRedeemRequest($address: Address!, $chainId: Int!, $controller: Address!) {
    transactions(
      first: 1
      skip: 0
      orderBy: timestamp
      orderDirection: desc
      where: { chainId_eq: $chainId, vault_in: [$address], type_in: [RedeemRequest], controller_in: [$controller] }
    ) {
      items { timestamp }
    }
  }
`;

/**
 * Timestamp (unix seconds) of the user's latest RedeemRequest, or null when
 * none is indexed yet. Drives the withdraw "claimable within 48h" countdown.
 */
export async function fetchLatestRedeemRequestTs(controller: string): Promise<number | null> {
  const data = await lagoonQuery<{
    transactions: { items: { timestamp: number | string }[] };
  }>(LATEST_REDEEM_REQUEST_QUERY, {
    address: VAULT_ADDRESS,
    chainId: CHAIN_ID,
    controller,
  });
  const ts = data.transactions.items[0]?.timestamp;
  return ts === undefined ? null : Number(ts);
}
