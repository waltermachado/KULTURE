import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ErrorBox, Loading, StatusPill, ChannelPill, STATUS_LABELS, METHOD_LABELS, CHANNEL_LABELS, brl, fmtDateTime, fmtPhone, fmtCpf, fmtAddress } from "./ui.jsx";
import { customText } from "../lib/format.js";

const EVENT_LABELS = {
  created: "Pedido criado",
  link_created: "Link de pagamento gerado",
  payment_confirmed: "Pagamento confirmado (payment_check)",
  webhook_received: "Webhook do gateway",
  abandoned: "Marcado como abandonado (timeout)",
  status_changed: "Status alterado",
  tracking_updated: "Rastreio atualizado",
  notes_updated: "Notas internas atualizadas",
  note: "Anotação",
  payment_recheck: "Reconsulta de pagamento",
  payment_registered: "Pagamento registrado à mão (venda externa)",
  payment_amount_mismatch: "Valor divergente no gateway (NÃO marcado como pago)",
  payment_check_unpaid: "Gateway: ainda não pago",
  stock_reserved: "Estoque baixado (pronta entrega)",
  stock_released: "Estoque devolvido (pronta entrega)",
  stock_reserved_again: "Estoque reservado de novo",
  stock_oversold: "⚠️ Sem estoque para reservar (conferir)",
  email_registered: "E-mail: pedido registrado (venda externa)",
  email_shipped: "E-mail: pedido enviado",
  email_delivered: "E-mail: pedido entregue",
  email_cancelled: "E-mail: pedido cancelado",
  email_refunded: "E-mail: pedido estornado",
  email_paid_resent: "E-mail de confirmação reenviado",
  email_shipped_resent: "E-mail de envio reenviado",
  email_delivered_resent: "E-mail de entrega reenviado"
};

const CARRIERS = ["Correios", "Jadlog", "Loggi", "DHL", "FedEx", "UPS", "Outro"];
const trackingUrlFor = (carrier, code) => {
  if (!code) return "";
  if (carrier === "Correios") return `https://rastreamento.correios.com.br/app/index.php?objetos=${encodeURIComponent(code)}`;
  if (carrier === "Jadlog") return `https://www.jadlog.com.br/siteInstitucional/tracking.jad?cte=${encodeURIComponent(code)}`;
  if (carrier === "DHL") return `https://www.dhl.com/br-pt/home/tracking.html?tracking-id=${encodeURIComponent(code)}`;
  if (carrier === "FedEx") return `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(code)}`;
  if (carrier === "UPS") return `https://www.ups.com/track?tracknum=${encodeURIComponent(code)}`;
  return "";
};

function describeEvent(ev) {
  const p = ev.payload || {};
  const who = p.adminEmail ? ` · por ${p.adminEmail}` : "";
  switch (ev.type) {
    case "status_changed":
      return `${STATUS_LABELS[p.from] || p.from} → ${STATUS_LABELS[p.to] || p.to}${p.note ? ` — "${p.note}"` : ""}${who}`;
    case "tracking_updated":
      return `${p.carrier || "—"} · ${p.trackingCode || "sem código"}${who}`;
    case "note":
      return `"${p.note}"${who}`;
    case "notes_updated":
      return who.replace(" · ", "");
    case "payment_confirmed":
      return `${p.captureMethod || ""} ${p.transactionNsu ? `· NSU ${p.transactionNsu}` : ""}`.trim();
    case "payment_recheck":
      return p.paid ? "gateway confirmou: PAGO" : "gateway: ainda não pago";
    case "payment_registered":
      return `${METHOD_LABELS[p.method] || p.method || "—"}${p.installments > 1 ? ` ${p.installments}x` : ""} · ${brl(p.paidAmountBrl)}${p.reference ? ` · ref. ${p.reference}` : ""}${p.paidAt ? ` · em ${fmtDateTime(p.paidAt)}` : ""}${who}`;
    case "created":
      return p.manual ? `venda externa · ${CHANNEL_LABELS[p.channel] || p.channel}${p.userLink === "email" ? " · vinculada à conta do cliente" : " · cliente sem conta (aparece quando ele se cadastrar com o e-mail)"}${who}` : "";
    case "stock_reserved":
    case "stock_released":
    case "stock_reserved_again":
      return (p.items || []).map((i) => `${i.label} × ${i.qty}`).join(", ");
    case "stock_oversold":
      return (p.oversold || []).map((i) => `${i.label} × ${i.qty}`).join(", ");
    case "abandoned":
      return p.reason ? `motivo: ${p.reason}` : "";
    default:
      if (ev.type.startsWith("email_")) return p.ok ? `enviado (${p.provider || "mail"})` : `falhou${p.error ? `: ${p.error}` : ""}`;
      return "";
  }
}

export default function OrderDetail({ auth, notify }) {
  const { number } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  // formulário de transição
  const [nextStatus, setNextStatus] = useState("");
  const [carrier, setCarrier] = useState("");
  const [trackingCode, setTrackingCode] = useState("");
  const [trackingUrl, setTrackingUrl] = useState("");
  const [note, setNote] = useState("");
  const [notes, setNotes] = useState("");
  const [notifyCustomer, setNotifyCustomer] = useState(true);
  const [nsu, setNsu] = useState("");

  const load = useCallback(async () => {
    try {
      const o = await auth.request(`/api/admin/orders/${encodeURIComponent(number)}`);
      setOrder(o);
      setError(null);
      setCarrier(o.carrier || "");
      setTrackingCode(o.trackingCode || "");
      setTrackingUrl(o.trackingUrl || "");
      setNotes(o.internalNotes || "");
      setNextStatus("");
    } catch (e) {
      setError(e);
    }
  }, [auth, number]);

  useEffect(() => { load(); }, [load]);

  async function patch(body, okMsg) {
    setBusy(true);
    setMsg(null);
    try {
      const o = await auth.request(`/api/admin/orders/${encodeURIComponent(number)}`, { method: "PATCH", body: JSON.stringify(body) });
      setOrder(o);
      setNextStatus("");
      setNote("");
      setMsg({ ok: true, text: okMsg });
      notify?.(okMsg);
    } catch (e) {
      setMsg({ ok: false, text: e.message + (e.details?.allowed ? ` (permitido: ${e.details.allowed.map((s) => STATUS_LABELS[s]).join(", ")})` : "") });
    } finally {
      setBusy(false);
    }
  }

  const saveTracking = () =>
    patch({ carrier: carrier || null, trackingCode: trackingCode || null, trackingUrl: trackingUrl || null }, "Rastreio salvo");
  const saveNotes = () => patch({ internalNotes: notes || null }, "Notas salvas");
  const applyStatus = () => {
    if (!nextStatus) return;
    const body = { status: nextStatus, notifyCustomer };
    if (note.trim()) body.note = note.trim();
    if (nextStatus === "shipped") {
      body.carrier = carrier || null;
      body.trackingCode = trackingCode || null;
      body.trackingUrl = trackingUrl || trackingUrlFor(carrier, trackingCode) || null;
      if (!trackingCode) body.allowNoTracking = window.confirm("Marcar como enviado SEM código de rastreio?");
      if (!trackingCode && !body.allowNoTracking) return;
    }
    if (["cancelled", "refunded"].includes(nextStatus) && !window.confirm(`Confirma ${STATUS_LABELS[nextStatus].toLowerCase()} o pedido ${number}?`)) return;
    patch(body, `Pedido → ${STATUS_LABELS[nextStatus]}`);
  };

  async function recheck() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await auth.request(`/api/admin/orders/${encodeURIComponent(number)}/recheck`, { method: "POST", body: JSON.stringify(nsu ? { transactionNsu: nsu } : {}) });
      setMsg({ ok: r.paid, text: r.paid ? "Gateway confirmou o pagamento" : "Gateway ainda não confirma pagamento" });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function resend(kind) {
    setBusy(true);
    try {
      const r = await auth.request(`/api/admin/orders/${encodeURIComponent(number)}/resend-email`, { method: "POST", body: JSON.stringify({ kind }) });
      setMsg({ ok: r.ok, text: r.ok ? `E-mail reenviado (${r.provider})` : `Falha no e-mail: ${r.error || r.provider}` });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  if (error) return <><header className="adm-head"><h1>Pedido</h1></header><ErrorBox error={error} /><Link className="btn" to="/admin/pedidos">← Pedidos</Link></>;
  if (!order) return <Loading />;

  const a = order.address || {};
  const paidLike = ["paid", "sourcing", "shipped", "delivered"].includes(order.status);
  const manual = order.paymentProvider === "manual" || order.external;
  const discount = Number(order.pricingSnapshot?.discountBrl) || 0;
  const registeredBy = order.pricingSnapshot?.registeredBy?.adminEmail || order.events?.find((e) => e.type === "created")?.payload?.adminEmail || null;

  return (
    <>
      <header className="adm-head">
        <div>
          <div className="sub" style={{ marginTop: 0, marginBottom: 8 }}><Link to="/admin/pedidos">← Pedidos</Link></div>
          <h1><span className="mono" style={{ letterSpacing: 0 }}>{order.number}</span></h1>
          <div className="sub">{manual ? `venda externa · ${CHANNEL_LABELS[order.channel] || order.channel}${registeredBy ? ` · registrada por ${registeredBy}` : ""} · ` : ""}criado {fmtDateTime(order.createdAt)}{order.paidAt ? ` · pago ${fmtDateTime(order.paidAt)}` : ""}{order.shippedAt ? ` · enviado ${fmtDateTime(order.shippedAt)}` : ""}{order.deliveredAt ? ` · entregue ${fmtDateTime(order.deliveredAt)}` : ""}</div>
        </div>
        <div className="actions">
          <ChannelPill channel={order.channel} />
          <StatusPill status={order.status} />
          <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-.02em" }}>{brl(order.totalBrl)}</span>
        </div>
      </header>

      {msg && <div className={msg.ok ? "ok" : "err"}>{msg.text}</div>}

      <div className="adm-grid3">
        <div>
          <section className="adm-card">
            <h3>Itens <small>{order.items.length} linha(s)</small></h3>
            <div className="items">
              {order.items.map((it) => (
                <div className="item" key={it.id}>
                  <div className="thumb">{it.image ? <img src={it.image} alt="" /> : null}</div>
                  <div>
                    <b>{it.name}</b>
                    <span>{it.styleColor}{it.breakdown?.source === "stock" ? (it.breakdown?.section === "hypados" ? " · HYPADOS" : " · PRONTA ENTREGA") : ""} · {it.sizeLabel || `BR ${it.brLabel ?? it.brSize ?? "?"}${it.nikeSize && String(it.nikeSize) !== String(it.brLabel ?? it.brSize) ? ` (US ${it.nikeSize})` : ""}`} · {it.colorDescription || ""}</span>
                    {it.customization && <span style={{ color: "var(--yellow)" }}>NIKE BY YOU · {customText(it.customization) || "sem gravação"} · US para configurar: {it.nikeSize}</span>}
                  </div>
                  <div className="price">
                    {it.quantity} × {brl(it.unitPriceBrl)}
                    <small>US$ {Number(it.unitPriceUsd).toFixed(2)} · custo est. {brl((Number(it.breakdown?.subtotalBrl) || 0) * it.quantity)}</small>
                  </div>
                </div>
              ))}
            </div>
            <dl className="kv" style={{ marginTop: 16, borderTop: "1px solid var(--hair)", paddingTop: 12 }}>
              <dt>Subtotal</dt><dd>{brl(order.subtotalBrl)}</dd>
              {discount > 0 && <><dt>Desconto</dt><dd>− {brl(discount)}</dd></>}
              <dt>Frete</dt><dd>Grátis (embutido)</dd>
              <dt>Total</dt><dd><b>{brl(order.totalBrl)}</b>{order.paidAmountBrl != null && Number(order.paidAmountBrl) !== Number(order.totalBrl) ? ` · pago ${brl(order.paidAmountBrl)} (${Number(order.paidAmountBrl) > Number(order.totalBrl) ? "juros repassados ao cliente: +" : "diferença: "}${brl(Math.abs(Number(order.paidAmountBrl) - Number(order.totalBrl)))})` : order.paidAt ? " · pago sem juros" : ""}</dd>
              {Number(order.exchangeRate) > 0 && <><dt>Câmbio</dt><dd>US$ 1 = R$ {Number(order.exchangeRate).toFixed(2)}{manual ? <small style={{ color: "var(--muted)" }}> (só informativo — venda negociada em R$)</small> : ""}</dd></>}
              <dt>Custo estimado</dt><dd>{brl(order.economics.costBrl)} <small style={{ color: "var(--muted)" }}>{manual ? "(custo informado no registro da venda; por item)" : "(produto + frete US + taxas, pelo breakdown salvo)"}</small></dd>
              <dt>Margem estimada</dt><dd><b style={{ color: "var(--green)" }}>{brl(order.economics.marginBrl)}</b></dd>
            </dl>
          </section>

          <section className="adm-card">
            <h3>Cliente &amp; entrega</h3>
            <dl className="kv">
              <dt>Nome</dt><dd>{order.customerName}{order.user ? <> · <Link to={`/admin/clientes/${order.user.id}`}>ver cadastro →</Link></> : <span style={{ color: "var(--muted)" }}> · convidado</span>}</dd>
              <dt>E-mail</dt><dd><a href={`mailto:${order.customerEmail}`}>{order.customerEmail}</a></dd>
              <dt>Telefone</dt><dd>{order.customerPhone ? <a href={`https://wa.me/55${String(order.customerPhone).replace(/\D/g, "")}`} target="_blank" rel="noreferrer">{fmtPhone(order.customerPhone)} (WhatsApp)</a> : "—"}</dd>
              <dt>CPF</dt><dd>{fmtCpf(order.customerCpf)}</dd>
              <dt>Endereço</dt><dd>{fmtAddress(a)}</dd>
            </dl>
          </section>

          <section className="adm-card">
            <h3>Pagamento</h3>
            <dl className="kv">
              <dt>Gateway</dt><dd>{manual ? <>venda externa <small style={{ color: "var(--muted)" }}>(registrada no painel, sem link de pagamento)</small></> : order.paymentProvider}</dd>
              <dt>Forma</dt><dd>{METHOD_LABELS[order.paymentMethod] || order.paymentMethod || "—"}{order.installments > 1 ? ` · ${order.installments}x` : ""}</dd>
              <dt>{manual ? "Referência" : "NSU"}</dt><dd><span className="mono">{order.transactionNsu || "—"}</span></dd>
              {!manual && <><dt>Slug/Link</dt><dd><span className="mono">{order.infinitepaySlug || "—"}</span></dd></>}
              <dt>Comprovante</dt><dd>{order.receiptUrl ? <a href={order.receiptUrl} target="_blank" rel="noreferrer">abrir ↗</a> : "—"}</dd>
            </dl>
            {!paidLike && ["pending_payment", "abandoned"].includes(order.status) && (
              <div className="transition-form" style={{ marginTop: 14 }}>
                <div className="adm-note">Ficou pendente mas o cliente pagou? Reconsulte o gateway (opcionalmente informe o NSU da transação, do painel da InfinitePay) ou dê baixa manual em “Status”.</div>
                <div className="row2">
                  <input placeholder="transaction_nsu (opcional)" value={nsu} onChange={(e) => setNsu(e.target.value)} />
                  <button className="btn" disabled={busy} onClick={recheck}>Reconsultar pagamento</button>
                </div>
              </div>
            )}
            {paidLike && (
              <div className="adm-toolbar" style={{ marginTop: 14, marginBottom: 0 }}>
                <button className="btn sm" disabled={busy} onClick={() => resend("paid")}>{manual ? "Reenviar e-mail de pedido registrado" : "Reenviar e-mail de confirmação"}</button>
                {order.trackingCode && <button className="btn sm" disabled={busy} onClick={() => resend("shipped")}>Reenviar e-mail de envio</button>}
              </div>
            )}
          </section>
        </div>

        <div>
          <section className="adm-card">
            <h3>Status</h3>
            {order.allowedTransitions.length ? (
              <div className="transition-form">
                <div className="field">
                  <label>Mudar para</label>
                  <select value={nextStatus} onChange={(e) => setNextStatus(e.target.value)}>
                    <option value="">— escolher —</option>
                    {order.allowedTransitions.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                  </select>
                </div>
                {nextStatus === "shipped" && (
                  <>
                    <div className="row2">
                      <div className="field"><label>Transportadora</label>
                        <select value={carrier} onChange={(e) => { setCarrier(e.target.value); setTrackingUrl(trackingUrlFor(e.target.value, trackingCode)); }}>
                          <option value="">—</option>{CARRIERS.map((c) => <option key={c}>{c}</option>)}
                        </select>
                      </div>
                      <div className="field"><label>Código de rastreio</label>
                        <input value={trackingCode} onChange={(e) => { setTrackingCode(e.target.value.trim()); setTrackingUrl(trackingUrlFor(carrier, e.target.value.trim())); }} placeholder="NL123456789BR" />
                      </div>
                    </div>
                    <div className="field"><label>Link de rastreio (opcional)</label><input value={trackingUrl} onChange={(e) => setTrackingUrl(e.target.value)} placeholder="https://…" /></div>
                  </>
                )}
                <div className="field"><label>Observação (vai para o histórico)</label><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ex.: comprado na Nike US, chega em 12 dias" /></div>
                {["shipped", "delivered", "cancelled", "refunded"].includes(nextStatus) && (
                  <label className="check" style={{ margin: 0 }}>
                    <input type="checkbox" checked={notifyCustomer} onChange={(e) => setNotifyCustomer(e.target.checked)} /> Avisar o cliente por e-mail
                  </label>
                )}
                <button className="btn primary" disabled={!nextStatus || busy} onClick={applyStatus}>Aplicar</button>
              </div>
            ) : (
              <div className="adm-note">Status final — sem transições.</div>
            )}
          </section>

          <section className="adm-card">
            <h3>Rastreio</h3>
            <div className="transition-form">
              <div className="field"><label>Transportadora</label>
                <select value={carrier} onChange={(e) => setCarrier(e.target.value)}><option value="">—</option>{CARRIERS.map((c) => <option key={c}>{c}</option>)}</select>
              </div>
              <div className="field"><label>Código</label><input value={trackingCode} onChange={(e) => setTrackingCode(e.target.value.trim())} /></div>
              <div className="field"><label>Link</label><input value={trackingUrl} onChange={(e) => setTrackingUrl(e.target.value)} placeholder={trackingUrlFor(carrier, trackingCode) || "https://…"} /></div>
              <div className="adm-toolbar" style={{ margin: 0 }}>
                <button className="btn" disabled={busy} onClick={saveTracking}>Salvar rastreio</button>
                {(trackingUrl || trackingUrlFor(carrier, trackingCode)) && <a className="btn sm" href={trackingUrl || trackingUrlFor(carrier, trackingCode)} target="_blank" rel="noreferrer">abrir ↗</a>}
              </div>
            </div>
          </section>

          <section className="adm-card">
            <h3>Notas internas <small>só o painel vê</small></h3>
            <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ex.: nº do pedido na Nike US, custo real do frete, ocorrências…" style={{ width: "100%" }} />
            <div className="adm-toolbar" style={{ margin: "10px 0 0" }}><button className="btn" disabled={busy} onClick={saveNotes}>Salvar notas</button></div>
          </section>

          <section className="adm-card">
            <h3>Histórico <small>{order.events.length} evento(s)</small></h3>
            <div className="timeline">
              {[...order.events].reverse().map((ev) => (
                <div className={`tl${ev.type.startsWith("email_") || ev.type === "notes_updated" ? " muted" : ""}`} key={ev.id}>
                  <b>{EVENT_LABELS[ev.type] || ev.type}</b>
                  <time>{fmtDateTime(ev.createdAt)}</time>
                  {describeEvent(ev) && <span className="payload">{describeEvent(ev)}</span>}
                </div>
              ))}
            </div>
            {order.notifications?.length > 0 && (
              <>
                <h3 style={{ marginTop: 16 }}>Notificações WhatsApp <small>{order.notifications.length}</small></h3>
                <div className="timeline">
                  {order.notifications.map((n) => (
                    <div className="tl muted" key={n.id}>
                      <b>{n.event} · {n.status} ({n.provider})</b>
                      <time>{fmtDateTime(n.createdAt)} → {n.to}</time>
                      {n.lastError && <span className="payload">{n.lastError}</span>}
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
