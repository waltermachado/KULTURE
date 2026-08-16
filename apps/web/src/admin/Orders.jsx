import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ErrorBox, Loading, Pager, StatusPill, STATUS_LABELS, STATUS_ORDER, METHOD_LABELS, brl, fmtDateTime } from "./ui.jsx";

/**
 * Lista de pedidos com filtro por status, busca (nº, nome, e-mail, CPF, rastreio, NSU) e paginação.
 * Estado vive na URL (?status=&q=&page=) para o botão voltar funcionar.
 */
export default function Orders({ auth }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") || "";
  const q = params.get("q") || "";
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
    if (status) qs.set("status", status);
    if (q) qs.set("q", q);
    auth.request(`/api/admin/orders?${qs}`)
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e) => { if (alive) setError(e); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [status, q, page]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v); else next.delete(k);
    }
    if (!("page" in patch)) next.delete("page");
    setParams(next);
  };

  return (
    <>
      <header className="adm-head">
        <div>
          <h1>Pedidos</h1>
          <div className="sub">{data ? `${data.total} pedido(s)${status ? ` · ${STATUS_LABELS[status] || status}` : ""}` : "—"}</div>
        </div>
      </header>

      <div className="adm-toolbar">
        <form onSubmit={(e) => { e.preventDefault(); set({ q: input.trim() }); }} style={{ display: "contents" }}>
          <input type="search" placeholder="Buscar nº, nome, e-mail, CPF, rastreio, NSU…" value={input} onChange={(e) => setInput(e.target.value)} />
          <button className="btn" type="submit">Buscar</button>
        </form>
        <div className="spacer" />
        <div className="adm-chips">
          <button className={!status ? "on" : ""} onClick={() => set({ status: "" })}>Todos</button>
          {STATUS_ORDER.map((s) => (
            <button key={s} className={status === s ? "on" : ""} onClick={() => set({ status: s })}>{STATUS_LABELS[s]}</button>
          ))}
        </div>
      </div>

      <ErrorBox error={error} />
      <div className="adm-table-wrap">
        {loading && !data ? <Loading /> : (
          <table>
            <thead>
              <tr>
                <th>Pedido</th><th>Cliente</th><th>Local</th><th>Status</th><th>Pagamento</th><th>Rastreio</th><th className="num">Itens</th><th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {data?.orders.map((o) => (
                <tr key={o.number} className="link" onClick={() => navigate(`/admin/pedidos/${o.number}`)}>
                  <td><span className="mono">{o.number}</span><span className="sub">{fmtDateTime(o.createdAt)}</span></td>
                  <td>{o.customerName}<span className="sub">{o.customerEmail}</span></td>
                  <td>{o.city ? `${o.city}/${o.state}` : "—"}</td>
                  <td><StatusPill status={o.status} /></td>
                  <td>{METHOD_LABELS[o.paymentMethod] || o.paymentMethod || "—"}<span className="sub">{o.paidAt ? `pago ${fmtDateTime(o.paidAt)}` : o.paymentProvider}</span></td>
                  <td>{o.trackingCode ? <><span className="mono">{o.trackingCode}</span><span className="sub">{o.carrier || ""}</span></> : "—"}</td>
                  <td className="num">{o.itemsCount}</td>
                  <td className="num">{brl(o.totalBrl)}</td>
                </tr>
              ))}
              {data && !data.orders.length && <tr><td colSpan={8} className="empty">Nenhum pedido encontrado</td></tr>}
            </tbody>
          </table>
        )}
      </div>
      {data && <Pager page={data.page} pages={data.pages} total={data.total} onPage={(p) => set({ page: String(p) })} />}
    </>
  );
}
