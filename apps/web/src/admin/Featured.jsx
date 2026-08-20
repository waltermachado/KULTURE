import { useCallback, useEffect, useMemo, useState } from "react";
import { ErrorBox, Loading, brl } from "./ui.jsx";

/**
 * Vitrine — escolhe o tênis exibido no HERO de cada seção (Importados / Pronta entrega / Hypados),
 * geral ("Início") e por categoria (Basquete / Casual / Corrida). GET/PUT /api/admin/featured.
 *
 *  - Importados: informe o SKU da Nike (ex.: IO3415-100) e clique em Buscar — valida e mostra a prévia;
 *  - Pronta entrega / Hypados: escolha um produto cadastrado NA MESMA seção;
 *  - slot vazio = automático (o site destaca o 1º produto da lista, como sempre);
 *  - categoria sem destaque próprio cai no destaque "Início" da seção.
 */
const SECTIONS = [
  { key: "import", label: "Importados", hint: "SKU da Nike US" },
  { key: "stock", label: "Pronta entrega", hint: "produto cadastrado (PE-…)" },
  { key: "hypados", label: "Hypados", hint: "produto cadastrado (HY-…)" }
];
const CATS = [
  { key: "default", label: "Início (geral)" },
  { key: "basketball", label: "Basquete" },
  { key: "lifestyle", label: "Casual" },
  { key: "running", label: "Corrida" }
];

export default function Featured({ auth, notify }) {
  const [slots, setSlots] = useState(null);      // { "import:default": { ref, name, image } | undefined }
  const [resolved, setResolved] = useState({});  // prévias do servidor
  const [stockProducts, setStockProducts] = useState({ stock: [], hypados: [] });
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [skuBusy, setSkuBusy] = useState(null);  // slot buscando SKU na Nike

  const load = useCallback(async () => {
    try {
      const [f, st, hy] = await Promise.all([
        auth.request("/api/admin/featured"),
        auth.request("/api/admin/stock?section=stock"),
        auth.request("/api/admin/stock?section=hypados")
      ]);
      setSlots(f.slots || {});
      setResolved(f.resolved || {});
      setStockProducts({ stock: st.products || [], hypados: hy.products || [] });
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, [auth]);

  useEffect(() => { load(); }, [load]);

  const setSlot = (key, val) => {
    setSlots((s) => ({ ...s, [key]: val }));
    setDirty(true);
  };

  /** Importados: valida o SKU na Nike e guarda nome/foto para a prévia. */
  async function lookupSku(key, ref) {
    const term = String(ref || "").trim().toUpperCase();
    if (!term) { setSlot(key, null); return; }
    setSkuBusy(key);
    setMsg(null);
    try {
      const r = await auth.request(`/api/admin/catalog/${encodeURIComponent(term)}`);
      const p = r.product;
      setSlot(key, { ref: p.styleColor || term, name: p.name, image: p.images?.[0] || null });
      setResolved((x) => ({ ...x, [key]: { ok: true, name: p.name, image: p.images?.[0] || null, priceBrl: p.price?.brl ?? null, colorDescription: p.colorDescription } }));
    } catch (e) {
      setMsg({ ok: false, text: `SKU ${term}: ${e.message}` });
    } finally {
      setSkuBusy(null);
    }
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const body = {};
      for (const sec of SECTIONS) for (const cat of CATS) {
        const key = `${sec.key}:${cat.key}`;
        body[key] = slots[key]?.ref ? slots[key] : null;
      }
      await auth.request("/api/admin/featured", { method: "PUT", body: JSON.stringify({ slots: body }) });
      setDirty(false);
      setMsg({ ok: true, text: "Vitrine salva — o site já mostra os novos destaques" });
      notify?.("Vitrine salva");
      await load();
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  const products = useMemo(() => stockProducts, [stockProducts]);

  if (error) return <><header className="adm-head"><h1>Vitrine</h1></header><ErrorBox error={error} /></>;
  if (!slots) return <Loading />;

  return (
    <>
      <header className="adm-head">
        <div>
          <h1>Vitrine <em>· destaque do hero</em></h1>
          <div className="sub">O tênis grande do topo de cada seção · por categoria · vazio = automático (1º da lista)</div>
        </div>
        <div className="actions">
          <button className="btn primary" disabled={busy || !dirty} onClick={save}>{busy ? "Salvando…" : "Salvar vitrine"}</button>
        </div>
      </header>

      {msg && <div className={msg.ok ? "ok" : "err"}>{msg.text}</div>}

      {SECTIONS.map((sec) => (
        <section className="adm-card" key={sec.key}>
          <h3>{sec.label} <small>{sec.hint} · categoria sem destaque cai no "Início"</small></h3>
          <div className="ftd-grid">
            {CATS.map((cat) => {
              const key = `${sec.key}:${cat.key}`;
              const slot = slots[key];
              const prev = resolved[key];
              return (
                <div className="ftd-slot" key={key}>
                  <div className="ftd-head">
                    <b>{cat.label}</b>
                    {slot?.ref && <button type="button" className="ftd-clear" title="Voltar para automático" onClick={() => setSlot(key, null)}>limpar ✕</button>}
                  </div>
                  <div className="ftd-preview">
                    <div className="ftd-thumb">
                      {(prev?.image || slot?.image) ? <img src={prev?.image || slot?.image} alt="" /> : <span>auto</span>}
                    </div>
                    <div className="ftd-info">
                      {slot?.ref ? (
                        <>
                          <b>{prev?.name || slot?.name || slot.ref}</b>
                          <span className="mono">{slot.ref}</span>
                          {prev?.priceBrl != null && <span>{brl(prev.priceBrl)}</span>}
                          {prev && prev.ok === false && <span className="ftd-warn">⚠️ não encontrado agora — o site usa o automático</span>}
                        </>
                      ) : (
                        <span className="ftd-auto">automático — 1º produto da lista</span>
                      )}
                    </div>
                  </div>
                  {sec.key === "import" ? (
                    <form className="ftd-pick" onSubmit={(e) => { e.preventDefault(); lookupSku(key, e.currentTarget.elements[`sku-${key}`].value); }}>
                      <input name={`sku-${key}`} defaultValue={slot?.ref || ""} placeholder="SKU Nike (ex.: IO3415-100)" />
                      <button type="submit" className="btn sm" disabled={skuBusy === key}>{skuBusy === key ? "…" : "Buscar"}</button>
                    </form>
                  ) : (
                    <select
                      className="ftd-pick"
                      value={slot?.ref || ""}
                      onChange={(e) => {
                        const code = e.target.value;
                        if (!code) { setSlot(key, null); return; }
                        const p = products[sec.key].find((x) => x.code === code);
                        setSlot(key, { ref: code, name: p?.name || null, image: p?.images?.[0] || null });
                        setResolved((x) => ({ ...x, [key]: p ? { ok: p.active, name: p.name, image: p.images?.[0] || null, priceBrl: p.priceBrl } : undefined }));
                      }}
                    >
                      <option value="">— automático —</option>
                      {products[sec.key].map((p) => (
                        <option key={p.code} value={p.code}>{p.name}{p.colorDescription ? ` · ${p.colorDescription}` : ""} · {p.code}{p.active ? "" : " · inativo"}</option>
                      ))}
                    </select>
                  )}
                </div>
              );
            })}
          </div>
          {sec.key !== "import" && !products[sec.key].length && (
            <p className="adm-note" style={{ marginTop: 10 }}>Nenhum produto cadastrado nesta seção ainda — cadastre em {sec.key === "hypados" ? "Hypados" : "Pronta entrega"} primeiro.</p>
          )}
        </section>
      ))}

      <p className="sub" style={{ marginTop: 4, fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>
        Produto desativado/esgotado na Nike não derruba a página: o site volta ao automático sozinho até você trocar aqui.
      </p>
    </>
  );
}
