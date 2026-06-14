import { arbitrum } from "wagmi/chains";
import { VAULT_ADDRESS } from "./vault";

/**
 * Minimal Lagoon GraphQL client — used only for the withdraw countdown (the
 * timestamp of the user's latest redeem request). The vault chain state is
 * read onchain via wagmi; performance history comes from our own backend.
 *
 * POST-only; CORS is `*` so the browser calls it directly.
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
 * none is indexed yet. Drives the withdraw "claimable within 48h" countdown —
 * redemptions wait for funds to be unwound from the trading account, so they
 * do NOT settle at the next NAV tick.
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
