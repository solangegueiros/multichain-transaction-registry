import type { ReactNode } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { CUSTOM_RPC, ENVIRONMENT, switchEnvironment, type Environment } from "./config";
import FundPage from "./pages/FundPage";
import FundsPage from "./pages/FundsPage";
import OrderPage from "./pages/OrderPage";
import OverviewPage from "./pages/OverviewPage";
import SetupPage from "./pages/SetupPage";
import SyncPage from "./pages/SyncPage";
import TransactionsPage from "./pages/TransactionsPage";

// Line icons of the navigation, 24x24, drawn with the current text color
const icon = (paths: ReactNode) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {paths}
  </svg>
);

const ICONS = {
  overview: icon(
    <>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </>,
  ),
  funds: icon(
    <>
      <path d="M3 21h18" />
      <path d="M5 21V10M9.5 21V10M14.5 21V10M19 21V10" />
      <path d="M12 3 3 8h18z" />
    </>,
  ),
  transactions: icon(
    <>
      <path d="M4 8h14l-3-3" />
      <path d="M20 16H6l3 3" />
    </>,
  ),
  sync: icon(
    <>
      <path d="M20 12a8 8 0 0 0-14-5.3L4 9" />
      <path d="M4 4v5h5" />
      <path d="M4 12a8 8 0 0 0 14 5.3l2-2.3" />
      <path d="M20 20v-5h-5" />
    </>,
  ),
  setup: icon(
    <>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="12" cy="18" r="2.5" />
      <path d="M8.5 6h7M7.2 8.2l3.6 7.6M16.8 8.2l-3.6 7.6" />
    </>,
  ),
};

const GROUPS: { title: string; links: { to: string; label: string; icon: ReactNode; end?: boolean }[] }[] = [
  { title: "Registro", links: [{ to: "/", label: "Visão geral", icon: ICONS.overview, end: true }] },
  {
    title: "Atestação",
    links: [
      { to: "/funds", label: "Fundos e ordens", icon: ICONS.funds },
      { to: "/transactions", label: "Transações", icon: ICONS.transactions },
    ],
  },
  {
    title: "Operação",
    links: [
      { to: "/sync", label: "Sincronização", icon: ICONS.sync },
      { to: "/setup", label: "Estrutura", icon: ICONS.setup },
    ],
  },
];

export default function App() {
  return (
    <div className="app">
      <nav className="sidebar" aria-label="Seções do painel">
        <div className="brand">
          <NavLink to="/" aria-label="Visão geral">
            <img src="/brand/abtoken.png" alt="ABToken" width="418" height="278" />
          </NavLink>
          <span>atestação multichain do piloto GTT</span>
          {/* the footer of the menu is hidden on narrow screens: the toggle comes up here */}
          <EnvironmentToggle className="env-toggle-top" />
        </div>

        <div className="nav-groups">
          {GROUPS.map((group) => (
            <div className="nav-group" key={group.title}>
              <div className="nav-title">{group.title}</div>
              {group.links.map((link) => (
                <NavLink key={link.to} to={link.to} end={link.end} className={({ isActive }) => (isActive ? "active" : "")}>
                  {link.icon}
                  {link.label}
                </NavLink>
              ))}
            </div>
          ))}
        </div>

        <div className="sidebar-foot">
          <img src="/brand/abtoken-white.png" alt="" width="418" height="278" />
          <div className="foot-title">MultiChainTxRegistry</div>
          <div className="foot-sub">somente leitura</div>
          <span className="foot-chip">{CUSTOM_RPC ? "rede personalizada" : "Ethereum Sepolia"}</span>
          <EnvironmentToggle />
          <a className="foot-github" href={REPOSITORY_URL} target="_blank" rel="noreferrer" aria-label="Código do projeto no GitHub">
            <svg viewBox="0 0 16 16" width="20" height="20" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            GitHub
          </a>
        </div>
      </nav>

      <main>
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/funds" element={<FundsPage />} />
          <Route path="/funds/:fundId" element={<FundPage />} />
          <Route path="/orders/:orderId" element={<OrderPage />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/sync" element={<SyncPage />} />
          <Route path="/setup" element={<SetupPage />} />
          <Route path="*" element={<p className="empty">Página não encontrada.</p>} />
        </Routes>
      </main>
    </div>
  );
}

const REPOSITORY_URL = "https://github.com/solangegueiros/multichain-transaction-registry";

const ENVIRONMENT_LABELS: [Environment, string][] = [
  ["staging", "staging"],
  ["production", "produção"],
];

/// Chooses the environment the panel reads. Switching reloads the page.
function EnvironmentToggle({ className = "" }: { className?: string }) {
  return (
    <div className={`env-toggle ${className}`} role="group" aria-label="Ambiente">
      {ENVIRONMENT_LABELS.map(([environment, label]) => (
        <button
          key={environment}
          type="button"
          aria-pressed={environment === ENVIRONMENT}
          onClick={() => environment !== ENVIRONMENT && switchEnvironment(environment)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
