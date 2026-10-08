import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Async, ChainTag, Hash, NetworkTx, TxStatusBadge, networkOf } from "../components/ui";
import { amount, dateTime } from "../lib/format";
import { useChains } from "../lib/queries";
import { findTxByHash, getTxCount, getTxs, type Chain, type RegisteredTx } from "../lib/registry";

const PAGE_SIZE = 25n;

export default function TransactionsPage() {
  const chains = useChains().data;
  const count = useQuery({ queryKey: ["tx-count"], queryFn: getTxCount });
  const [page, setPage] = useState(0n);
  const [chainFilter, setChainFilter] = useState("");
  const [text, setText] = useState("");

  const total = count.data ?? 0n;
  const fromId = total - page * PAGE_SIZE;
  const toId = fromId - PAGE_SIZE + 1n > 1n ? fromId - PAGE_SIZE + 1n : 1n;

  const list = useQuery({
    queryKey: ["txs", fromId.toString(), toId.toString()],
    queryFn: () => getTxs(fromId, toId),
    enabled: count.isSuccess && total > 0n,
  });

  // A full hash typed in the filter is looked up in the index of the contract, on every chain
  const wantedHash = text.trim();
  const isHash = /^(0x)?[0-9a-fA-F]{64}$/.test(wantedHash);
  const lookup = useQuery({
    queryKey: ["tx-by-hash", wantedHash],
    queryFn: async () => {
      const found = await Promise.all((chains ?? []).map((c) => findTxByHash(c.chainId, wantedHash)));
      return found.filter((tx): tx is RegisteredTx => tx !== null);
    },
    enabled: isHash && chains !== undefined,
  });

  const needle = wantedHash.toLowerCase();
  const matches = (tx: RegisteredTx): boolean =>
    (chainFilter === "" || tx.chainId === chainFilter) &&
    (needle === "" || [tx.txHash, tx.from, tx.to, tx.assetCode].some((field) => field.toLowerCase().includes(needle)));

  return (
    <>
      <h1>Transações</h1>
      <p className="subtitle">Transações registradas no MultiChainTxRegistry, das mais recentes para as mais antigas.</p>

      <section className="panel">
        <div className="row">
          <select value={chainFilter} onChange={(e) => setChainFilter(e.target.value)} aria-label="Rede">
            <option value="">Todas as redes</option>
            {chains?.map((c) => (
              <option key={c.chainId} value={c.chainId}>
                {c.name} · {c.network}
              </option>
            ))}
          </select>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Filtrar por hash, endereço ou ativo. Um hash completo é buscado em todo o contrato"
            aria-label="Filtro"
          />
        </div>

        {isHash ? (
          <Async query={lookup}>
            {(found) =>
              found.length === 0 ? (
                <p className="empty">Nenhuma transação registrada com este hash.</p>
              ) : (
                <TxTable txs={found} chains={chains} />
              )
            }
          </Async>
        ) : (
          <Async query={count}>
            {(n) =>
              n === 0n ? (
                <p className="empty">Nenhuma transação registrada ainda.</p>
              ) : (
                <>
                  <Async query={list}>
                    {(txs) => {
                      const shown = txs.filter(matches);
                      return shown.length === 0 ? (
                        <p className="empty">Nenhuma transação desta página passa no filtro.</p>
                      ) : (
                        <TxTable txs={shown} chains={chains} />
                      );
                    }}
                  </Async>
                  <div className="row" style={{ marginTop: 12, marginBottom: 0 }}>
                    <button className="action" type="button" disabled={page === 0n} onClick={() => setPage(page - 1n)}>
                      Mais recentes
                    </button>
                    <button className="action" type="button" disabled={toId <= 1n} onClick={() => setPage(page + 1n)}>
                      Mais antigas
                    </button>
                    <span className="network">
                      transações #{fromId.toString()} a #{toId.toString()} de {n.toString()}. O filtro vale para a página
                      exibida.
                    </span>
                  </div>
                </>
              )
            }
          </Async>
        )}
      </section>
    </>
  );
}

function TxTable({ txs, chains }: { txs: RegisteredTx[]; chains: Chain[] | undefined }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th className="num">#</th>
            <th>Rede</th>
            <th>Hash</th>
            <th>De</th>
            <th>Para</th>
            <th className="num">Valor</th>
            <th>Tipo</th>
            <th>Status</th>
            <th>Registrada em</th>
          </tr>
        </thead>
        <tbody>
          {txs.map((tx) => (
            <tr key={tx.id.toString()}>
              <td className="num">{tx.id.toString()}</td>
              <td>
                <ChainTag chains={chains} chainId={tx.chainId} />
              </td>
              <td>
                <NetworkTx network={networkOf(chains, tx.chainId)} txHash={tx.txHash} />
              </td>
              <td>
                <Hash value={tx.from} />
              </td>
              <td>
                <Hash value={tx.to} />
              </td>
              <td className="num">
                {amount(tx.amount)} {tx.assetCode}
              </td>
              <td>{tx.txType || "—"}</td>
              <td>
                <TxStatusBadge status={tx.status} />
              </td>
              <td>{dateTime(tx.registeredAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
