import { useCallback, useEffect, useState } from "react";
import { ErrorBox, Loading, brl } from "./ui.jsx";

/**
 * Preços — acréscimos por tipo de tênis (/admin/precos).
 * A fórmula base (dólar turismo, +7%, frete US$ 65, comissão 30%, ↑…99) vale para todos os importados;
 * aqui o dono soma um valor extra (R$ e/ou %) em modelos específicos — ex.: "LeBron 23 → +R$ 300".
 * Salvou → vale na hora (o cache do catálogo é recalculado). GET/PUT /api/admin/pricing · GET /api/admin/pricing/test?q=
 */
const NEW_RULE = () => ({ id: null, name: "", scope: "model", terms: "", extraFixedBrl: "", extraPct: "", active: true });
const fromApi = (r) => ({
  id: r.id,
  name: r.name,
  scope: r.scope,
  terms: Array.isArray(r.terms) ? r.terms.join(", ") : String(r.terms || ""),
  extraFixedBrl: r.extraFixedBrl ? String(r.extraFixedBrl) : "",
  extraPct: r.extraRate ? String(Math.round(r.extraRate * 10000) / 100) : "",
  active: r.active !== false
});
const pct = (rate) => `${Math.round(rate * 10000) / 100}%`;

export default function Pricing({ auth, notify }) {
  const [data, setData] = useState(null);     // { base, scopes, categories, version }
  const [rules, setRules] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const [test, setTest] = useState(null);     // { loading, result, error }

  const load = useCallback(async () => {
    try {
      const d = await auth.request("/api/admin/pricing");
      setData(d);
      setRules((d.rules || []).map(fromApi));
      setDirty(false);
      setError(null);
    } catch (e) { setError(e); }
  }, [auth]);
  useEffect(() => { load(); }, [load]);

  const update = (i, patch) => { setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r))); setDirty(true); };
  const remove = (i) => { setRules((rs) => rs.filter((_, j) => j !== i)); setDirty(true); };
  const add = () => { setRules((rs) => [...rs, NEW_RULE()]); setDirty(true); };

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const payload = rules.map((r) => ({
        id: r.id || null, name: r.name.trim(), scope: r.scope, terms: r.terms, active: r.active,
        extraFixedBrl: r.extraFixedBrl === "" ? null : r.extraFixedBrl,
        extraPct: r.extraPct === "" ? null : r.extraPct
      }));
      const d = await auth.request("/api/admin/pricing", { method: "PUT", body: JSON.stringify({ rules: payload }) });
      setData(d); setRules((d.rules || []).map(fromApi)); setDirty(false);
      setMsg({ ok: true, text: `Salvo. ${d.rules.length} regra(s) — já valem para quem abrir o site agora.` });
      notify?.("Acréscimos salvos");
      if (q.trim()) runTest(q);
    } catch (e) { setMsg({ ok: false, text: e.message }); } finally { setBusy(false); }
  }

  async function runTest(term) {
    const t = String(term || "").trim();
    if (t.length < 2) return;
    setTest({ loading: true });
    try {
      const r = await auth.request(`/api/admin/pricing/test?q=${encodeURIComponent(t)}`);
      setTest({ result: r });
    } catch (e) { setTest({ error: e.message }); }
  }

  if (!rules) return <><header className="adm-head"><div><h1>Pre<em>ços</em></h1></div></header><ErrorBox error={error} />{!error && <Loading />}</>;
  const base = data?.base || {};
  const scopes = data?.scopes || {};
  const categories = data?.categories || {};

  return (
    <>
      <header className="adm-head">
        <div>
          <h1>Pre<em>ços</em></h1>
          <div className="sub">Acréscimos por tipo de tênis · {rules.filter((r) => r.active).length} ativa(s){dirty ? " · alterações não salvas" : ""}</div>
        </div>
        <div className="actions">
          <button className="btn" type="button" onClick={add} disabled={busy}>+ Nova regra</button>
          <button className="btn primary" type="button" onClick={save} disabled={busy || !dirty}>{busy ? "Salvando…" : "Salvar"}</button>
        </div>
      </header>

      <ErrorBox error={error} />
      {msg && <div className={msg.ok ? "ok" : "err"}>{msg.text}</div>}

      <div className="adm-card">
        <h3>Como o preço é formado <small>vale para todos os importados</small></h3>
        <p className="prc-formula">
          <span>preço na Nike (US$) <b>+{pct(base.productSurchargeRate || 0)}</b></span>
          <span>+ frete <b>US$ {base.shippingUsd}</b></span>
          <span>× <b>dólar turismo</b></span>
          <span>+ comissão <b>{pct(base.commissionRate || 0)}</b></span>
          <span className="hl">+ acréscimos abaixo</span>
          <span>→ arredonda pra cima até <b>…{base.roundUpToEnding}</b></span>
        </p>
        <p className="adm-note">Os acréscimos entram depois da comissão (são margem pura do modelo). Pronta entrega e hypados não usam a fórmula: o preço é o digitado no cadastro.</p>
      </div>

      <div className="adm-card" style={{ marginTop: 16 }}>
        <h3>Acréscimos <small>ex.: LeBron 23 → +R$ 300</small></h3>
        {rules.length === 0 ? (
          <p className="sub" style={{ marginBottom: 12 }}>Nenhum acréscimo — todos os importados saem pela fórmula base. Clique em “+ Nova regra”.</p>
        ) : (
          <div className="prc-rules">
            {rules.map((r, i) => (
              <div className={`prc-rule${r.active ? "" : " off"}`} key={r.id || `new-${i}`}>
                <label className="prc-toggle" title={r.active ? "Ativa — clique para pausar" : "Pausada — clique para ativar"}>
                  <input type="checkbox" checked={r.active} onChange={(e) => update(i, { active: e.target.checked })} />
                  <span>{r.active ? "Ativa" : "Pausada"}</span>
                </label>
                <div className="field"><label>Nome da regra</label><input value={r.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="LeBron 23" maxLength={80} /></div>
                <div className="field">
                  <label>Onde aplicar</label>
                  <select value={r.scope} onChange={(e) => update(i, { scope: e.target.value, terms: e.target.value === "category" ? "basketball" : r.scope === "category" ? "" : r.terms })}>
                    {Object.entries(scopes).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                  </select>
                </div>
                <div className="field prc-terms">
                  <label>{r.scope === "model" ? "Termos (separe por vírgula — basta um bater)" : r.scope === "sku" ? "SKUs (separe por vírgula)" : r.scope === "brand" ? "Marcas (separe por vírgula)" : "Categoria"}</label>
                  {r.scope === "category" ? (
                    <select value={r.terms} onChange={(e) => update(i, { terms: e.target.value })}>
                      {Object.entries(categories).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                    </select>
                  ) : (
                    <input value={r.terms} onChange={(e) => update(i, { terms: e.target.value })} placeholder={r.scope === "model" ? "LeBron XXIII, LeBron 23" : r.scope === "sku" ? "HQ3417-100, HQ3417-001" : "Jordan"} />
                  )}
                </div>
                <div className="field prc-num"><label>+ R$</label><input inputMode="decimal" value={r.extraFixedBrl} onChange={(e) => update(i, { extraFixedBrl: e.target.value })} placeholder="300" /></div>
                <div className="field prc-num"><label>+ %</label><input inputMode="decimal" value={r.extraPct} onChange={(e) => update(i, { extraPct: e.target.value })} placeholder="0" /></div>
                <button className="btn sm danger prc-del" type="button" onClick={() => remove(i)} title="Remover regra">Remover</button>
              </div>
            ))}
          </div>
        )}
        <div className="adm-toolbar" style={{ margin: "14px 0 0" }}>
          <button className="btn" type="button" onClick={add} disabled={busy}>+ Nova regra</button>
          <button className="btn primary" type="button" onClick={save} disabled={busy || !dirty}>{busy ? "Salvando…" : "Salvar"}</button>
        </div>
        <p className="adm-note" style={{ marginTop: 10 }}>
          “Nome do tênis contém” ignora maiúsculas e acentos: <i>lebron 23</i> pega “Nike LeBron XXIII …”. Se mais de uma regra bater no mesmo par, os
          acréscimos somam. Como a fórmula arredonda pra cima até …99, use múltiplos de 100 (R$ 300) para o preço continuar terminando em 99.
        </p>
      </div>

      <div className="adm-card" style={{ marginTop: 16 }}>
        <h3>Testar com um tênis <small>busca ao vivo na Nike com as regras salvas</small></h3>
        <form className="adm-toolbar" style={{ margin: 0 }} onSubmit={(e) => { e.preventDefault(); runTest(q); }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ex.: LeBron 23, Kobe 6, Jordan 1" style={{ flex: 1, minWidth: 220 }} />
          <button className="btn" type="submit" disabled={test?.loading || q.trim().length < 2}>{test?.loading ? "Buscando…" : "Testar"}</button>
        </form>
        {dirty && <p className="adm-note" style={{ marginTop: 8 }}>O teste usa as regras <b>salvas</b> — salve antes para ver o efeito da alteração.</p>}
        {test?.error && <div className="err" style={{ marginTop: 12 }}>{test.error}</div>}
        {test?.result && (
          test.result.products.length === 0 ? <p className="sub" style={{ marginTop: 12 }}>Nada encontrado para “{test.result.q}”.</p> : (
            <table style={{ marginTop: 12 }}>
              <thead><tr><th>Tênis</th><th>SKU</th><th className="num">Nike (US$)</th><th className="num">Preço no site</th><th>Acréscimo</th></tr></thead>
              <tbody>
                {test.result.products.map((p) => (
                  <tr key={p.styleColor}>
                    <td>{p.name}<span className="sub">{p.brand}{p.category ? ` · ${categories[p.category] || p.category}` : ""}</span></td>
                    <td className="mono">{p.styleColor}</td>
                    <td className="num">{p.priceUsd != null ? `$${p.priceUsd}` : "—"}</td>
                    <td className="num"><b>{brl(p.priceBrl)}</b></td>
                    <td>
                      {p.matched.length ? (
                        <span className="pill paid">{[p.extraFixedBrl ? `+${brl(p.extraFixedBrl)}` : null, p.extraRate ? `+${pct(p.extraRate)}` : null].filter(Boolean).join(" ")} · {p.matched.join(", ")}</span>
                      ) : <span className="pill">sem acréscimo</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>
    </>
  );
}
