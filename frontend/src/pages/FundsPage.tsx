import { Link } from "react-router-dom";
import { Async, ChainTag, ContractAddress, NetworkTx } from "../components/ui";
import { dateTime } from "../lib/format";
import { useChains, useFunds } from "../lib/queries";

export default function FundsPage() {
  const funds = useFunds();
  const chains = useChains().data;

  return (
    <>
      <h1>Fundos</h1>
      <p className="subtitle">Fundos registrados no FundRegistry.</p>

      <section className="panel">
        <Async query={funds}>
          {(list) =>
            list.length === 0 ? (
              <p className="empty">Nenhum fundo registrado ainda.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Fundo</th>
                      <th>FIDC</th>
                      <th>Rede</th>
                      <th>Contrato do fundo</th>
                      <th>Stablecoin</th>
                      <th>Transação de criação</th>
                      <th>Criado em</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((fund) => (
                      <tr key={fund.fundKey}>
                        <td>
                          <Link to={`/funds/${fund.fundId}`}>{fund.name || fund.fundId}</Link>
                        </td>
                        <td>{fund.fidcId.toString()}</td>
                        <td>
                          <ChainTag chains={chains} chainId={fund.chain.chainId} />
                        </td>
                        <td>
                          <ContractAddress value={fund.contractAddress} />
                        </td>
                        <td>{fund.stable.symbol}</td>
                        <td>
                          <NetworkTx network={fund.chain.network} txHash={fund.creationTxHash} />
                        </td>
                        <td>{dateTime(fund.createdAt)}</td>
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
