import { useQuery } from "@tanstack/react-query";
import { Async, Badge, ChainTag, ContractAddress, Field, Hash, YesNo } from "../components/ui";
import { CONTRACTS, FORWARDERS } from "../config";
import { useChains } from "../lib/queries";
import {
  ZERO_BYTES32,
  getOrderTxLabels,
  getReceiverState,
  getRoleChecks,
  getStableCoins,
  shortText,
} from "../lib/registry";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export default function SetupPage() {
  const chains = useChains();
  const stableCoins = useQuery({ queryKey: ["stablecoins"], queryFn: getStableCoins });
  const labels = useQuery({ queryKey: ["order-tx-labels"], queryFn: getOrderTxLabels });
  const receiver = useQuery({ queryKey: ["receiver"], queryFn: getReceiverState });
  const roles = useQuery({ queryKey: ["role-checks"], queryFn: getRoleChecks });

  return (
    <>
      <h1>Estrutura</h1>
      <p className="subtitle">O que precisa estar pronto nos contratos para a carga funcionar.</p>

      <section className="panel">
        <h2>Redes e chaves de schema</h2>
        <Async query={chains}>
          {(list) =>
            list.length === 0 ? (
              <p className="empty">Nenhuma rede registrada.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Rede</th>
                      <th>Identificador</th>
                      <th>Perfil</th>
                      <th>Argumentos extras aceitos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((chain) => (
                      <tr key={chain.chainId}>
                        <td>{chain.name}</td>
                        <td className="mono">{chain.network}</td>
                        <td>{chain.profileId || "—"}</td>
                        <td>
                          {chain.schema.length === 0
                            ? "—"
                            : chain.schema.map((key) => (
                                <span key={key.key} title={key.description} style={{ marginRight: 6 }}>
                                  <Badge tone={key.active ? undefined : "bad"}>
                                    {`${key.key}: ${key.valueType}${key.required ? " *" : ""}`}
                                  </Badge>
                                </span>
                              ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </Async>
      </section>

      <section className="panel">
        <h2>Stablecoins</h2>
        <Async query={stableCoins}>
          {(list) =>
            list.length === 0 ? (
              <p className="empty">Nenhum stablecoin registrado. Sem eles, nenhum fundo pode ser registrado.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Símbolo</th>
                      <th>Rede</th>
                      <th>Token</th>
                      <th className="num">Casas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((coin) => (
                      <tr key={coin.stableKey}>
                        <td>{coin.symbol}</td>
                        <td>
                          <ChainTag chains={chains.data} chainId={coin.chainId} />
                        </td>
                        <td>
                          <Hash value={coin.tokenAddress} full />
                        </td>
                        <td className="num">{coin.decimals}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </Async>
      </section>

      <section className="panel">
        <h2>Papéis e dispositions das transações de ordem</h2>
        <Async query={labels}>
          {({ roles: txRoles, dispositions }) => (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Tipo</th>
                    <th>Nome</th>
                    <th>Descrição</th>
                    <th>Rede da transação</th>
                    <th>Ativo</th>
                  </tr>
                </thead>
                <tbody>
                  {txRoles.map((role) => (
                    <tr key={`role-${role.role}`}>
                      <td>Papel</td>
                      <td className="mono">{shortText(role.role)}</td>
                      <td>{role.description}</td>
                      <td>{role.onDestinationChain ? "destino da ordem" : "origem da ordem"}</td>
                      <td>
                        <YesNo value={role.active} />
                      </td>
                    </tr>
                  ))}
                  {dispositions.map((d) => (
                    <tr key={`disposition-${d.disposition}`}>
                      <td>Disposition</td>
                      <td className="mono">{shortText(d.disposition)}</td>
                      <td>{d.description}</td>
                      <td>—</td>
                      <td>
                        <YesNo value={d.active} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Async>
      </section>

      <section className="panel">
        <h2>Permissões entre os contratos</h2>
        <Async query={roles}>
          {(checks) => (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Quem precisa</th>
                    <th>Papel</th>
                    <th>Em qual contrato</th>
                    <th>Concedido</th>
                  </tr>
                </thead>
                <tbody>
                  {checks.map((check) => (
                    <tr key={`${check.account}-${check.contract}`}>
                      <td>{check.account}</td>
                      <td className="mono">{check.role}</td>
                      <td>{check.contract}</td>
                      <td>
                        <YesNo value={check.granted} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Async>
      </section>

      <section className="panel">
        <h2>Receptor do Chainlink CRE</h2>
        <Async query={receiver}>
          {(state) => {
            if (state === null) return <p className="empty">O MultiChainTxReceiver ainda não foi publicado.</p>;

            const forwarderKind = FORWARDERS[state.forwarder.toLowerCase()];
            const restricted =
              state.workflowId !== ZERO_BYTES32 || state.author.toLowerCase() !== ZERO_ADDRESS;
            const same = (a: string, b: string | null) => b !== null && a.toLowerCase() === b.toLowerCase();

            return (
              <dl className="fields">
                <Field label="Forwarder">
                  <ContractAddress value={state.forwarder} full />{" "}
                  <Badge tone={forwarderKind ? undefined : "warn"}>{forwarderKind ?? "endereço não reconhecido"}</Badge>
                </Field>
                <Field label="Restrito a um workflow">
                  <Badge tone={restricted ? "ok" : "warn"}>
                    {restricted ? "sim" : "não: qualquer workflow entrega relatórios"}
                  </Badge>
                </Field>
                <Field label="Workflow esperado">
                  {state.workflowId === ZERO_BYTES32 ? "—" : <Hash value={state.workflowId} />}
                </Field>
                <Field label="Autor esperado">
                  {state.author.toLowerCase() === ZERO_ADDRESS ? "—" : <ContractAddress value={state.author} />}
                </Field>
                <Field label="Tolerância de horário">{state.maxFutureSkew.toString()} segundos</Field>
                <Field label="FundRegistry ligado">
                  <ContractAddress value={state.fundRegistry} />{" "}
                  <YesNo value={same(state.fundRegistry, CONTRACTS.fundRegistry)} yes="o do projeto" no="diferente do projeto" />
                </Field>
                <Field label="OrderRegistry ligado">
                  <ContractAddress value={state.orderRegistry} />{" "}
                  <YesNo value={same(state.orderRegistry, CONTRACTS.orderRegistry)} yes="o do projeto" no="diferente do projeto" />
                </Field>
              </dl>
            );
          }}
        </Async>
      </section>
    </>
  );
}
