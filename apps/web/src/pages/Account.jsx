import { useEffect, useState } from "react";
import PasswordInput from "../components/PasswordInput.jsx";
import { useNavigate } from "react-router-dom";
import { brl } from "../lib/format.js";
import { StatusPill, fmtDateTime, fmtCpf, fmtPhone } from "../admin/ui.jsx";
import { customText, sizeText } from "../lib/format.js";

const EMPTY_ADDR = { cep: "", street: "", number: "", complement: "", neighborhood: "", city: "", state: "" };

function maskCep(v) {
  const d = String(v || "").replace(/\D/g, "").slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

/**
 * Minha conta: editar cadastro, trocar senha e acompanhar pedidos (com rastreio).
 */
export default function Account({ auth, onOpenLogin, notify }) {
  const navigate = useNavigate();
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState(null);
  const [pw, setPw] = useState({ current: "", next: "", again: "" });
  const [pwMsg, setPwMsg] = useState(null);
  const [orders, setOrders] = useState(null);
  const [ordersErr, setOrdersErr] = useState(null);

  useEffect(() => {
    if (!auth.user) return;
    setForm({
      name: auth.user.name || "",
      phone: auth.user.phone || "",
      marketingOptIn: auth.user.marketingOptIn !== false,
      cpf: auth.user.cpf || "",
      address: { ...EMPTY_ADDR, ...(auth.user.address || {}) }
    });
  }, [auth.user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!auth.user) return;
    auth.request("/api/orders/mine").then((d) => setOrders(d.orders)).catch((e) => setOrdersErr(e));
  }, [auth.user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (auth.loading) return <main className="account"><p className="lead">Carregando…</p></main>;
  if (!auth.user) {
    return (
      <main className="account">
        <h2>Minha <em>conta</em></h2>
        <p className="lead">Entre para ver seus pedidos e editar seu cadastro.</p>
        <button className="btn-full" style={{ maxWidth: 320 }} onClick={onOpenLogin}>Entrar</button>
      </main>
    );
  }
  if (!form) return null;

  const f = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.value }));
  const fa = (k) => (e) => setForm((s) => ({ ...s, address: { ...s.address, [k]: e.target.value } }));

  async function buscaCEP() {
    const raw = form.address.cep.replace(/\D/g, "");
    if (raw.length !== 8) return;
    try {
      const r = await fetch(`https://viacep.com.br/ws/${raw}/json/`);
      const d = await r.json();
      if (d.erro) return;
      setForm((s) => ({ ...s, address: { ...s.address, street: d.logradouro || s.address.street, neighborhood: d.bairro || s.address.neighborhood, city: d.localidade || s.address.city, state: d.uf || s.address.state } }));
    } catch { /* preenche na mão */ }
  }

  async function saveProfile(e) {
    e.preventDefault();
    setSaving(true);
    setProfileMsg(null);
    try {
      await auth.updateProfile({
        name: form.name.trim(),
        marketingOptIn: Boolean(form.marketingOptIn),
        phone: form.phone || null,
        cpf: form.cpf || null,
        address: Object.values(form.address).some(Boolean) ? { ...form.address, cep: form.address.cep.replace(/\D/g, "") } : null
      });
      setProfileMsg({ ok: true, text: "Cadastro atualizado ✓" });
      notify?.("Cadastro atualizado");
    } catch (err) {
      setProfileMsg({ ok: false, text: err.message });
    } finally {
      setSaving(false);
    }
  }

  async function savePassword(e) {
    e.preventDefault();
    setPwMsg(null);
    if (pw.next.length < 8) return setPwMsg({ ok: false, text: "A nova senha precisa ter 8+ caracteres" });
    if (pw.next !== pw.again) return setPwMsg({ ok: false, text: "As senhas não coincidem" });
    setSaving(true);
    try {
      await auth.changePassword(pw.current, pw.next);
      setPw({ current: "", next: "", again: "" });
      setPwMsg({ ok: true, text: "Senha alterada ✓" });
    } catch (err) {
      setPwMsg({ ok: false, text: err.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="account">
      <h2>Olá, <em>{auth.user.name.split(" ")[0]}</em></h2>
      <p className="lead">{auth.user.email} · {auth.isAdmin && <a href="/admin" onClick={(e) => { e.preventDefault(); navigate("/admin"); }}>ir para o backoffice →</a>}</p>

      <div className="account-grid">
        <div>
          <section className="panel">
            <h3>Meus pedidos</h3>
            {ordersErr && <p className="msg err">{ordersErr.message}</p>}
            {!orders && !ordersErr && <p className="msg">Carregando…</p>}
            {orders && !orders.length && <p className="msg">Você ainda não fez pedidos. <a href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }}>Ver drops →</a></p>}
            {orders && orders.length > 0 && (
              <div className="orders-list">
                {orders.map((o) => (
                  <article className="order-card" key={o.number}>
                    <div>
                      <div className="num">{o.number} <StatusPill status={o.status} /></div>
                      <div className="when">{fmtDateTime(o.createdAt)}{o.paidAt ? ` · pago ${fmtDateTime(o.paidAt)}` : ""}</div>
                    </div>
                    <div className="total">{brl(o.totalBrl)}</div>
                    <div className="items">
                      {o.items.map((it, i) => <div key={i}>{it.quantity}× {it.name} — {sizeText(it)}{it.customization ? <span style={{ color: "var(--muted)" }}> · By You{customText(it.customization) ? `: ${customText(it.customization)}` : ""}</span> : null}</div>)}
                    </div>
                    {(o.trackingCode || o.status === "shipped" || o.status === "delivered") && (
                      <div className="track">
                        <span>{o.carrier || "Transportadora"}: <b>{o.trackingCode || "código em breve"}</b></span>
                        {o.trackingUrl && <a href={o.trackingUrl} target="_blank" rel="noreferrer">Rastrear ↗</a>}
                        {o.deliveredAt && <span>Entregue em {fmtDateTime(o.deliveredAt)}</span>}
                      </div>
                    )}
                    {o.status === "pending_payment" && o.receiptUrl == null && (
                      <div className="track"><span>Pagamento pendente.</span></div>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>

        <div>
          <section className="panel">
            <h3>Meu cadastro</h3>
            <form onSubmit={saveProfile}>
              <div className="field"><label>Nome completo</label><input value={form.name} onChange={f("name")} required /></div>
              <div className="row">
                <div className="field"><label>Telefone / WhatsApp</label><input value={form.phone} onChange={f("phone")} placeholder="(85) 99999-0000" /></div>
                <div className="field"><label>CPF</label><input value={form.cpf} onChange={f("cpf")} placeholder="000.000.000-00" /></div>
              </div>
              <div className="row">
                <div className="field"><label>CEP</label><input value={maskCep(form.address.cep)} onChange={(e) => setForm((s) => ({ ...s, address: { ...s.address, cep: e.target.value } }))} onBlur={buscaCEP} maxLength={9} /></div>
                <div className="field f2"><label>Endereço</label><input value={form.address.street} onChange={fa("street")} /></div>
              </div>
              <div className="row">
                <div className="field"><label>Número</label><input value={form.address.number} onChange={fa("number")} /></div>
                <div className="field f2"><label>Complemento</label><input value={form.address.complement} onChange={fa("complement")} /></div>
              </div>
              <div className="row">
                <div className="field"><label>Bairro</label><input value={form.address.neighborhood} onChange={fa("neighborhood")} /></div>
                <div className="field"><label>Cidade</label><input value={form.address.city} onChange={fa("city")} /></div>
                <div className="field f04"><label>UF</label><input value={form.address.state} onChange={(e) => setForm((s) => ({ ...s, address: { ...s.address, state: e.target.value.toUpperCase().slice(0, 2) } }))} maxLength={2} /></div>
              </div>
              <label className="opt-in">
                <input type="checkbox" checked={Boolean(form.marketingOptIn)} onChange={(e) => setForm((s) => ({ ...s, marketingOptIn: e.target.checked }))} />
                <span>Quero receber novidades, drops e promoções por e-mail <small>(e-mails sobre os seus pedidos chegam sempre)</small></span>
              </label>
              <button className="btn-full" type="submit" disabled={saving}>{saving ? "Salvando…" : "Salvar cadastro"}</button>
              {profileMsg && <p className={`msg ${profileMsg.ok ? "ok" : "err"}`}>{profileMsg.text}</p>}
            </form>
            <p className="msg" style={{ marginTop: 14 }}>Cadastro atual: {fmtCpf(auth.user.cpf)} · {fmtPhone(auth.user.phone)}</p>
          </section>

          <section className="panel" style={{ marginTop: 20 }}>
            <h3>Trocar senha</h3>
            <form onSubmit={savePassword}>
              <PasswordInput label="Senha atual" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required autoComplete="current-password" />
              <div className="row">
                <PasswordInput label="Nova senha" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} placeholder="mínimo 8 caracteres" required autoComplete="new-password" />
                <PasswordInput label="Repetir" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} required autoComplete="new-password" />
              </div>
              <button className="btn-full" type="submit" disabled={saving}>Alterar senha</button>
              {pwMsg && <p className={`msg ${pwMsg.ok ? "ok" : "err"}`}>{pwMsg.text}</p>}
            </form>
          </section>
        </div>
      </div>
    </main>
  );
}
