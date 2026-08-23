import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ErrorBox, Loading, StatusPill, ChannelPill, STATUS_LABELS, TO_SHIP, NEXT_STAGE, brl, fmtDate, fmtDateTime, fmtPhone } from "./ui.jsx";

/**
 * Fila de entregas: tudo que foi pago e ainda não chegou ao cliente.
 *   Pagamento aprovado → Pedido comprado → Em trânsito internacional → Chegou no Brasil → Enviado pro endereço (rastreio) → Entregue
 * Ações inline para não precisar abrir o pedido para o dia a dia (cada etapa manda e-mail ao cliente).
 */
const TO_SHIP_KEY = TO_SHIP.join(",");
const TABS = [
  { key: TO_SHIP_KEY, label: "Para enviar" },
  { key: "shipped", label: "A caminho do cliente" },
  { key: "delivered", label: "Entregues" }
];
const NEXT_LABEL = { sourcing: "Comprado", in_transit: "Em trânsito intl.", arrived_br: "Chegou no BR" };
const CARRIERS = ["Correios", "Jadlog", "Loggi", "DHL", "FedEx", "UPS", "Outro"];

export default function Deliveries({ auth, notify }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState(TABS[0].key);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState({}); // number → { carrier, trackingCode }
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await auth.request(`/api/admin/orders?status=${tab}&pageSize=100&sort=${tab === "delivered" ? "updatedAt:desc" : "paidAt:asc"}`);
      setData(d);
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [auth, tab]);

  useEffect(() => { load(); }, [load]);

  const patchOrder = async (number, body, okMsg) => {
    setBusy(number);
    try {
      await auth.request(`/api/admin/orders/${encodeURIComponent(number)}`, { method: "PATCH", body: JSON.stringify(body) });
      notify?.(okMsg);
      setEdit((e) => ({ ...e, [number]: undefined }));
      await load();
    } catch (e) {
      notify?.(e.message);
    } finally {
      setBusy(null);
    }
  };

  const ship = (o) => {
    const e = edit[o.number] || {};
    const carrier = e.carrier ?? o.carrier ?? "";
    const trackingCode = (e.trackingCode ?? o.trackingCode ?? "").trim();
    if (!trackingCode && !window.confirm("Marcar como enviado SEM código de rastreio?")) return;
    patchOrder(o.number, { status: "shipped", carrier: carrier || null, trackingCode: trackingCode || null, allowNoTracking: !trackingCode }, `${o.number} enviado`);
  };

  return (
    <>
      <header className="adm-head">
        <div>
          <h1>Entregas</h1>
          <div className="sub">fila operacional · pago → comprando nos EUA → enviado → entregue</div>
        </div>
        <div className="actions adm-chips">
          {TABS.map((t) => <button key={t.key} className={tab === t.key ? "on" : ""} onClick={() => setTab(t.key)}>{t.label}</button>)}
        </div>
      </header>

      <ErrorBox error={error} />
      <div className="adm-table-wrap">
        {loading && !data ? <Loading /> : (
          <table>
            <thead>
              <tr>
                <th>Pedido</th><th>Cliente</th><th>Destino</th><th>Status</th><th>{tab === TO_SHIP_KEY ? "Transportadora / rastreio" : "Rastreio"}</th><th className="num">Total</th><th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {data?.orders.map((o) => {
                const e = edit[o.number] || {};
                const carrier = e.carrier ?? o.carrier ?? "";
                const code = e.trackingCode ?? o.trackingCode ?? "";
                return (
                  <tr key={o.number}>
                    <td>
                      <a href={`/admin/pedidos/${o.number}`} onClick={(ev) => { ev.preventDefault(); navigate(`/admin/pedidos/${o.number}`); }} className="mono">{o.number}</a>
                      <span className="sub">pago {fmtDate(o.paidAt)} · {o.itemsCount} item(ns)</span>
                    </td>
                    <td>{o.customerName}<span className="sub">{fmtPhone(o.customerPhone)}</span></td>
                    <td>{o.city ? `${o.city}/${o.state}` : "—"}</td>
                    <td><StatusPill status={o.status} />{o.external ? <> <ChannelPill channel={o.channel} short /></> : null}</td>
                    <td>
                      {tab === TO_SHIP_KEY ? (
                        <div style={{ display: "flex", gap: 6 }}>
                          <select value={carrier} onChange={(ev) => setEdit((s) => ({ ...s, [o.number]: { ...e, carrier: ev.target.value } }))} style={{ height: 32, fontSize: 12 }}>
                            <option value="">Transp.</option>{CARRIERS.map((c) => <option key={c}>{c}</option>)}
                          </select>
                          <input value={code} onChange={(ev) => setEdit((s) => ({ ...s, [o.number]: { ...e, trackingCode: ev.target.value } }))} placeholder="código de rastreio" style={{ height: 32, fontSize: 12, width: 170 }} />
                        </div>
                      ) : (
                        <>{o.trackingCode ? <span className="mono">{o.trackingCode}</span> : "—"}<span className="sub">{o.carrier || ""}{o.shippedAt ? ` · enviado ${fmtDateTime(o.shippedAt)}` : ""}{o.deliveredAt ? ` · entregue ${fmtDateTime(o.deliveredAt)}` : ""}</span></>
                      )}
                    </td>
                    <td className="num">{brl(o.totalBrl)}</td>
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        {NEXT_STAGE[o.status] && <button className="btn sm" disabled={busy === o.number} title={STATUS_LABELS[NEXT_STAGE[o.status]]} onClick={() => patchOrder(o.number, { status: NEXT_STAGE[o.status] }, `${o.number} → ${STATUS_LABELS[NEXT_STAGE[o.status]]}`)}>{NEXT_LABEL[NEXT_STAGE[o.status]]}</button>}
                        {TO_SHIP.includes(o.status) && <button className="btn sm primary" disabled={busy === o.number} onClick={() => ship(o)}>Enviado</button>}
                        {o.status === "shipped" && <button className="btn sm primary" disabled={busy === o.number} onClick={() => patchOrder(o.number, { status: "delivered" }, `${o.number} entregue`)}>Entregue</button>}
                        {o.status === "delivered" && <span className="adm-note">✓ {fmtDate(o.deliveredAt)}</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {data && !data.orders.length && <tr><td colSpan={7} className="empty">Nada por aqui</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
