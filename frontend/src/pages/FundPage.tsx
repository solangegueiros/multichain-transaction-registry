import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Async, Badge, ChainTag, Field, Hash, NetworkTx, ProgressBadge } from "../components/ui";
import { dateTime } from "../lib/format";
import { useChains } from "../lib/queries";
import { getFund, getOrdersOfFund } from "../lib/registry";

export default function FundPage() {
  const { fundId = "" } = useParams();
  const chains = useChains().data;
  const fund = useQuery({ queryKey: ["fund", fundId], queryFn: () => getFund(fundId) });
  const orders = useQuery({ queryKey: ["fund-orders", fundId], queryFn: () => getOrdersOfFund(fundId) });

  return (
    <>
      <div className="crumbs">
        <Link to="/funds">Fundos</Link> / {fundId}
      </div>

      <Async query={fund}>
        {(f) =>
          f === null ? (
            <p className="note">Este fundo não está registrado no FundRegistry.</p>
          ) : (
            <>
              <h1>{f.name || f.fundId}</h1>
              <p className="subtitle">FIDC {f.fidcId.toString()}</p>

              <section className="panel">
                <h2>Dados do fundo</h2>
                <dl className="fields">
                  <Field label="fundId">
                    <Hash value={f.fundId} full />
                  </Field>
                  <Field label="Rede">
                    <ChainTag chains={chains} chainId={f.chain.chainId} />
                  </Field>
                  <Field label="Contrato do fundo">
                    <Hash value={f.contractAddress} full />
                  </Field>
                  <Field label="Stablecoin">
                    {f.stable.symbol} · <Hash value={f.stable.tokenAddress} /> · {f.stable.decimals} casas
                  </Field>
                  <Field label="Intent de criação">
                    <Hash value={f.creationIntentHash} />
                  </Field>
                  <Field label="Transação de criação">
                    <NetworkTx network={f.chain.network} txHash={f.creationTxHash} />{" "}
                    {f.creationTxId === 0n ? (
                      <Badge tone="warn">não registrada</Badge>
                    ) : (
                      <Badge tone="ok">{`transação #${f.creationTxId}`}</Badge>
                    )}
                  </Field>
                  <Field label="Criado em">{dateTime(f.createdAt)}</Field>
                </dl>
              </section>
            </>
          )
        }
      </Async>

      <section className="panel">
        <h2>Ordens</h2>
        <Async query={orders}>
          {(list) =>
            list.length === 0 ? (
              <p className="empty">Nenhuma ordem registrada para este fundo.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Ordem</th>
                      <th>Progresso</th>
                      <th className="num">Versão</th>
                      <th>Transações</th>
                      <th>Criada em</th>
                      <th>Atualizada em</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((order) => (
                      <tr key={order.orderId}>
                        <td className="mono">
                          <Link to={`/orders/${order.orderId}`}>{order.orderId}</Link>
                        </td>
                        <td>
                          <ProgressBadge progress={order.progress} />
                        </td>
                        <td className="num">{order.version}</td>
                        <td>{order.roles.length === 0 ? "—" : order.roles.join(", ")}</td>
                        <td>{dateTime(order.createdAt)}</td>
                        <td>{dateTime(order.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </Async>
      </section>
    </>
  );
}
