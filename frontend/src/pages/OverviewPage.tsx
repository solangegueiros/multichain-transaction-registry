import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Async, Badge, ContractAddress } from "../components/ui";
import { CONTRACTS, CONTRACT_NAMES } from "../config";
import { getCounts } from "../lib/registry";

export default function OverviewPage() {
  const counts = useQuery({ queryKey: ["counts"], queryFn: getCounts });
  const keys = Object.keys(CONTRACTS) as (keyof typeof CONTRACTS)[];

  return (
    <>
      <h1>Visão geral</h1>
      <p className="subtitle">O que está registrado nos contratos, lido direto da rede.</p>

      <Async query={counts}>
        {(c) => (
          <div className="cards">
            <Card value={c.funds} label="Fundos" to="/funds" />
            <Card value={c.orders} label="Ordens" to="/funds" />
            <Card value={c.txs} label="Transações" to="/transactions" />
            <Card value={c.chains} label="Redes" to="/setup" />
            <Card value={c.stableCoins} label="Stablecoins" to="/setup" />
          </div>
        )}
      </Async>

      <section className="panel">
        <h2>Contratos</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Contrato</th>
                <th>Endereço</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key}>
                  <td>{CONTRACT_NAMES[key]}</td>
                  <td>{CONTRACTS[key] ? <ContractAddress value={CONTRACTS[key]} full /> : <Badge tone="warn">não publicado</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function Card({ value, label, to }: { value: number; label: string; to: string }) {
  return (
    <Link to={to} className="card">
      <div className="value">{value}</div>
      <div className="label">{label}</div>
    </Link>
  );
}
