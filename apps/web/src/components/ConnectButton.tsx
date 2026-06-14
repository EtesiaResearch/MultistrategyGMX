"use client";

import { useEffect, useRef, useState, type JSX } from "react";
import { Check, ChevronDown, Copy, ExternalLink, LogOut } from "lucide-react";
import { formatUnits } from "viem";
import { useAccount, useBalance, useDisconnect } from "wagmi";
import { ConnectWalletModal } from "./ConnectWalletModal";
import { EXPLORER_URL } from "@/lib/wagmi";
import { formatAmount } from "@/lib/format";
import { cn } from "@/lib/utils";

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Top-bar wallet button. Disconnected → opens our ConnectWalletModal;
 * connected → truncated address + native balance (ETH on Arbitrum) with a
 * small menu (copy / explorer / disconnect).
 */
export function ConnectButton(): JSX.Element {
  const { address } = useAccount();
  const { disconnect } = useDisconnect();
  const { data: balance } = useBalance({
    address,
    query: { refetchInterval: 30_000 },
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent): void => {
      if (menuRef.current !== null && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  if (address === undefined) {
    return (
      <>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="rounded-full bg-cta px-4 py-2 text-sm font-semibold text-ink transition hover:brightness-110"
        >
          Connect wallet
        </button>
        <ConnectWalletModal open={modalOpen} onClose={() => setModalOpen(false)} />
      </>
    );
  }

  const nativeBalance =
    balance !== undefined
      ? `${formatAmount(formatUnits(balance.value, balance.decimals))} ${balance.symbol}`
      : null;

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm hover:border-accent"
      >
        {nativeBalance !== null && (
          <span className="hidden font-mono text-muted sm:inline">{nativeBalance}</span>
        )}
        <span className="font-mono font-semibold text-ink">{truncateAddress(address)}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 text-muted transition-transform", menuOpen && "rotate-180")} />
      </button>

      {menuOpen && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-2 w-56 overflow-hidden rounded-md border border-border bg-surface shadow-xl"
        >
          <MenuItem
            onClick={() => {
              void navigator.clipboard.writeText(address).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? <Check className="h-4 w-4 text-accent" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied" : "Copy address"}
          </MenuItem>
          <a
            role="menuitem"
            href={`${EXPLORER_URL}/address/${address}`}
            target="_blank"
            rel="noreferrer"
            className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-ink hover:bg-bg"
            onClick={() => setMenuOpen(false)}
          >
            <ExternalLink className="h-4 w-4" />
            View on explorer
          </a>
          <MenuItem
            onClick={() => {
              setMenuOpen(false);
              disconnect();
            }}
          >
            <LogOut className="h-4 w-4" />
            Disconnect
          </MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  onClick,
  children,
}: {
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-ink hover:bg-bg"
    >
      {children}
    </button>
  );
}
