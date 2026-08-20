import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ErrorBox, Loading, RolePill, StatusPill, ChannelPill, brl, fmtDate, fmtDateTime, fmtPhone } from "./ui.jsx";

const EMPTY_ADDR = { cep: "", street: "", number: "", complement: "", neighborhood: "", city: "", state: "" };

export default function CustomerDetail({ auth, notify }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [c, setC] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [form, setForm] = useState(null);
  const [resetLink, setResetLink] = useState(null);

  const load = useCallback(async () => {
    try {
      const d = await auth.request(`/api/admin/customers/${id}`);
      setC(d);
      setForm({ name: d.name || "", email: d.email || "", phone: d.phone || "", cpf: d.cpf || "", role: d.role, address: { ...EMPTY_ADDR, ...(d.address || {}) } });
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, [auth, id]);

  useEffect(() => { load(); }, [load]);

  const f = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.value }));
  const fa = (k) => (e) => setForm((s) => ({ ...s, address: { ...s.address, [k]: e.target.value } }));

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const body = {
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone || null,
        cpf: form.cpf || null,
        address: Object.values(form.address).some(Boolean) ? form.address : null
      };
      if (form.role !== c.role) body.role = form.role;
      const d = await auth.request(`/api/admin/customers/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      setC(d);
      setMsg({ ok: true, text: "Cadastro salvo" });
      notify?.("Cadastro salvo");
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function sendReset() {
    if (!window.confirm(`Gerar link de redefinição de senha para ${c.email}? Links anteriores deixam de valer.`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await auth.request(`/api/admin/customers/${id}/password-reset`, { method: "POST" });
      setResetLink(r);
      setMsg({ ok: true, text: r.mailed ? `E-mail de redefinição enviado para ${r.email} (${r.provider})` : `E-mail não configurado (${r.provider}) — copie o link abaixo e mande ao cliente` });
      await load();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!window.confirm("Derrubar todas as sessões deste cliente? Ele terá que entrar de novo.")) return;
    setBusy(true);
    try {
      const r = await auth.request(`/api/admin/customers/${id}/revoke-sessions`, { method: "POST" });
      setMsg({ ok: true, text: `${r.revoked} sessão(ões) revogada(s)` });
      await load();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); notify?.("Link copiado"); } catch { /* sem clipboard */ }
  };

  if (error) return <><header className="adm-head"><h1>Cliente</h1></header><ErrorBox error={error} /><Link className="btn" to="/admin/clientes">← Clientes</Link></>;
  if (!c || !form) return <Loading />;

  const allOrders = [...c.orders, ...c.guestOrders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return (
    <>
      <header className="adm-head">
        <div>
          <div className="sub" style={{ marginTop: 0, marginBottom: 8 }}><Link to="/admin/clientes">← Clientes</Link></div>
          <h1>{c.name}</h1>
          <div className="sub">{c.email} · cadastro {fmtDate(c.createdAt)} · último acesso {c.lastLoginAt ? fmtDateTime(c.lastLoginAt) : "—"} · {c.stats.activeSessions} sessão(ões) ativa(s)</div>
        </div>
        <div className="actions"><RolePill role={c.role} /></div>
      </header>

      {msg && <div className={msg.ok ? "ok" : "err"}>{msg.text}</div>}

      <div className="tiles" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
        <div className="tile"><span className="k">Pedidos pagos</span><span className="v">{c.stats.paidOrders}</span><span className="d">{c.stats.ordersCount} no total (inclui convidado)</span></div>
        <div className="tile accent"><span className="k">Total gasto</span><span className="v">{brl(c.stats.spentBrl)}</span><span className="d">pedidos pagos, sem estornos</span></div>
        <div className="tile"><span className="k">Contato</span><span className="v small">{fmtPhone(c.phone)}</span><span className="d">{c.phone ? <a href={`https://wa.me/55${String(c.phone).replace(/\D/g, "")}`} target="_blank" rel="noreferrer">abrir WhatsApp ↗</a> : "sem telefone"}</span></div>
      </div>

      <div className="adm-grid2">
        <section className="adm-card">
          <h3>Editar cadastro</h3>
          <form className="form-grid" onSubmit={save}>
            <div className="field span2"><label>Nome</label><input value={form.name} onChange={f("name")} required /></div>
            <div className="field span2"><label>E-mail (login)</label><input type="email" value={form.email} onChange={f("email")} required /></div>
            <div className="field"><label>Telefone / WhatsApp</label><input value={form.phone} onChange={f("phone")} placeholder="85999990000" /></div>
            <div className="field"><label>CPF</label><input value={form.cpf} onChange={f("cpf")} placeholder="00000000000" /></div>
            <div className="field"><label>CEP</label><input value={form.address.cep} onChange={fa("cep")} /></div>
            <div className="field"><label>Rua</label><input value={form.address.street} onChange={fa("street")} /></div>
            <div className="field"><label>Número</label><input value={form.address.number} onChange={fa("number")} /></div>
            <div className="field"><label>Complemento</label><input value={form.address.complement} onChange={fa("complement")} /></div>
            <div className="field"><label>Bairro</label><input value={form.address.neighborhood} onChange={fa("neighborhood")} /></div>
            <div className="field"><label>Cidade / UF</label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 64px", gap: 6 }}>
                <input value={form.address.city} onChange={fa("city")} />
                <input value={form.address.state} onChange={(e) => setForm((s) => ({ ...s, address: { ...s.address, state: e.target.value.toUpperCase().slice(0, 2) } }))} maxLength={2} />
              </div>
            </div>
            <div className="field span2"><label>Perfil</label>
              <select value={form.role} onChange={f("role")} disabled={c.id === auth.user.id}>
                <option value="customer">Cliente</option>
                <option value="admin">Admin (acessa este painel)</option>
              </select>
            </div>
            <div className="span2 adm-toolbar" style={{ margin: 0 }}>
              <button className="btn primary" type="submit" disabled={busy}>Salvar</button>
              <button className="btn" type="button" disabled={busy} onClick={sendReset}>Enviar link de redefinição de senha</button>
              <button className="btn danger" type="button" disabled={busy} onClick={revoke}>Derrubar sessões</button>
            </div>
          </form>
          {resetLink && (
            <div className="copy-link">
              <input readOnly value={resetLink.link} onFocus={(e) => e.target.select()} />
              <button className="btn sm" type="button" onClick={() => copy(resetLink.link)}>Copiar</button>
            </div>
          )}
          {c.passwordResets.length > 0 && (
            <div className="adm-note" style={{ marginTop: 12 }}>
              Redefinições recentes: {c.passwordResets.map((r, i) => (
                <span key={i}>{i ? " · " : ""}{fmtDateTime(r.createdAt)} ({r.requestedBy === "admin" ? "painel" : "cliente"}{r.usedAt ? ", usada" : new Date(r.expiresAt) < new Date() ? ", expirou" : ", válida"})</span>
              ))}
            </div>
          )}
        </section>

        <section className="adm-card">
          <h3>Acessos <small>{c.stats.loginsOk} ok · {c.stats.loginsFailed} falha(s)</small></h3>
          <div className="adm-table-wrap" style={{ border: 0 }}>
            <table>
              <thead><tr><th>Quando</th><th>Evento</th><th>IP</th><th>Navegador</th></tr></thead>
              <tbody>
                {(c.accessLog || []).map((a, i) => (
                  <tr key={i}>
                    <td>{fmtDateTime(a.createdAt)}</td>
                    <td>
                      <span className={`pill ${a.ok ? "ok" : "bad"}`}>
                        {a.kind === "register" ? "Cadastro" : a.kind === "reset" ? "Senha redefinida" : a.ok ? "Login" : "Login falhou"}
                      </span>
                      {!a.ok && a.reason && <span className="sub">{a.reason === "invalid_password" ? "senha incorreta" : a.reason === "unknown_email" ? "e-mail desconhecido" : a.reason}</span>}
                    </td>
                    <td><span className="mono">{a.ip || "—"}</span></td>
                    <td className="sub" title={a.userAgent || ""}>{shortUa(a.userAgent)}</td>
                  </tr>
                ))}
                {!(c.accessLog || []).length && <tr><td colSpan={4} className="empty">Nenhum acesso registrado ainda</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section className="adm-card">
          <h3>Pedidos <small>{allOrders.length}</small></h3>
          <div className="adm-table-wrap" style={{ border: 0 }}>
            <table>
              <thead><tr><th>Pedido</th><th>Status</th><th>Rastreio</th><th className="num">Total</th></tr></thead>
              <tbody>
                {allOrders.map((o) => (
                  <tr key={o.number} className="link" onClick={() => navigate(`/admin/pedidos/${o.number}`)}>
                    <td><span className="mono">{o.number}</span><span className="sub">{fmtDateTime(o.createdAt)}{o.guest ? " · convidado" : ""}</span></td>
                    <td><StatusPill status={o.status} />{o.channel && o.channel !== "site" ? <> <ChannelPill channel={o.channel} short /></> : null}</td>
                    <td>{o.trackingCode ? <span className="mono">{o.trackingCode}</span> : "—"}</td>
                    <td className="num">{brl(o.totalBrl)}</td>
                  </tr>
                ))}
                {!allOrders.length && <tr><td colSpan={4} className="empty">Sem pedidos</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}

/** Resume o user-agent em "Chrome · macOS", "Safari · iPhone" etc. */
function shortUa(ua) {
  if (!ua) return "—";
  const b = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "Outro";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${b} · ${os}` : b;
}
