import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BarChart, HBars, ErrorBox, Loading, StatusPill, STATUS_LABELS, STATUS_ORDER, METHOD_LABELS, brl, fmtDateTime } from "./ui.jsx";

const RANGES = [7, 30, 90, 365];

export default function Dashboard({ auth }) {
  const navigate = useNavigate();
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    auth.request(`/api/admin/dashboard?days=${days}`)
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e) => { if (alive) setError(e); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [days]); // eslint-disable-line react-hooks/exhaustive-deps

  const t = data?.totals;
  const delta = t?.revenueDeltaPct;

  return (
    <>
      <header className="adm-head">
        <div>
          <h1>Dashboard <em>financeiro</em></h1>
          <div className="sub">Receita = pedidos pagos (pago, comprando, enviado, entregue) · estornos fora</div>
        </div>
        <div className="actions adm-chips">
          {RANGES.map((r) => (
            <button key={r} className={days === r ? "on" : ""} onClick={() => setDays(r)}>{r === 365 ? "1 ano" : `${r} dias`}</button>
          ))}
        </div>
      </header>

      <ErrorBox error={error} />
      {loading && !data && <Loading />}

      {t && (
        <>
          <div className="tiles">
            <div className="tile accent">
              <span className="k">Receita · {days} dias</span>
              <span className="v">{brl(t.revenueBrl)}</span>
              <span className={`d ${delta == null ? "" : delta >= 0 ? "up" : "down"}`}>
                {delta == null ? `Período anterior: ${brl(t.prevRevenueBrl)}` : `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)}% vs. período anterior (${brl(t.prevRevenueBrl)})`}
              </span>
            </div>
            <div className="tile">
              <span className="k">Pedidos pagos</span>
              <span className="v">{t.paidOrders}</span>
              <span className="d">{t.createdOrders} criados · conversão {t.conversionPct == null ? "—" : `${t.conversionPct}%`}</span>
            </div>
            <div className="tile">
              <span className="k">Ticket médio</span>
              <span className="v">{brl(t.avgTicketBrl)}</span>
              <span className="d">{t.itemsSold} par(es) vendido(s)</span>
            </div>
            <div className="tile">
              <span className="k">Margem estimada</span>
              <span className="v">{brl(t.estimatedMarginBrl)}</span>
              <span className="d">
                {t.estimatedMarginPct == null ? "sem base" : `${t.estimatedMarginPct}% da receita`} · custo est. {brl(t.estimatedCostBrl)}
              </span>
            </div>
            <div className="tile">
              <span className="k">Aguardando pagamento</span>
              <span className="v">{t.pendingPayment}</span>
              <span className="d">checkouts abertos agora</span>
            </div>
            <div className="tile">
              <span className="k">Clientes cadastrados</span>
              <span className="v">{t.customersTotal}</span>
              <span className="d">+{t.customersNew} no período</span>
            </div>
            <div className="tile">
              <span className="k">Para enviar</span>
              <span className="v">{(data.byStatus.paid || 0) + (data.byStatus.sourcing || 0)}</span>
              <span className="d">{data.byStatus.paid || 0} pagos · {data.byStatus.sourcing || 0} comprando nos EUA</span>
            </div>
            <div className="tile">
              <span className="k">Em trânsito</span>
              <span className="v">{data.byStatus.shipped || 0}</span>
              <span className="d">{data.byStatus.delivered || 0} entregues no total</span>
            </div>
          </div>

          <div className="adm-grid3">
            <section className="adm-card">
              <h3>Receita por dia <small>{brl(t.revenueBrl)} em {days} dias</small></h3>
              <BarChart series={data.series} />
              <div className="chart-legend">
                <span>{data.series[0]?.date.split("-").reverse().join("/")}</span>
                <span>{data.series.at(-1)?.date.split("-").reverse().join("/")}</span>
              </div>
            </section>
            <div>
              <section className="adm-card">
                <h3>Pedidos por status <small>todo o histórico</small></h3>
                <HBars
                  rows={STATUS_ORDER.filter((s) => data.byStatus[s]).map((s) => ({ key: s, label: STATUS_LABELS[s], value: data.byStatus[s] }))}
                />
              </section>
              <section className="adm-card">
                <h3>Forma de pagamento <small>receita no período</small></h3>
                <HBars
                  rows={Object.entries(data.byPaymentMethod).map(([k, v]) => ({ key: k, label: METHOD_LABELS[k] || k, value: v }))}
                  format={brl}
                />
              </section>
            </div>
          </div>

          <div className="adm-grid2" style={{ marginTop: 16 }}>
            <section className="adm-card">
              <h3>Mais vendidos <small>por pares · {days} dias</small></h3>
              <HBars
                rows={data.topProducts.map((p) => ({ key: p.styleColor, label: p.name, value: p.quantity, rev: p.revenueBrl }))}
                format={(v) => `${v} par${v > 1 ? "es" : ""}`}
              />
            </section>
            <section className="adm-card">
              <h3>Últimos pedidos <small><a href="/admin/pedidos" onClick={(e) => { e.preventDefault(); navigate("/admin/pedidos"); }}>ver todos →</a></small></h3>
              <div className="adm-table-wrap" style={{ border: 0 }}>
                <table>
                  <thead><tr><th>Pedido</th><th>Cliente</th><th>Status</th><th className="num">Total</th></tr></thead>
                  <tbody>
                    {data.recentOrders.map((o) => (
                      <tr key={o.number} className="link" onClick={() => navigate(`/admin/pedidos/${o.number}`)}>
                        <td><span className="mono">{o.number}</span><span className="sub">{fmtDateTime(o.createdAt)}</span></td>
                        <td>{o.customerName}</td>
                        <td><StatusPill status={o.status} /></td>
                        <td className="num">{brl(o.totalBrl)}</td>
                      </tr>
                    ))}
                    {!data.recentOrders.length && <tr><td colSpan={4} className="empty">Nenhum pedido ainda</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </>
      )}
    </>
  );
}
