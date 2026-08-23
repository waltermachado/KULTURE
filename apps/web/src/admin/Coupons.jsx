import { useCallback, useEffect, useState } from "react";
import { ErrorBox, Loading, brl, fmtDate } from "./ui.jsx";

/**
 * Cupons de desconto — /admin/cupons.
 * Cadastro simples: código, % (com teto opcional) ou R$ fixo, mínimo de compra, validade, limite de usos.
 * O cliente digita o código na sacola; o uso só conta quando o pedido é pago.
 */
const EMPTY = { id: null, code: "", kind: "percent", value: "", maxDiscountBrl: "", minSubtotalBrl: "", startsAt: "", endsAt: "", maxUses: "", note: "", active: true };
const toForm = (c) => ({
  id: c.id,
  code: c.code,
  kind: c.kind,
  value: String(Number(c.value)),
  maxDiscountBrl: c.maxDiscountBrl != null ? String(Number(c.maxDiscountBrl)) : "",
  minSubtotalBrl: c.minSubtotalBrl != null ? String(Number(c.minSubtotalBrl)) : "",
  startsAt: c.startsAt ? String(c.startsAt).slice(0, 10) : "",
  endsAt: c.endsAt ? String(c.endsAt).slice(0, 10) : "",
  maxUses: c.maxUses != null ? String(c.maxUses) : "",
  note: c.note || "",
  active: c.active
});

function statusOf(c) {
  const now = new Date();
  if (!c.active) return ["pausado", "abandoned"];
  if (c.startsAt && now < new Date(c.startsAt)) return ["agendado", "sourcing"];
  if (c.endsAt && now > new Date(c.endsAt)) return ["expirado", "cancelled"];
  if (c.maxUses != null && c.usedCount >= c.maxUses) return ["esgotado", "cancelled"];
  return ["ativo", "paid"];
}
const discountLabel = (c) =>
  c.kind === "fixed" ? brl(c.value) : `${Number(c.value)}%${c.maxDiscountBrl != null ? ` (até ${brl(c.maxDiscountBrl)})` : ""}`;

export default function Coupons({ auth, notify }) {
  const [list, setList] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);
  const f = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const load = useCallback(async () => {
    try { setList((await auth.request("/api/admin/coupons")).coupons); setError(null); }
    catch (e) { setError(e); }
  }, [auth]);
  useEffect(() => { load(); }, [load]);

  async function save(e) {
    e?.preventDefault?.();
    setBusy(true); setMsg(null);
    try {
      const body = {
        code: form.code, kind: form.kind, value: form.value,
        maxDiscountBrl: form.kind === "percent" && form.maxDiscountBrl !== "" ? form.maxDiscountBrl : null,
        minSubtotalBrl: form.minSubtotalBrl !== "" ? form.minSubtotalBrl : null,
        startsAt: form.startsAt ? `${form.startsAt}T00:00:00-03:00` : null,
        endsAt: form.endsAt ? `${form.endsAt}T23:59:59-03:00` : null,
        maxUses: form.maxUses !== "" ? form.maxUses : null,
        note: form.note || null,
        active: form.active
      };
      if (form.id) await auth.request(`/api/admin/coupons/${form.id}`, { method: "PATCH", body: JSON.stringify(body) });
      else await auth.request("/api/admin/coupons", { method: "POST", body: JSON.stringify(body) });
      setMsg({ ok: true, text: `Cupom ${form.code.toUpperCase().trim()} salvo — já vale na sacola.` });
      notify?.("Cupom salvo");
      setForm(EMPTY);
      await load();
    } catch (err) { setMsg({ ok: false, text: err.message }); } finally { setBusy(false); }
  }
  async function toggle(c) {
    setBusy(true);
    try { await auth.request(`/api/admin/coupons/${c.id}`, { method: "PATCH", body: JSON.stringify({ active: !c.active }) }); await load(); }
    catch (err) { setMsg({ ok: false, text: err.message }); } finally { setBusy(false); }
  }
  async function remove(c) {
    if (!window.confirm(`Remover o cupom ${c.code}? Quem tentar usar vai ver "não encontrado". Pedidos já feitos não mudam.`)) return;
    setBusy(true);
    try { await auth.request(`/api/admin/coupons/${c.id}`, { method: "DELETE" }); await load(); }
    catch (err) { setMsg({ ok: false, text: err.message }); } finally { setBusy(false); }
  }

  return (
    <>
      <header className="adm-head">
        <div>
          <h1>Cu<em>pons</em></h1>
          <div className="sub">{list ? `${list.length} cupom(ns) · ${list.filter((c) => statusOf(c)[0] === "ativo").length} valendo agora` : "—"}</div>
        </div>
      </header>

      <ErrorBox error={error} />
      {msg && <div className={msg.ok ? "ok" : "err"}>{msg.text}</div>}

      <div className="adm-card">
        <h3>{form.id ? `Editando ${form.code}` : "Novo cupom"} <small>o cliente digita o código na sacola</small></h3>
        <form onSubmit={save} className="form-grid cpn-form">
          <div className="field"><label>Código *</label><input value={form.code} onChange={f("code")} placeholder="KULTURE10" maxLength={30} style={{ textTransform: "uppercase" }} required /></div>
          <div className="field"><label>Tipo *</label>
            <select value={form.kind} onChange={f("kind")}>
              <option value="percent">% do subtotal</option>
              <option value="fixed">R$ fixo</option>
            </select>
          </div>
          <div className="field"><label>{form.kind === "percent" ? "Desconto (%) *" : "Desconto (R$) *"}</label><input inputMode="decimal" value={form.value} onChange={f("value")} placeholder={form.kind === "percent" ? "10" : "100"} required /></div>
          {form.kind === "percent" && <div className="field"><label>Teto do desconto (R$)</label><input inputMode="decimal" value={form.maxDiscountBrl} onChange={f("maxDiscountBrl")} placeholder="sem teto" /></div>}
          <div className="field"><label>Mínimo de compra (R$)</label><input inputMode="decimal" value={form.minSubtotalBrl} onChange={f("minSubtotalBrl")} placeholder="sem mínimo" /></div>
          <div className="field"><label>Vale a partir de</label><input type="date" value={form.startsAt} onChange={f("startsAt")} /></div>
          <div className="field"><label>Vale até</label><input type="date" value={form.endsAt} onChange={f("endsAt")} /></div>
          <div className="field"><label>Limite de usos</label><input inputMode="numeric" value={form.maxUses} onChange={f("maxUses")} placeholder="sem limite" /></div>
          <div className="field span2"><label>Observação (só o painel vê)</label><input value={form.note} onChange={f("note")} placeholder="Ex.: campanha do Instagram de setembro" maxLength={300} /></div>
          <label className="cpn-active"><input type="checkbox" checked={form.active} onChange={f("active")} /> Ativo</label>
          <div className="adm-toolbar span2" style={{ margin: 0 }}>
            <button className="btn primary" type="submit" disabled={busy}>{busy ? "Salvando…" : form.id ? "Salvar alterações" : "Criar cupom"}</button>
            {form.id && <button className="btn" type="button" onClick={() => setForm(EMPTY)}>Cancelar edição</button>}
          </div>
        </form>
        <p className="adm-note" style={{ marginTop: 10 }}>O uso só conta quando o pedido é <b>pago</b> — checkout abandonado não gasta o cupom. O desconto nunca passa do subtotal.</p>
      </div>

      <div className="adm-card" style={{ marginTop: 16 }}>
        <h3>Cupons</h3>
        {!list ? <Loading /> : list.length === 0 ? <p className="sub">Nenhum cupom ainda — crie o primeiro acima.</p> : (
          <table>
            <thead><tr><th>Código</th><th>Desconto</th><th>Mínimo</th><th>Validade</th><th className="num">Usos</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {list.map((c) => {
                const [label, cls] = statusOf(c);
                return (
                  <tr key={c.id}>
                    <td><span className="mono" style={{ fontSize: 14 }}>{c.code}</span>{c.note && <span className="sub">{c.note}</span>}</td>
                    <td>{discountLabel(c)}</td>
                    <td>{c.minSubtotalBrl != null ? brl(c.minSubtotalBrl) : "—"}</td>
                    <td>{c.startsAt || c.endsAt ? `${c.startsAt ? fmtDate(c.startsAt) : "…"} → ${c.endsAt ? fmtDate(c.endsAt) : "…"}` : "sempre"}</td>
                    <td className="num">{c.usedCount}{c.maxUses != null ? ` / ${c.maxUses}` : ""}</td>
                    <td><span className={`pill ${cls}`}>{label}</span></td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button className="btn sm" type="button" onClick={() => { setForm(toForm(c)); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Editar</button>
                      <button className="btn sm" type="button" style={{ marginLeft: 6 }} disabled={busy} onClick={() => toggle(c)}>{c.active ? "Pausar" : "Ativar"}</button>
                      <button className="btn sm danger" type="button" style={{ marginLeft: 6 }} disabled={busy} onClick={() => remove(c)}>Remover</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
