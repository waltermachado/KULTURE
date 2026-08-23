import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { METHOD_LABELS, CHANNEL_LABELS, EXTERNAL_CHANNELS, STATUS_LABELS, brl } from "./ui.jsx";
import { SIZE_GROUP_LABELS } from "../lib/format.js";

/**
 * Venda externa — registra uma venda feita FORA do site (WhatsApp, Instagram, presencial…) como um pedido normal,
 * já pago: o cliente acompanha em /conta (pelo e-mail) ou em "Rastrear pedido"; o admin vê em Pedidos/Entregas e a
 * receita entra no dashboard (separada por canal). POST /api/admin/orders.
 *
 * Itens podem vir de três lugares:
 *  - Pronta entrega: produto cadastrado + tamanho → baixa o estoque (pode desmarcar);
 *  - Nike (importado): busca pelo SKU/nome em GET /api/admin/catalog/:term → preenche nome/foto/preço/custo/tamanhos;
 *  - Outro: tudo digitado à mão (qualquer produto).
 */
const EMPTY_ADDR = { cep: "", street: "", number: "", complement: "", neighborhood: "", city: "", state: "" };
const CARRIERS = ["Correios", "Jadlog", "Loggi", "DHL", "FedEx", "UPS", "Outro"];
const PAYMENT_METHODS = ["pix", "credit_card", "debit_card", "cash", "transfer", "other"];
const INITIAL_STATUSES = ["paid", "sourcing", "in_transit", "arrived_br", "shipped", "delivered"];
const GENDER_OPTS = [["", "—"], ["M", "Masculino"], ["W", "Feminino"], ["K", "Infantil"]];

const parseMoney = (v) => {
  if (v === "" || v == null) return null;
  const s = String(v).trim();
  const n = s.includes(",") ? Number(s.replace(/\./g, "").replace(",", ".")) : Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
};
const fmtMoneyInput = (v) => (v == null || v === "" ? "" : String(Number(v).toFixed(2)).replace(".", ","));
const maskCep = (v) => { const d = String(v || "").replace(/\D/g, "").slice(0, 8); return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d; };
const localNow = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const round2 = (n) => Math.round(n * 100) / 100;

/** Rótulo "BR 41 (US M 9.5)" como o servidor vai gravar (prévia). */
function previewLabel({ br, us, gender }) {
  if (!br) return "";
  if (us && gender) return gender === "K" ? `BR ${br} (US ${us})` : `BR ${br} (US ${gender} ${us})`;
  if (us) return `BR ${br} (US ${us})`;
  return `BR ${br}`;
}
/** US por modelagem de um tamanho da pronta entrega (mesma regra do stock/service: unissex → W = M + 1,5). */
function stockUs(product, size, gender) {
  const us = size.us ? String(size.us) : "";
  if (!us) return "";
  if (product.gender === "U" && gender === "W") { const n = Number(us); return Number.isFinite(n) ? String(Math.round((n + 1.5) * 2) / 2) : us; }
  return us;
}
const stockGender = (product, picked) => (product.gender === "U" ? picked || "M" : product.gender === "W" ? "W" : product.gender === "K" ? "K" : "M");

export default function ManualOrder({ auth, notify }) {
  const navigate = useNavigate();
  const [cust, setCust] = useState({ name: "", email: "", phone: "", cpf: "" });
  const [addr, setAddr] = useState(EMPTY_ADDR);
  const [custQ, setCustQ] = useState("");
  const [custResults, setCustResults] = useState(null);
  const [items, setItems] = useState([]);
  const [channel, setChannel] = useState("whatsapp");
  const [status, setStatus] = useState("paid");
  const [pay, setPay] = useState({ method: "pix", installments: "1", paidAmountBrl: "", paidAt: localNow(), reference: "", receiptUrl: "" });
  const [discount, setDiscount] = useState("");
  const [ship, setShip] = useState({ carrier: "", trackingCode: "", trackingUrl: "" });
  const [note, setNote] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [notifyCustomer, setNotifyCustomer] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [stockProducts, setStockProducts] = useState(null);

  useEffect(() => {
    auth.request("/api/admin/stock?all=1").then((d) => setStockProducts(d.products || [])).catch(() => setStockProducts([]));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // busca de cliente cadastrado (preenche nome/e-mail/telefone/CPF/endereço)
  useEffect(() => {
    const q = custQ.trim();
    if (q.length < 2) { setCustResults(null); return; }
    let alive = true;
    const t = setTimeout(() => {
      auth.request(`/api/admin/customers?q=${encodeURIComponent(q)}&pageSize=8`)
        .then((d) => { if (alive) setCustResults(d.customers || []); })
        .catch(() => { if (alive) setCustResults([]); });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [custQ]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickCustomer = (u) => {
    setCust({ name: u.name || "", email: u.email || "", phone: u.phone || "", cpf: u.cpf || "" });
    if (u.address) setAddr({ ...EMPTY_ADDR, ...u.address });
    setCustQ("");
    setCustResults(null);
  };

  async function buscaCEP() {
    const raw = addr.cep.replace(/\D/g, "");
    if (raw.length !== 8) return;
    try {
      const r = await fetch(`https://viacep.com.br/ws/${raw}/json/`);
      const d = await r.json();
      if (d.erro) return;
      setAddr((s) => ({ ...s, street: d.logradouro || s.street, neighborhood: d.bairro || s.neighborhood, city: d.localidade || s.city, state: d.uf || s.state }));
    } catch { /* preenche na mão */ }
  }

  const subtotal = useMemo(() => round2(items.reduce((a, it) => a + (parseMoney(it.unitPriceBrl) || 0) * (parseInt(it.quantity, 10) || 1), 0)), [items]);
  const cost = useMemo(() => round2(items.reduce((a, it) => a + (parseMoney(it.unitCostBrl) || 0) * (parseInt(it.quantity, 10) || 1), 0)), [items]);
  const discParsed = parseMoney(discount);
  const disc = discParsed == null ? 0 : discParsed; // NaN = digitou algo inválido (barrado no submit)
  const total = round2(Math.max(0, subtotal - (Number.isNaN(disc) ? 0 : disc)));
  const received = pay.paidAmountBrl === "" ? total : parseMoney(pay.paidAmountBrl);
  const margin = round2(total - cost);

  const setItem = (i, k, v) => setItems((s) => s.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const rmItem = (i) => setItems((s) => s.filter((_, j) => j !== i));

  async function submit(e) {
    e?.preventDefault();
    setMsg(null);
    if (!cust.name.trim()) return setMsg({ ok: false, text: "Informe o nome do cliente" });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cust.email.trim())) return setMsg({ ok: false, text: "Informe um e-mail válido — é por ele que o pedido aparece na conta do cliente" });
    if (!items.length) return setMsg({ ok: false, text: "Adicione pelo menos um item" });
    for (const it of items) {
      const p = parseMoney(it.unitPriceBrl);
      if (p == null || Number.isNaN(p) || p < 0) return setMsg({ ok: false, text: `${it.name}: preço unitário inválido` });
      if (it.unitCostBrl !== "" && Number.isNaN(parseMoney(it.unitCostBrl))) return setMsg({ ok: false, text: `${it.name}: custo inválido` });
    }
    if (Number.isNaN(disc) || disc > subtotal) return setMsg({ ok: false, text: "Desconto inválido" });
    if (Number.isNaN(received) || received < 0) return setMsg({ ok: false, text: "Valor recebido inválido" });
    setBusy(true);
    try {
      const body = {
        customer: { name: cust.name.trim(), email: cust.email.trim(), phone: cust.phone || null, cpf: cust.cpf || null },
        address: Object.values(addr).some(Boolean) ? { ...addr, cep: addr.cep.replace(/\D/g, "") } : null,
        channel,
        status,
        items: items.map((it) => ({
          kind: it.kind,
          code: it.code || undefined,
          styleColor: it.styleColor || undefined,
          name: it.name,
          colorDescription: it.colorDescription || null,
          image: it.image || null,
          brLabel: it.br,
          usSize: it.us || null,
          sizeGender: it.gender || null,
          quantity: parseInt(it.quantity, 10) || 1,
          unitPriceBrl: parseMoney(it.unitPriceBrl),
          unitCostBrl: it.unitCostBrl === "" ? null : parseMoney(it.unitCostBrl),
          unitPriceUsd: it.unitPriceUsd ?? null,
          deductStock: it.kind === "stock" ? it.deductStock !== false : undefined
        })),
        discountBrl: disc || null,
        payment: {
          method: pay.method,
          installments: pay.method === "credit_card" ? parseInt(pay.installments, 10) || 1 : null,
          paidAmountBrl: pay.paidAmountBrl === "" ? null : parseMoney(pay.paidAmountBrl),
          paidAt: pay.paidAt ? new Date(pay.paidAt).toISOString() : null,
          reference: pay.reference || null,
          receiptUrl: pay.receiptUrl || null
        },
        shipping: ["shipped", "delivered"].includes(status) ? { carrier: ship.carrier || null, trackingCode: ship.trackingCode || null, trackingUrl: ship.trackingUrl || null } : undefined,
        note: note || null,
        internalNotes: internalNotes || null,
        notifyCustomer
      };
      const o = await auth.request("/api/admin/orders", { method: "POST", body: JSON.stringify(body) });
      notify?.(`Venda ${o.number} registrada`);
      navigate(`/admin/pedidos/${o.number}`, { replace: true });
    } catch (err) {
      setMsg({ ok: false, text: err.message + (err.details?.code === "STOCK_OUT" ? " (ou marque o item como \"não baixar do estoque\")" : "") });
      setBusy(false);
    }
  }

  return (
    <>
      <header className="adm-head">
        <div>
          <div className="sub" style={{ marginTop: 0, marginBottom: 8 }}><Link to="/admin/pedidos">← Pedidos</Link></div>
          <h1>Venda <em>externa</em></h1>
          <div className="sub">Venda feita fora do site (WhatsApp, Instagram, presencial…) · entra como pedido pago · o cliente acompanha em /conta</div>
        </div>
        <div className="actions">
          <button className="btn primary" type="button" onClick={submit} disabled={busy || !items.length}>{busy ? "Registrando…" : "Registrar venda"}</button>
        </div>
      </header>

      {msg && <div className={msg.ok ? "ok" : "err"}>{msg.text}</div>}

      <form onSubmit={submit} className="adm-grid3">
        <div>
          <section className="adm-card">
            <h3>Cliente <small>o e-mail é a chave: o pedido aparece em “Meus pedidos” de quem entrar com ele</small></h3>
            <div className="field" style={{ marginBottom: 12, position: "relative" }}>
              <label>Buscar cliente cadastrado (nome, e-mail, telefone, CPF)</label>
              <input value={custQ} onChange={(e) => setCustQ(e.target.value)} placeholder="digite para buscar… ou preencha abaixo" />
              {custResults && (
                <div className="mo-results">
                  {custResults.length === 0 && <button type="button" disabled>Nenhum cliente encontrado — preencha abaixo (vira convidado; aparece na conta quando ele se cadastrar com o mesmo e-mail)</button>}
                  {custResults.map((u) => (
                    <button type="button" key={u.id} onClick={() => pickCustomer(u)}>
                      <b>{u.name}</b><span>{u.email}{u.phone ? ` · ${u.phone}` : ""}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="form-grid">
              <div className="field"><label>Nome *</label><input value={cust.name} onChange={(e) => setCust({ ...cust, name: e.target.value })} required /></div>
              <div className="field"><label>E-mail *</label><input type="email" value={cust.email} onChange={(e) => setCust({ ...cust, email: e.target.value })} required /></div>
              <div className="field"><label>Telefone / WhatsApp</label><input value={cust.phone} onChange={(e) => setCust({ ...cust, phone: e.target.value })} placeholder="(85) 99999-0000" /></div>
              <div className="field"><label>CPF (opcional)</label><input value={cust.cpf} onChange={(e) => setCust({ ...cust, cpf: e.target.value })} placeholder="000.000.000-00" /></div>
              <div className="field"><label>CEP</label><input value={maskCep(addr.cep)} onChange={(e) => setAddr({ ...addr, cep: e.target.value })} onBlur={buscaCEP} maxLength={9} /></div>
              <div className="field"><label>Endereço</label><input value={addr.street} onChange={(e) => setAddr({ ...addr, street: e.target.value })} /></div>
              <div className="field"><label>Número</label><input value={addr.number} onChange={(e) => setAddr({ ...addr, number: e.target.value })} /></div>
              <div className="field"><label>Complemento</label><input value={addr.complement} onChange={(e) => setAddr({ ...addr, complement: e.target.value })} /></div>
              <div className="field"><label>Bairro</label><input value={addr.neighborhood} onChange={(e) => setAddr({ ...addr, neighborhood: e.target.value })} /></div>
              <div className="field" style={{ display: "grid", gridTemplateColumns: "1fr 64px", gap: 8 }}>
                <div className="field"><label>Cidade</label><input value={addr.city} onChange={(e) => setAddr({ ...addr, city: e.target.value })} /></div>
                <div className="field"><label>UF</label><input value={addr.state} onChange={(e) => setAddr({ ...addr, state: e.target.value.toUpperCase().slice(0, 2) })} maxLength={2} /></div>
              </div>
            </div>
          </section>

          <section className="adm-card">
            <h3>Itens <small>{items.length} linha(s) · {brl(subtotal)}</small></h3>
            {items.length === 0 ? (
              <div className="empty" style={{ padding: 18 }}>Nenhum item ainda — adicione abaixo.</div>
            ) : (
              <div className="items">
                {items.map((it, i) => (
                  <div className="item" key={it.key}>
                    <div className="thumb">{it.image ? <img src={it.image} alt="" /> : null}</div>
                    <div>
                      <b>{it.name}</b>
                      <span>
                        {it.kind === "stock" ? (String(it.code || "").startsWith("HY-") ? "HYPADOS" : "PRONTA ENTREGA") : it.kind === "import" ? "IMPORTADO" : "OUTRO"}{it.code || it.styleColor ? ` · ${it.code || it.styleColor}` : ""} · {previewLabel(it)}{it.colorDescription ? ` · ${it.colorDescription}` : ""}
                      </span>
                      {it.kind === "stock" && (
                        <label className="check" style={{ marginTop: 6, fontSize: 11, color: "var(--muted-2)", display: "flex", gap: 6, alignItems: "center", textTransform: "none", letterSpacing: 0 }}>
                          <input type="checkbox" checked={it.deductStock !== false} onChange={(e) => setItem(i, "deductStock", e.target.checked)} /> baixar do estoque ({it.available} disp.)
                        </label>
                      )}
                    </div>
                    <div className="price" style={{ display: "grid", gridTemplateColumns: "auto auto auto", gap: 6, alignItems: "center" }}>
                      <input className="inline qty" type="number" min={1} max={50} value={it.quantity} onChange={(e) => setItem(i, "quantity", e.target.value)} title="Quantidade" />
                      <input className="inline" value={it.unitPriceBrl} onChange={(e) => setItem(i, "unitPriceBrl", e.target.value)} inputMode="decimal" title="Preço unitário (R$)" placeholder="preço" />
                      <input className="inline" value={it.unitCostBrl} onChange={(e) => setItem(i, "unitCostBrl", e.target.value)} inputMode="decimal" title="Custo unitário (R$, só você vê)" placeholder="custo" />
                      <small style={{ gridColumn: "1 / -1" }}>
                        qtd × preço × custo · {brl((parseMoney(it.unitPriceBrl) || 0) * (parseInt(it.quantity, 10) || 1))}
                        <button type="button" className="btn sm danger" style={{ marginLeft: 10 }} onClick={() => rmItem(i)}>remover</button>
                      </small>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <ItemPicker auth={auth} stockProducts={stockProducts} onAdd={(it) => setItems((s) => [...s, { ...it, key: `${Date.now()}-${Math.random()}` }])} />
          </section>
        </div>

        <div>
          <section className="adm-card">
            <h3>Resumo</h3>
            <dl className="mo-summary">
              <dt>Subtotal</dt><dd>{brl(subtotal)}</dd>
              <dt>Desconto (R$)</dt><dd><input value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="decimal" placeholder="0,00" style={{ width: 110, height: 32, textAlign: "right" }} /></dd>
              <div className="line" />
              <dt>Total da venda</dt><dd className="big">{brl(total)}</dd>
              <dt>Custo estimado</dt><dd>{cost ? brl(cost) : "—"}</dd>
              <dt>Margem estimada</dt><dd style={{ color: cost ? "var(--green)" : "var(--muted)" }}>{cost ? `${brl(margin)} (${total ? Math.round((margin / total) * 100) : 0}%)` : "informe o custo nos itens"}</dd>
            </dl>
          </section>

          <section className="adm-card">
            <h3>Pagamento <small>já recebido</small></h3>
            <div className="form-grid">
              <div className="field"><label>Forma</label>
                <select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>
                  {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{METHOD_LABELS[m]}</option>)}
                </select>
              </div>
              {pay.method === "credit_card" ? (
                <div className="field"><label>Parcelas</label><input type="number" min={1} max={24} value={pay.installments} onChange={(e) => setPay({ ...pay, installments: e.target.value })} /></div>
              ) : <div />}
              <div className="field"><label>Valor recebido (R$)</label><input value={pay.paidAmountBrl} onChange={(e) => setPay({ ...pay, paidAmountBrl: e.target.value })} inputMode="decimal" placeholder={fmtMoneyInput(total) || "= total"} /></div>
              <div className="field"><label>Data do pagamento</label><input type="datetime-local" value={pay.paidAt} onChange={(e) => setPay({ ...pay, paidAt: e.target.value })} max={localNow()} /></div>
              <div className="field"><label>Referência (NSU, ID Pix…)</label><input value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} placeholder="opcional" /></div>
              <div className="field"><label>Link do comprovante</label><input value={pay.receiptUrl} onChange={(e) => setPay({ ...pay, receiptUrl: e.target.value })} placeholder="https://… (opcional)" /></div>
            </div>
            <p className="adm-note" style={{ marginTop: 10, fontSize: 11 }}>Na receita do dashboard entra o <b>valor recebido</b> (ex.: com juros do cartão). Se ficar em branco, usa o total.</p>
          </section>

          <section className="adm-card">
            <h3>Venda</h3>
            <div className="form-grid">
              <div className="field"><label>Canal</label>
                <select value={channel} onChange={(e) => setChannel(e.target.value)}>
                  {EXTERNAL_CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>)}
                </select>
              </div>
              <div className="field"><label>Situação atual</label>
                <select value={status} onChange={(e) => setStatus(e.target.value)}>
                  {INITIAL_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                </select>
              </div>
              {["shipped", "delivered"].includes(status) && (
                <>
                  <div className="field"><label>Transportadora</label>
                    <select value={ship.carrier} onChange={(e) => setShip({ ...ship, carrier: e.target.value })}><option value="">—</option>{CARRIERS.map((c) => <option key={c}>{c}</option>)}</select>
                  </div>
                  <div className="field"><label>Código de rastreio</label><input value={ship.trackingCode} onChange={(e) => setShip({ ...ship, trackingCode: e.target.value.trim() })} placeholder="NL123456789BR" /></div>
                  <div className="field span2"><label>Link de rastreio (opcional)</label><input value={ship.trackingUrl} onChange={(e) => setShip({ ...ship, trackingUrl: e.target.value })} placeholder="https://…" /></div>
                </>
              )}
              <div className="field span2"><label>Observação (vai para o histórico do pedido)</label><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ex.: fechado no WhatsApp em 18/08, entrega em mãos" /></div>
              <div className="field span2"><label>Notas internas (só o painel vê)</label><textarea rows={3} value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} /></div>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13, marginTop: 14 }}>
              <input type="checkbox" checked={notifyCustomer} onChange={(e) => setNotifyCustomer(e.target.checked)} style={{ width: 18, height: 18 }} />
              Avisar o cliente por e-mail (“pedido registrado” + como acompanhar)
            </label>
            <button className="btn primary" type="submit" disabled={busy || !items.length} style={{ marginTop: 16, width: "100%", justifyContent: "center" }}>{busy ? "Registrando…" : `Registrar venda · ${brl(total)}`}</button>
          </section>
        </div>
      </form>
    </>
  );
}

/** Adiciona um item à venda: pronta entrega (estoque), Nike (busca) ou outro (à mão). */
function ItemPicker({ auth, stockProducts, onAdd }) {
  const [tab, setTab] = useState("stock");
  // pronta entrega
  const [stockId, setStockId] = useState("");
  const [stockSize, setStockSize] = useState("");
  const [stockGenderPick, setStockGenderPick] = useState("M");
  // Nike
  const [term, setTerm] = useState("");
  const [found, setFound] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState(null);
  const [nikeSize, setNikeSize] = useState(null); // { br, us, gender }
  const [nikeGroup, setNikeGroup] = useState("M");
  // livre
  const [free, setFree] = useState({ name: "", styleColor: "", colorDescription: "", br: "", us: "", gender: "", image: "" });
  // comum
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [err, setErr] = useState(null);

  const product = useMemo(() => (stockProducts || []).find((p) => p.id === stockId) || null, [stockProducts, stockId]);
  const size = product?.sizes.find((s) => s.br === stockSize) || null;

  useEffect(() => {
    if (!product) return;
    setPrice(fmtMoneyInput(product.priceBrl));
    setCost(product.costBrl != null ? fmtMoneyInput(product.costBrl) : "");
    setStockSize("");
    setStockGenderPick("M");
  }, [product?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function search() {
    const t = term.trim();
    if (!t) return;
    setSearching(true); setSearchErr(null); setFound(null); setNikeSize(null);
    try {
      const r = await auth.request(`/api/admin/catalog/${encodeURIComponent(t)}`);
      const p = r.product;
      setFound(p);
      setNikeGroup(p.sizeGroups?.[0] || "M");
      setPrice(fmtMoneyInput(p.price?.brl));
      const b = p.price?.breakdown || {};
      const est = (Number(b.subtotalBrl) || 0) + (Number(b.importDutyBrl) || 0) + (Number(b.paymentFeeBrl) || 0);
      setCost(est > 0 ? fmtMoneyInput(est) : "");
    } catch (e) {
      setSearchErr(e.message || "Produto não encontrado na Nike — use a aba Outro");
    } finally {
      setSearching(false);
    }
  }

  function add() {
    setErr(null);
    const q = Math.max(1, Math.min(50, parseInt(qty, 10) || 1));
    const base = { quantity: String(q), unitPriceBrl: price, unitCostBrl: cost };
    if (tab === "stock") {
      if (!product) return setErr("Escolha o produto");
      if (!size) return setErr("Escolha o tamanho");
      const gender = stockGender(product, stockGenderPick);
      onAdd({ ...base, kind: "stock", code: product.code, name: product.name, colorDescription: product.colorDescription, image: product.images?.[0] || null, br: size.br, us: stockUs(product, size, gender), gender, available: size.qty, deductStock: true });
      setStockSize("");
    } else if (tab === "import") {
      if (!found) return setErr("Busque o produto pelo SKU ou nome");
      if (!nikeSize) return setErr("Escolha o tamanho");
      onAdd({ ...base, kind: "import", styleColor: found.styleColor, name: found.name, colorDescription: found.colorDescription, image: found.images?.[0] || null, br: nikeSize.br, us: nikeSize.us, gender: nikeSize.gender, unitPriceUsd: found.priceUsd ?? null });
      setNikeSize(null);
    } else {
      if (free.name.trim().length < 2) return setErr("Informe o nome do produto");
      if (!free.br.trim()) return setErr("Informe o tamanho (BR)");
      if (parseMoney(price) == null || Number.isNaN(parseMoney(price))) return setErr("Informe o preço");
      onAdd({ ...base, kind: "manual", styleColor: free.styleColor.trim(), name: free.name.trim(), colorDescription: free.colorDescription.trim() || null, image: free.image.trim() || null, br: free.br.trim(), us: free.us.trim(), gender: free.gender || null });
      setFree({ name: "", styleColor: "", colorDescription: "", br: "", us: "", gender: "", image: "" });
    }
    setQty("1");
  }

  const nikeSizes = found ? (found.sizes || []).filter((s) => !found.sizeGroups || found.sizeGroups.length <= 1 || s.us?.[nikeGroup]) : [];

  return (
    <div className="mo-picker">
      <div className="tabs">
        <button type="button" className={tab === "stock" ? "on" : ""} onClick={() => { setTab("stock"); setErr(null); }}>Pronta entrega</button>
        <button type="button" className={tab === "import" ? "on" : ""} onClick={() => { setTab("import"); setErr(null); }}>Nike (importado)</button>
        <button type="button" className={tab === "manual" ? "on" : ""} onClick={() => { setTab("manual"); setErr(null); setPrice(""); setCost(""); }}>Outro</button>
      </div>

      {tab === "stock" && (
        <>
          {stockProducts && stockProducts.length === 0 && <div className="adm-note" style={{ marginBottom: 10 }}>Nenhum produto de pronta entrega cadastrado — use as abas Nike ou Outro.</div>}
          <div className="form-grid">
            <div className="field span2"><label>Produto</label>
              <select value={stockId} onChange={(e) => setStockId(e.target.value)}>
                <option value="">— escolher —</option>
                {(stockProducts || []).map((p) => <option key={p.id} value={p.id}>{p.sectionLabel ? `[${p.sectionLabel}] ` : ""}{p.name}{p.colorDescription ? ` · ${p.colorDescription}` : ""} · {p.code} · {p.totalQty} par(es){p.active ? "" : " · inativo"}</option>)}
              </select>
            </div>
          </div>
          {product && (
            <>
              <div className="field" style={{ marginTop: 12 }}><label>Tamanho (BR · US da caixa · disponíveis)</label>
                <div className="adm-chips">
                  {product.sizes.map((s) => (
                    <button type="button" key={s.br} className={stockSize === s.br ? "on" : ""} onClick={() => setStockSize(s.br)} title={s.qty ? `${s.qty} disponível(is)` : "sem estoque (pode registrar sem baixar)"}>
                      {s.br}<small>{s.us ? `US ${s.us} · ` : ""}{s.qty}</small>
                    </button>
                  ))}
                  {!product.sizes.length && <span className="adm-note">sem tamanhos cadastrados</span>}
                </div>
              </div>
              {product.gender === "U" && (
                <div className="field" style={{ marginTop: 12 }}><label>Modelagem (como o cliente pediu)</label>
                  <div className="adm-chips">
                    {["M", "W"].map((g) => <button type="button" key={g} className={stockGenderPick === g ? "on" : ""} onClick={() => setStockGenderPick(g)}>{SIZE_GROUP_LABELS[g]}</button>)}
                  </div>
                </div>
              )}
              {size && <div className="adm-note" style={{ marginTop: 10 }}>Vai gravar como <b>{previewLabel({ br: size.br, us: stockUs(product, size, stockGender(product, stockGenderPick)), gender: stockGender(product, stockGenderPick) })}</b>{size.qty <= 0 ? " · sem estoque: o item entra mas desmarque \"baixar do estoque\" (ou ajuste a quantidade no cadastro)" : ""}</div>}
            </>
          )}
        </>
      )}

      {tab === "import" && (
        <>
          <div style={{ display: "flex", gap: 8 }}>
            <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="SKU (ex.: CW2190-300) ou nome do modelo" style={{ flex: 1 }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); search(); } }} />
            <button type="button" className="btn" onClick={search} disabled={searching}>{searching ? "Buscando…" : "Buscar na Nike"}</button>
          </div>
          {searchErr && <div className="err" style={{ marginTop: 10, marginBottom: 0 }}>{searchErr}</div>}
          {found && (
            <>
              <div className="mo-found">
                <div className="thumb">{found.images?.[0] ? <img src={found.images[0]} alt="" /> : null}</div>
                <div>
                  <b>{found.name}</b>
                  <span>{found.styleColor} · {found.colorDescription || ""} · site: {brl(found.price?.brl)}{found.priceUsd ? ` (US$ ${found.priceUsd})` : ""}{found.byYou ? " · BY YOU" : ""}</span>
                </div>
              </div>
              {found.sizeGroups?.length > 1 && (
                <div className="adm-chips" style={{ marginBottom: 10 }}>
                  {found.sizeGroups.map((g) => <button type="button" key={g} className={nikeGroup === g ? "on" : ""} onClick={() => { setNikeGroup(g); setNikeSize(null); }}>{SIZE_GROUP_LABELS[g]}</button>)}
                </div>
              )}
              <div className="field"><label>Tamanho</label>
                <div className="adm-chips">
                  {nikeSizes.map((s) => {
                    const g = s.us?.[nikeGroup] ? nikeGroup : s.scale;
                    const us = s.us?.[g] || s.nikeSize;
                    const on = nikeSize && nikeSize.br === s.brLabel && nikeSize.us === us;
                    return (
                      <button type="button" key={s.nikeSize} className={on ? "on" : ""} onClick={() => setNikeSize({ br: s.brLabel || s.nikeSize, us, gender: g })} title={s.available ? "disponível na Nike" : "esgotado na Nike agora"} style={s.available ? undefined : { opacity: .5 }}>
                        {s.brLabel || "?"}<small>US {us}</small>
                      </button>
                    );
                  })}
                  {!nikeSizes.length && <span className="adm-note">sem tamanhos</span>}
                </div>
              </div>
              {nikeSize && <div className="adm-note" style={{ marginTop: 10 }}>Vai gravar como <b>{previewLabel(nikeSize)}</b> · custo estimado pela fórmula (produto + frete US); ajuste se souber o real.</div>}
            </>
          )}
        </>
      )}

      {tab === "manual" && (
        <div className="form-grid">
          <div className="field span2"><label>Nome do produto *</label><input value={free.name} onChange={(e) => setFree({ ...free, name: e.target.value })} placeholder="Ex.: Air Jordan 1 Low" /></div>
          <div className="field"><label>SKU / código (opcional)</label><input value={free.styleColor} onChange={(e) => setFree({ ...free, styleColor: e.target.value })} /></div>
          <div className="field"><label>Cor (opcional)</label><input value={free.colorDescription} onChange={(e) => setFree({ ...free, colorDescription: e.target.value })} /></div>
          <div className="field"><label>Tamanho BR *</label><input value={free.br} onChange={(e) => setFree({ ...free, br: e.target.value })} placeholder="41" /></div>
          <div className="field"><label>US (opcional)</label><input value={free.us} onChange={(e) => setFree({ ...free, us: e.target.value })} placeholder="9.5" /></div>
          <div className="field"><label>Modelagem</label>
            <select value={free.gender} onChange={(e) => setFree({ ...free, gender: e.target.value })}>{GENDER_OPTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </div>
          <div className="field"><label>Foto (URL, opcional)</label><input value={free.image} onChange={(e) => setFree({ ...free, image: e.target.value })} placeholder="https://…" /></div>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginTop: 14 }}>
        <div className="field" style={{ flex: "0 0 90px" }}><label>Qtd</label><input type="number" min={1} max={50} value={qty} onChange={(e) => setQty(e.target.value)} /></div>
        <div className="field" style={{ flex: "1 1 150px" }}><label>Preço unitário (R$) *</label><input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="1899,00" /></div>
        <div className="field" style={{ flex: "1 1 150px" }}><label>Custo unitário (R$, opcional)</label><input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" placeholder="para a margem" /></div>
        <button type="button" className="btn primary" onClick={add}>+ Adicionar</button>
      </div>
      {err && <div className="err" style={{ marginTop: 10, marginBottom: 0 }}>{err}</div>}
    </div>
  );
}
