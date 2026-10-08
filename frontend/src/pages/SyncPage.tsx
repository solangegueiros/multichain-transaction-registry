import { useQueries } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Async, Badge, YesNo } from "../components/ui";
import { OBSERVER } from "../config";
import { apiKey, compareFund } from "../lib/observer";

export default function SyncPage() {
  const [key, setKey] = useState(apiKey.get());
  const [draft, setDraft] = useState("");

  const save = () => {
    apiKey.set(draft.trim());
    setKey(draft.trim());
    setDraft("");
  };
  const forget = () => {
    apiKey.set("");
    setKey("");
  };

  const results = useQueries({
    queries: OBSERVER.fundIds.map((fundId) => ({
      queryKey: ["sync", fundId, key],
      queryFn: () => compareFund(fundId, key),
      enabled: key !== "",
      // a refused key does not get better by trying again
      retry: false,
      refetchInterval: 60_000,
    })),
  });

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

      {key !== "" &&
        OBSERVER.fundIds.map((fundId, i) => (
          <section className="panel" key={fundId}>
            <Async query={results[i]}>
              {(sync) => (
                <>
                  <h2>
                    {sync.registered ? <Link to={`/funds/${fundId}`}>{sync.name || fundId}</Link> : sync.name || fundId}
                  </h2>
                  <dl className="fields" style={{ marginBottom: 12 }}>
                    <dt>fundId</dt>
                    <dd className="mono">{fundId}</dd>
                    <dt>Na Observer API</dt>
                    <dd>
                      <YesNo value={sync.inApi} />
                    </dd>
                    <dt>Registrado onchain</dt>
                    <dd>
                      <YesNo value={sync.registered} />
                    </dd>
                    <dt>Ordens</dt>
                    <dd>
                      {sync.ordersInApi} na API, {sync.ordersRegistered} registradas, {sync.ordersInSync} em dia
                    </dd>
                    <dt>Relatórios pendentes</dt>
                    <dd>
                      <Badge tone={sync.pending.length === 0 ? "ok" : "warn"}>
                        {sync.pending.length === 0 ? "nenhum, em dia" : String(sync.pending.length)}
                      </Badge>
                    </dd>
                  </dl>

                  {sync.problems.map((problem) => (
                    <p className="error" key={problem}>
                      {problem}
                    </p>
                  ))}

                  {sync.pending.length > 0 && (
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
        ))}
    </>
  );
}
