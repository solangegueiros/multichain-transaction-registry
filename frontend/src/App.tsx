import type { ReactNode } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { CUSTOM_RPC } from "./config";
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
    title: "O que está gravado",
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
          <span>registro multichain do piloto GTT</span>
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
