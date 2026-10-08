import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Async, Badge, ChainTag, Field, Hash, NetworkTx, ProgressBadge, TxStatusBadge, networkOf } from "../components/ui";
import { amount, dateTime } from "../lib/format";
import { useChains, useFunds } from "../lib/queries";
import { getOrderDetail, type Chain, type OrderTxEntry } from "../lib/registry";

export default function OrderPage() {
  const { orderId = "" } = useParams();
  const chains = useChains();
  const funds = useFunds().data;
  const detail = useQuery({
    queryKey: ["order", orderId],
    queryFn: () => getOrderDetail(orderId, chains.data ?? []),
    // the extra args are decoded with the schema of each chain
    enabled: chains.isSuccess,
  });

  return (
    <>
      <div className="crumbs">
        <Link to="/funds">Fundos</Link> / ordem
      </div>
      <h1 className="mono">{orderId}</h1>

      <Async query={detail}>
        {(d) => {
          if (d === null) return <p className="note">Esta ordem não está registrada no OrderRegistry.</p>;
          const fund = funds?.find((f) => f.fundKey === d.order.fundKey);
          return (
            <>
              <p className="subtitle">
                <ProgressBadge progress={d.order.progress} /> versão {d.order.version}
                {fund && (
                  <>
                    {" · fundo "}
                    <Link to={`/funds/${fund.fundId}`}>{fund.name || fund.fundId}</Link>
                  </>
                )}
              </p>

              <section className="panel">
                <h2>Ordem</h2>
                <dl className="fields">
                  <Field label="intentHash">
                    <Hash value={d.order.intentHash} full />
                  </Field>
                  <Field label="Criada em">{dateTime(d.order.createdAt)}</Field>
                  <Field label="Atualizada em">{dateTime(d.order.updatedAt)}</Field>
                </dl>
              </section>

              <section className="panel">
                <h2>Intent</h2>
                <dl className="fields">
                  <Field label="Rede de origem">
                    <ChainTag chains={chains.data} chainId={d.intent.sourceChainId} />
                  </Field>
                  <Field label="Conta de origem">
                    <Hash value={d.intent.sourceAccount} full />
                  </Field>
                  <Field label="Token de pagamento">
                    <Hash value={d.intent.cashToken} full />
                  </Field>
                  <Field label="Rede de destino">
                    <ChainTag chains={chains.data} chainId={d.intent.destinationChainId} />
                  </Field>
                  <Field label="Beneficiário">
                    <Hash value={d.intent.beneficiary} full />
                  </Field>
                  <Field label="Válido até">{dateTime(d.intent.validUntil)}</Field>
                </dl>
              </section>

              <section className="panel">
                <h2>Transações</h2>
                {d.txs.length === 0 ? (
                  <p className="empty">Nenhuma transação registrada para esta ordem.</p>
                ) : (
                  <ol className="timeline">
                    {d.txs.map((entry) => (
                      <TxItem key={entry.index} entry={entry} chains={chains.data} />
                    ))}
                  </ol>
                )}
              </section>
            </>
          );
        }}
      </Async>
    </>
  );
}

function TxItem({ entry, chains }: { entry: OrderTxEntry; chains: Chain[] | undefined }) {
  const { tx } = entry;
  const network = networkOf(chains, tx.chainId);

  return (
    <li>
      <div className="head">
        <span className="role">{entry.role}</span>
        <ChainTag chains={chains} chainId={tx.chainId} />
        <TxStatusBadge status={tx.status} />
        {entry.disposition !== "" && <Badge>{entry.disposition}</Badge>}
        <span className="network">transação #{tx.id.toString()}</span>
      </div>
      <dl className="fields">
        <Field label="Hash">
          <NetworkTx network={network} txHash={tx.txHash} />
        </Field>
        <Field label="De">
          <Hash value={tx.from} />
        </Field>
        <Field label="Para">
          <Hash value={tx.to} />
        </Field>
        <Field label="Valor">
          {amount(tx.amount)} {tx.assetCode}
          {tx.assetIssuer !== "" && (
            <>
              {" · emissor "}
              <Hash value={tx.assetIssuer} />
            </>
          )}
        </Field>
        <Field label="Tipo">{tx.txType || "—"}</Field>
        <Field label="Bloco ou ledger">{tx.blockNumber === 0n ? "—" : tx.blockNumber.toString()}</Field>
        <Field label="Conector">{[entry.connectorId, entry.standard].filter(Boolean).join(" · ") || "—"}</Field>
        {entry.extraArgs.map((arg) => (
          <Field key={arg.key} label={arg.key}>
            <Hash value={arg.value} />
          </Field>
        ))}
        <Field label="Registrada em">{dateTime(tx.registeredAt)}</Field>
      </dl>
    </li>
  );
}
