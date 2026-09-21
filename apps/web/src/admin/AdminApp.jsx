import "../styles/admin.css";
/**
 * Backoffice — /admin/*
 * Layout próprio (sidebar) — o Header/Footer da loja não aparecem aqui (ver App.jsx).
 * Guard: precisa estar logado com role=admin. A api confere de novo em cada chamada.
 */
import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import Dashboard from "./Dashboard.jsx";
import Orders from "./Orders.jsx";
import OrderDetail from "./OrderDetail.jsx";
import ManualOrder from "./ManualOrder.jsx";
import Deliveries from "./Deliveries.jsx";
import Customers from "./Customers.jsx";
import CustomerDetail from "./CustomerDetail.jsx";
import Stock from "./Stock.jsx";
import StockForm from "./StockForm.jsx";
import Imported from "./Imported.jsx";
import Featured from "./Featured.jsx";
import Marketing from "./Marketing.jsx";
import Pricing from "./Pricing.jsx";
import Coupons from "./Coupons.jsx";
import Restricted from "./Restricted.jsx";
import Bling from "./Bling.jsx";

const NAV_ITEMS = [
  { to: "/admin", label: "Dashboard", hint: "Visão financeira e operacional" },
  { to: "/admin/pedidos", label: "Pedidos", hint: "Fluxo, pagamento e venda externa", badge: "pending" },
  { to: "/admin/entregas", label: "Entregas", hint: "Fila de envio e etapas do importado", badge: "toShip" },
  { to: "/admin/clientes", label: "Clientes", hint: "Base, histórico e detalhes" },
  { to: "/admin/estoque", label: "Pronta entrega", hint: "Catálogo e disponibilidade" },
  { to: "/admin/hypados", label: "Hypados", hint: "Curadoria e estoque especial" },
  { to: "/admin/importados", label: "Importados", hint: "Catálogo Nike e seleção do Top 8" },
  { to: "/admin/vitrine", label: "Vitrine", hint: "Hero e slots por categoria" },
  { to: "/admin/restritos", label: "Restritos", hint: "Produtos privados e acesso" },
  { to: "/admin/marketing", label: "Marketing", hint: "Conteúdo e publicação" },
  { to: "/admin/precos", label: "Preços", hint: "Regras e fórmulas comerciais" },
  { to: "/admin/cupons", label: "Cupons", hint: "Descontos e validade" },
  { to: "/admin/bling", label: "Bling", hint: "Integração e conferência" }
];

export default function AdminApp({ auth, onOpenLogin, notify }) {
  const navigate = useNavigate();
  const [counts, setCounts] = useState(null);

  // contadores da sidebar (pendentes de envio etc.) — leve, uma vez por montagem
  useEffect(() => {
    if (!auth.isAdmin) return;
    auth.request("/api/admin/dashboard?days=30").then((d) => setCounts(d.byStatus)).catch(() => {});
  }, [auth.isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  if (auth.loading) {
    return (
      <div className="adm-gate"><div className="box"><h2>Backoffice</h2><p>Verificando sessão…</p></div></div>
    );
  }
  if (!auth.user) {
    return (
      <div className="adm-gate">
        <div className="box">
          <h2>Área restrita</h2>
          <p>Entre com uma conta de administrador para acessar o painel da Kulture.</p>
          <button className="btn-full" onClick={onOpenLogin}>Entrar</button>
          <a className="back-link" href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }}>← Voltar para a loja</a>
        </div>
      </div>
    );
  }
  if (!auth.isAdmin) {
    return (
      <div className="adm-gate">
        <div className="box">
          <h2>Sem permissão</h2>
          <p>
            A conta <b>{auth.user.email}</b> não é administradora. Peça ao dono para promover o e-mail
            (variável <code>ADMIN_EMAILS</code> ou <code>npm run admin:make -w apps/api -- seu@email</code>) e entre de novo.
          </p>
          <a className="back-link" href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }}>← Voltar para a loja</a>
        </div>
      </div>
    );
  }

  const toShip = counts ? (counts.paid || 0) + (counts.sourcing || 0) + (counts.in_transit || 0) + (counts.arrived_br || 0) : null;
  const pending = counts ? counts.pending_payment || 0 : null;
  const navBadges = { pending, toShip };

  return (
    <div className="adm-shell">
      <div className="adm-noise" aria-hidden="true" />
      <div className="adm">
        <aside className="adm-side">
          <div className="adm-side-scroll">
            <div className="adm-brand">
              <img src="/logo.png" alt="Kulture" />
              <div className="adm-brand-copy">
                <span>Backoffice</span>
                <b>Operação Kulture</b>
                <p>Pedidos, estoque, clientes e marketing na mesma linguagem visual da loja.</p>
              </div>
            </div>
            <nav className="adm-nav">
              {NAV_ITEMS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/admin"}
                  className={({ isActive }) => isActive ? "active" : ""}
                >
                  <span className="txt">
                    <strong>{item.label}</strong>
                    <small>{item.hint}</small>
                  </span>
                  {navBadges[item.badge] ? <span className="n">{navBadges[item.badge]}</span> : null}
                </NavLink>
              ))}
            </nav>
            <div className="adm-side-foot">
              <small className="adm-side-kicker">Sessão ativa</small>
              <b title={auth.user.email}>{auth.user.name}</b>
              <span>{auth.user.email}</span>
              <div className="links">
                <a href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }}>Loja</a>
                <a href="/conta" onClick={(e) => { e.preventDefault(); navigate("/conta"); }}>Minha conta</a>
                <button onClick={async () => { await auth.logout(); navigate("/"); }}>Sair</button>
              </div>
            </div>
          </div>
        </aside>
        <main className="adm-main">
          <div className="adm-main-inner">
            <Routes>
              <Route index element={<Dashboard auth={auth} />} />
              <Route path="pedidos" element={<Orders auth={auth} />} />
              <Route path="pedidos/nova" element={<ManualOrder auth={auth} notify={notify} />} />
              <Route path="pedidos/:number" element={<OrderDetail auth={auth} notify={notify} />} />
              <Route path="entregas" element={<Deliveries auth={auth} notify={notify} />} />
              <Route path="clientes" element={<Customers auth={auth} />} />
              <Route path="clientes/:id" element={<CustomerDetail auth={auth} notify={notify} />} />
              <Route path="estoque" element={<Stock auth={auth} section="stock" />} />
              <Route path="estoque/novo" element={<StockForm auth={auth} notify={notify} section="stock" />} />
              <Route path="estoque/:id" element={<StockForm auth={auth} notify={notify} section="stock" />} />
              <Route path="hypados" element={<Stock auth={auth} section="hypados" />} />
              <Route path="hypados/novo" element={<StockForm auth={auth} notify={notify} section="hypados" />} />
              <Route path="hypados/:id" element={<StockForm auth={auth} notify={notify} section="hypados" />} />
              <Route path="importados" element={<Imported auth={auth} notify={notify} />} />
              <Route path="vitrine" element={<Featured auth={auth} notify={notify} />} />
              <Route path="restritos" element={<Restricted auth={auth} notify={notify} />} />
              <Route path="marketing" element={<Marketing auth={auth} notify={notify} />} />
              <Route path="precos" element={<Pricing auth={auth} notify={notify} />} />
              <Route path="cupons" element={<Coupons auth={auth} notify={notify} />} />
              <Route path="bling" element={<Bling auth={auth} notify={notify} />} />
              <Route path="*" element={<Navigate to="/admin" replace />} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
}
