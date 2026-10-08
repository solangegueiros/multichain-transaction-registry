// Small building blocks shared by the pages.
import type { UseQueryResult } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { CONTRACTS_EXPLORER } from "../config";
import { txUrl } from "../lib/explorers";
import { shorten } from "../lib/format";
import { PROGRESS, TX_STATUS, type Chain } from "../lib/registry";

/// Renders the loading and error states of a query, and its data when it arrives.
export function Async<T>({ query, children }: { query: UseQueryResult<T>; children: (data: T) => ReactNode }) {
  if (query.isPending) return <p className="loading">Carregando…</p>;
  if (query.isError) {
    return <p className="error">{query.error instanceof Error ? query.error.message : String(query.error)}</p>;
  }
  return <>{children(query.data)}</>;
}

/// A hash or an address, shortened, with a copy button and an optional link.
export function Hash({ value, href, full = false }: { value: string; href?: string | null; full?: boolean }) {
  const [copied, setCopied] = useState(false);
  if (value === "") return <span className="mono">—</span>;

  const copy = () => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };
  const text = full ? value : shorten(value);

  return (
    <span className="hash mono" title={value}>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer">
          {text}
        </a>
      ) : (
        text
      )}
      <button type="button" onClick={copy} aria-label="Copiar">
        {copied ? "✓" : "⧉"}
      </button>
    </span>
  );
}

/// Address on the chain of the contracts, linked to its explorer.
export function ContractAddress({ value, full = false }: { value: string; full?: boolean }) {
  return <Hash value={value} full={full} href={`${CONTRACTS_EXPLORER}/address/${value}`} />;
}

/// Hash of a transaction on one of the tracked networks, linked to the explorer of that network.
export function NetworkTx({ network, txHash }: { network: string; txHash: string }) {
  return <Hash value={txHash} href={txUrl(network, txHash)} />;
}

export function Badge({ tone, children }: { tone?: "ok" | "warn" | "bad"; children: ReactNode }) {
  return <span className={`badge ${tone ?? ""}`}>{children}</span>;
}

export function ProgressBadge({ progress }: { progress: number }) {
  const tone = progress === 2 ? "ok" : progress === 1 ? "warn" : undefined;
  return <Badge tone={tone}>{PROGRESS[progress] ?? `#${progress}`}</Badge>;
}

export function TxStatusBadge({ status }: { status: number }) {
  const tone = status === 1 ? "ok" : status === 2 ? "bad" : "warn";
  return <Badge tone={tone}>{TX_STATUS[status] ?? `#${status}`}</Badge>;
}

export function YesNo({ value, yes = "sim", no = "não" }: { value: boolean; yes?: string; no?: string }) {
  return <Badge tone={value ? "ok" : "bad"}>{value ? yes : no}</Badge>;
}

/// Network of a chainId of the registry: "eip155:51". "" when the chain is unknown.
export const networkOf = (chains: Chain[] | undefined, chainId: string): string =>
  chains?.find((c) => c.chainId === chainId)?.network ?? "";

export function ChainTag({ chains, chainId }: { chains: Chain[] | undefined; chainId: string }) {
  const chain = chains?.find((c) => c.chainId === chainId);
  return chain ? <Badge>{`${chain.name} · ${chain.network}`}</Badge> : <span className="mono">{shorten(chainId)}</span>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}
