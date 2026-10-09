import { useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Async, Badge, Field, YesNo } from "../components/ui";
import { shorten } from "../lib/format";
import { apiKey, compareFund, listApiFunds, type ApiFundEntry, type FundSync } from "../lib/observer";

export default function SyncPage() {
  const [key, setKey] = useState(apiKey.get());
  const [draft, setDraft] = useState("");
  // The chosen fund is kept in the address, so the page can be reloaded or shared
  const [params, setParams] = useSearchParams();
  const selected = params.get("fund") ?? "";

  const save = () => {
    apiKey.set(draft.trim());
    setKey(draft.trim());
    setDraft("");
  };
  const forget = () => {
    apiKey.set("");
    setKey("");
  };

  // Part 1 starts from the funds the API key is authorized to see
  const list = useQuery({
    queryKey: ["api-funds", key],
    queryFn: () => listApiFunds(key),
    enabled: key !== "",
    retry: false,
    refetchInterval: 60_000,
  });
  const funds = list.data ?? [];

  const results = useQueries({
    queries: funds.map(({ fundId }) => ({
      queryKey: ["sync", fundId, key],
      queryFn: () => compareFund(fundId, key),
      enabled: key !== "",
      // a refused key does not get better by trying again
      retry: false,
      refetchInterval: 60_000,
    })),
  });

  const selectedIndex = funds.findIndex((fund) => fund.fundId === selected);

  return (
    <>
      <h1>Sincronização</h1>
      <p className="subtitle">
        Compara a Observer API com os contratos e lista os relatórios que o workflow do Chainlink CRE ainda precisa enviar.
      </p>

      <section className="panel">
        <h2>Chave da Observer API</h2>
        {key === "" ? (
          <>
            <div className="row">
              <input
                type="password"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && draft.trim() !== "" && save()}
                placeholder="Cole a chave (X-Observer-Key)"
                aria-label="Chave da Observer API"
                autoComplete="off"
              />
              <button className="action" type="button" disabled={draft.trim() === ""} onClick={save}>
                Usar
              </button>
            </div>
            <p className="empty">
              A chave fica guardada só neste navegador e é enviada apenas para a Observer API. Sem ela, as outras páginas
              continuam funcionando.
            </p>
          </>
        ) : (
          <div className="row" style={{ marginBottom: 0 }}>
            <Badge tone="ok">chave guardada neste navegador</Badge>
            <button className="action" type="button" onClick={forget}>
              Esquecer a chave
            </button>
          </div>
        )}
      </section>

      {key !== "" && (
        <>
          <section className="panel">
            <h2>Fundos</h2>
            <p className="empty" style={{ paddingTop: 0 }}>
              Fundos que a chave pode ver na Observer API, os mesmos que o workflow registra. Escolha um para ver os
              detalhes.
            </p>
            {list.isPending && <p className="loading">Carregando…</p>}
            {list.isError && <p className="error">{list.error instanceof Error ? list.error.message : String(list.error)}</p>}
            {list.isSuccess && funds.length === 0 && <p className="empty">A Observer API não devolveu nenhum fundo.</p>}
            <div className="table-wrap" hidden={funds.length === 0}>
              <table>
                <thead>
                  <tr>
                    <th>Fundo</th>
                    <th>Onchain</th>
                    <th className="num">Ordens na API</th>
                    <th className="num">Ordens Onchain</th>
                    <th className="num">Tx Registradas</th>
                    <th>A registrar</th>
                  </tr>
                </thead>
                <tbody>
                  {funds.map((fund, i) => (
                    <FundRow
                      key={fund.fundId}
                      fund={fund}
                      query={results[i]}
                      selected={fund.fundId === selected}
                      onSelect={() => setParams({ fund: fund.fundId })}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {selectedIndex === -1 ? (
            <section className="panel">
              <h2>Detalhes do fundo</h2>
              <p className="empty">Nenhum fundo escolhido.</p>
            </section>
          ) : (
            <FundDetails fund={funds[selectedIndex]} query={results[selectedIndex]} />
          )}
        </>
      )}
    </>
  );
}

// ============================================================
// PART 1: one row per fund
// ============================================================

function FundRow({
  fund,
  query,
  selected,
  onSelect,
}: {
  fund: ApiFundEntry;
  query: UseQueryResult<FundSync>;
  selected: boolean;
  onSelect: () => void;
}) {
  const sync = query.data;
  const { fundId } = fund;

  return (
    <tr
      className={`selectable ${selected ? "selected" : ""}`}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect()}
      tabIndex={0}
      role="button"
      aria-pressed={selected}
    >
      <td>
        <div>{fund.name || shorten(fundId)}</div>
        <div className="mono network" style={{ whiteSpace: "nowrap" }}>
          {fundId}
        </div>
      </td>
      {query.isPending ? (
        <td colSpan={5} className="network">
          Carregando…
        </td>
      ) : query.isError || !sync ? (
        <td colSpan={5}>
          <Badge tone="bad">erro na leitura</Badge>
        </td>
      ) : (
        <>
          <td>
            <YesNo value={sync.registered} />
          </td>
          <td className="num">{sync.ordersInApi}</td>
          <td className="num">{sync.ordersRegistered}</td>
          <td className="num">
            {sync.txsRecorded} de {sync.txsExpected}
          </td>
          <td>
            <PendingBadge sync={sync} />
          </td>
        </>
      )}
    </tr>
  );
}

function PendingBadge({ sync }: { sync: FundSync }) {
  if (sync.problems.length > 0) return <Badge tone="bad">{`${sync.pending.length} · com problemas`}</Badge>;
  if (sync.blockers.length > 0) return <Badge tone="bad">{`${sync.pending.length} · falta cadastro`}</Badge>;
  return (
    <Badge tone={sync.pending.length === 0 ? "ok" : "warn"}>
      {sync.pending.length === 0 ? "nada a registrar" : String(sync.pending.length)}
    </Badge>
  );
}

// ============================================================
// PART 2: details of the chosen fund
// ============================================================

function FundDetails({ fund, query }: { fund: ApiFundEntry; query: UseQueryResult<FundSync> }) {
  const { fundId } = fund;
  return (
    <section className="panel">
      <h2>Detalhes do fundo</h2>
      <Async query={query}>
        {(sync) => (
          <>
            <dl className="fields" style={{ marginBottom: 16 }}>
              <Field label="Fundo">
                {sync.registered ? <Link to={`/funds/${fundId}`}>{sync.name || fundId}</Link> : sync.name || "—"}
              </Field>
              <Field label="fundId">
                <span className="mono">{fundId}</span>
              </Field>
              <Field label="Rede">
                <span className="mono">{fund.network || "—"}</span>
              </Field>
              <Field label="Onchain">
                <YesNo value={sync.registered} />
              </Field>
              <Field label="Ordens">
                {sync.ordersInApi} na API, {sync.ordersRegistered} onchain
              </Field>
              <Field label="Tx Registradas">
                {sync.txsRecorded} de {sync.txsExpected}
              </Field>
              <Field label="A registrar">
                <PendingBadge sync={sync} />
              </Field>
            </dl>

            {sync.blockers.length > 0 && (
              <div className="blockers">
                <strong>Falta cadastrar nos contratos antes de o workflow registrar:</strong>
                <ul>
                  {sync.blockers.map((b) => (
                    <li key={`${b.kind}-${b.network}-${b.token ?? ""}`}>
                      {b.kind === "network" ? (
                        <>
                          a rede <span className="mono">{b.network}</span>, no MultiChainTxRegistry
                        </>
                      ) : (
                        <>
                          o stablecoin {b.symbol ? `${b.symbol} ` : ""}
                          <span className="mono">{b.token}</span> na rede <span className="mono">{b.network}</span>, no
                          FundRegistry
                        </>
                      )}
                      . Segura {b.blocks}.
                    </li>
                  ))}
                </ul>
                Um admin cadastra redes com <span className="mono">scripts/register-chains.ts</span> e stablecoins com{" "}
                <span className="mono">scripts/register-stablecoins.ts</span>.
              </div>
            )}

            {sync.problems.map((problem) => (
              <p className="error" key={problem}>
                {problem}
              </p>
            ))}

            {sync.pending.length === 0 ? (
              <p className="empty">Nada a registrar: os contratos têm tudo o que a Observer API mostra deste fundo.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th className="num">#</th>
                      <th>Ação do receptor</th>
                      <th>Sobre</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sync.pending.map((report, n) => (
                      <tr key={`${report.name} ${report.ref}`}>
                        <td className="num">{n + 1}</td>
                        <td className="mono">{report.name}</td>
                        <td className="mono">{report.ref}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Async>
    </section>
  );
}
