"use client";

import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { Loader2, X } from "lucide-react";
import { useConnect, type Connector } from "wagmi";
import { cn } from "@/lib/utils";

/**
 * A wallet that never answers (locked extension, prompt opened behind the
 * window, extension-war casualties) leaves connect() pending FOREVER. Past this
 * delay we surface an actionable error instead of an eternal spinner.
 */
const CONNECT_TIMEOUT_MS = 30_000;

/**
 * Our connect modal — replaces a wallet-UI kit on purpose (no vendor account,
 * no projectId). Lists EIP-6963-discovered wallets with their self-announced
 * icon + name; the generic `injected` fallback connector is shown only when no
 * EIP-6963 wallet announced itself but `window.ethereum` exists (legacy in-app
 * browsers).
 */
export function ConnectWalletModal({
  open,
  onClose,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
}): JSX.Element | null {
  const { connectors, connectAsync } = useConnect();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ connector: Connector; message: string } | null>(null);
  // Monotonic attempt id: cancel/timeout invalidates late results from a
  // wallet that finally answers after we gave up on it.
  const attemptRef = useRef(0);

  // EIP-6963 wallets self-register with an rdns-based id; the config-defined
  // fallback keeps the literal id "injected".
  const announced = useMemo(() => connectors.filter((c) => c.id !== "injected"), [connectors]);
  const fallback = useMemo(() => connectors.find((c) => c.id === "injected"), [connectors]);
  const hasWindowEthereum =
    typeof window !== "undefined" && (window as { ethereum?: unknown }).ethereum !== undefined;
  const list = announced.length > 0 ? announced : hasWindowEthereum && fallback ? [fallback] : [];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Reset transient state whenever the modal is (re)opened.
  useEffect(() => {
    if (open) {
      setPendingId(null);
      setFailed(null);
    }
  }, [open]);

  if (!open) return null;

  const cancelPending = (): void => {
    attemptRef.current += 1; // invalidate the in-flight attempt
    setPendingId(null);
  };

  const tryConnect = (connector: Connector): void => {
    setFailed(null);
    setPendingId(connector.id);
    const attempt = ++attemptRef.current;
    const stillCurrent = (): boolean => attemptRef.current === attempt;

    const timer = setTimeout(() => {
      if (!stillCurrent()) return;
      attemptRef.current += 1;
      setPendingId(null);
      setFailed({
        connector,
        message: `${connector.name} did not respond. Make sure the extension is unlocked — its prompt may have opened behind this window.`,
      });
    }, CONNECT_TIMEOUT_MS);

    connectAsync({ connector })
      .then(() => {
        clearTimeout(timer);
        // A late success is still a success — the wallet IS connected.
        onClose();
      })
      .catch((err: unknown) => {
        clearTimeout(timer);
        if (!stillCurrent()) return;
        // Surface the wallet's message verbatim — no swallowing.
        const message = err instanceof Error ? err.message : String(err);
        setFailed({ connector, message });
      })
      .finally(() => {
        if (stillCurrent()) setPendingId(null);
      });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Connect a wallet"
        className="w-full max-w-sm rounded-lg border border-border bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">Connect a wallet</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-muted hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-2 p-4">
          {failed !== null ? (
            <div className="flex flex-col gap-3">
              <p className="break-words rounded-md border border-negative/50 bg-negative/10 p-3 text-xs leading-relaxed text-ink">
                {failed.message}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => tryConnect(failed.connector)}
                  className="flex-1 rounded-md bg-brand px-3 py-2 text-sm font-semibold text-ink hover:bg-accent"
                >
                  Retry
                </button>
                <button
                  type="button"
                  onClick={() => setFailed(null)}
                  className="flex-1 rounded-md border border-border px-3 py-2 text-sm text-muted hover:text-ink"
                >
                  Back
                </button>
              </div>
            </div>
          ) : list.length === 0 ? (
            <div className="flex flex-col gap-3 py-2 text-center">
              <p className="text-sm font-semibold text-ink">No wallet detected</p>
              <p className="text-xs text-muted">
                Install a wallet extension, then reload this page.
              </p>
              <div className="flex justify-center gap-3 text-sm">
                <a
                  href="https://rabby.io"
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent hover:underline"
                >
                  Get Rabby
                </a>
                <a
                  href="https://metamask.io/download/"
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent hover:underline"
                >
                  Get MetaMask
                </a>
              </div>
            </div>
          ) : (
            list.map((connector) => {
              const isPending = pendingId === connector.id;
              return (
                <button
                  key={connector.uid}
                  type="button"
                  // The pending row stays clickable: it CANCELS the attempt
                  // (a wallet that never answers must not trap the user).
                  disabled={pendingId !== null && !isPending}
                  onClick={() => (isPending ? cancelPending() : tryConnect(connector))}
                  className={cn(
                    "flex items-center gap-3 rounded-md border border-border bg-bg px-3 py-3 text-left",
                    "hover:border-accent disabled:cursor-not-allowed disabled:opacity-60",
                  )}
                >
                  {connector.icon !== undefined ? (
                    // EIP-6963 icons are data: URIs — next/image cannot load them.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={connector.icon} alt="" className="h-7 w-7 rounded" />
                  ) : (
                    <span className="flex h-7 w-7 items-center justify-center rounded bg-faint/30 text-xs font-bold text-muted">
                      W
                    </span>
                  )}
                  <span className="flex-1 text-sm font-semibold text-ink">
                    {connector.id === "injected" ? "Browser wallet" : connector.name}
                  </span>
                  {isPending && (
                    <span className="flex items-center gap-2 text-xs text-muted">
                      <Loader2 className="h-4 w-4 text-accent motion-safe:animate-spin" />
                      Cancel
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
