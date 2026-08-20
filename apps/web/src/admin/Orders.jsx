import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ErrorBox, Loading, Pager, StatusPill, ChannelPill, STATUS_LABELS, STATUS_ORDER, METHOD_LABELS, brl, fmtDateTime } from "./ui.jsx";

/**
 * Lista de pedidos com filtro por status, canal (site × vendas externas), busca (nº, nome, e-mail, CPF, rastreio, NSU)
 * e paginação. Estado vive na URL (?status=&channel=&q=&page=) para o botão voltar funcionar.
 * "+ Venda externa" registra uma venda feita fora do site (ManualOrder.jsx).
 */
const CHANNEL_FILTERS = [["", "Todos os canais"], ["site", "Site"], ["external", "Vendas externas"]];
export default function Orders({ auth }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") || "";
  const channel = params.get("channel") || "";
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
    if (channel) qs.set("channel", channel);
    if (q) qs.set("q", q);
    auth.request(`/api/admin/orders?${qs}`)
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e) => { if (alive) setError(e); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [status, channel, q, page]); // eslint-disable-line react-hooks/exhaustive-deps

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
          <div className="sub">{data ? `${data.total} pedido(s)${status ? ` · ${STATUS_LABELS[status] || status}` : ""}${channel === "external" ? " · vendas externas" : channel === "site" ? " · site" : ""}` : "—"}</div>
        </div>
        <div className="actions">
          <Link className="btn primary" to="/admin/pedidos/nova" title="Registrar uma venda feita fora do site (WhatsApp, Instagram, presencial…)">+ Venda externa</Link>
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
      <div className="adm-toolbar" style={{ marginTop: -6 }}>
        <span className="sub" style={{ fontSize: 10, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--muted)" }}>Canal</span>
        <div className="adm-chips">
          {CHANNEL_FILTERS.map(([k, label]) => (
            <button key={k} className={channel === k ? "on" : ""} onClick={() => set({ channel: k })}>{label}</button>
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
                  <td><span className="mono">{o.number}</span><span className="sub">{fmtDateTime(o.createdAt)}{o.external ? " · externa" : ""}</span></td>
                  <td>{o.customerName}<span className="sub">{o.customerEmail}</span></td>
                  <td>{o.city ? `${o.city}/${o.state}` : "—"}</td>
                  <td><StatusPill status={o.status} />{o.external ? <> <ChannelPill channel={o.channel} short /></> : null}</td>
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
