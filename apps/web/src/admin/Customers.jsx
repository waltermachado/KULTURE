import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ErrorBox, Loading, Pager, RolePill, brl, fmtDate, fmtPhone } from "./ui.jsx";

export default function Customers({ auth }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") || "";
  const role = params.get("role") || "";
  const page = Number(params.get("page") || 1);
  const [input, setInput] = useState(q);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { setInput(q); }, [q]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const qs = new URLSearchParams({ page: String(page), pageSize: "25" });
    if (q) qs.set("q", q);
    if (role) qs.set("role", role);
    auth.request(`/api/admin/customers?${qs}`)
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e) => { if (alive) setError(e); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [q, role, page]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    if (!("page" in patch)) next.delete("page");
    setParams(next);
  };

  return (
    <>
      <header className="adm-head">
        <div>
          <h1>Clientes</h1>
          <div className="sub">{data ? `${data.total} cadastro(s)` : "—"} · compras como convidado aparecem no detalhe pelo e-mail</div>
        </div>
      </header>

      <div className="adm-toolbar">
        <form onSubmit={(e) => { e.preventDefault(); set({ q: input.trim() }); }} style={{ display: "contents" }}>
          <input type="search" placeholder="Buscar nome, e-mail, telefone, CPF…" value={input} onChange={(e) => setInput(e.target.value)} />
          <button className="btn" type="submit">Buscar</button>
        </form>
        <div className="spacer" />
        <div className="adm-chips">
          <button className={!role ? "on" : ""} onClick={() => set({ role: "" })}>Todos</button>
          <button className={role === "customer" ? "on" : ""} onClick={() => set({ role: "customer" })}>Clientes</button>
          <button className={role === "admin" ? "on" : ""} onClick={() => set({ role: "admin" })}>Admins</button>
        </div>
      </div>

      <ErrorBox error={error} />
      <div className="adm-table-wrap">
        {loading && !data ? <Loading /> : (
          <table>
            <thead>
              <tr><th>Nome</th><th>Contato</th><th>Local</th><th>Perfil</th><th className="num">Pedidos</th><th className="num">Total gasto</th><th>Última compra</th><th>Cadastro</th></tr>
            </thead>
            <tbody>
              {data?.customers.map((c) => (
                <tr key={c.id} className="link" onClick={() => navigate(`/admin/clientes/${c.id}`)}>
                  <td>{c.name}</td>
                  <td>{c.email}<span className="sub">{fmtPhone(c.phone)}</span></td>
                  <td>{c.city ? `${c.city}/${c.state}` : "—"}</td>
                  <td><RolePill role={c.role} /></td>
                  <td className="num">{c.paidOrders}<span className="sub">{c.ordersCount} no total</span></td>
                  <td className="num">{brl(c.spentBrl)}</td>
                  <td>{fmtDate(c.lastPaidAt)}</td>
                  <td>{fmtDate(c.createdAt)}</td>
                </tr>
              ))}
              {data && !data.customers.length && <tr><td colSpan={8} className="empty">Nenhum cliente encontrado</td></tr>}
            </tbody>
          </table>
        )}
      </div>
      {data && <Pager page={data.page} pages={data.pages} total={data.total} onPage={(p) => set({ page: String(p) })} />}
    </>
  );
}
