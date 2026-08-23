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
import Featured from "./Featured.jsx";
import Marketing from "./Marketing.jsx";
import Pricing from "./Pricing.jsx";
import Coupons from "./Coupons.jsx";
import Bling from "./Bling.jsx";

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

  return (
    <div className="adm">
      <aside className="adm-side">
        <div className="adm-brand">
          <img src="/logo.png" alt="Kulture" />
          <span>Backoffice</span>
        </div>
        <nav className="adm-nav">
          <NavLink to="/admin" end>Dashboard</NavLink>
          <NavLink to="/admin/pedidos">Pedidos {pending ? <span className="n">{pending}</span> : null}</NavLink>
          <NavLink to="/admin/entregas">Entregas {toShip ? <span className="n">{toShip}</span> : null}</NavLink>
          <NavLink to="/admin/clientes">Clientes</NavLink>
          <NavLink to="/admin/estoque">Pronta entrega</NavLink>
          <NavLink to="/admin/hypados">Hypados</NavLink>
          <NavLink to="/admin/vitrine">Vitrine</NavLink>
          <NavLink to="/admin/marketing">Marketing</NavLink>
          <NavLink to="/admin/precos">Preços</NavLink>
          <NavLink to="/admin/cupons">Cupons</NavLink>
          <NavLink to="/admin/bling">Bling</NavLink>
        </nav>
        <div className="adm-side-foot">
          <b title={auth.user.email}>{auth.user.name}</b>
          <span>{auth.user.email}</span>
          <div className="links">
            <a href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }}>Loja</a>
            <a href="/conta" onClick={(e) => { e.preventDefault(); navigate("/conta"); }}>Minha conta</a>
            <button onClick={async () => { await auth.logout(); navigate("/"); }}>Sair</button>
          </div>
        </div>
      </aside>
      <main className="adm-main">
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
          <Route path="vitrine" element={<Featured auth={auth} notify={notify} />} />
          <Route path="marketing" element={<Marketing auth={auth} notify={notify} />} />
          <Route path="precos" element={<Pricing auth={auth} notify={notify} />} />
          <Route path="cupons" element={<Coupons auth={auth} notify={notify} />} />
          <Route path="bling" element={<Bling auth={auth} notify={notify} />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </main>
    </div>
  );
}
