import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ErrorBox, Loading, brl } from "./ui.jsx";

/**
 * Cadastro/edição de produto de pronta entrega.
 *  - /admin/estoque/novo → POST /api/admin/stock, depois abre a edição (fotos por upload só depois de salvar)
 *  - /admin/estoque/:id  → PATCH /api/admin/stock/:id
 * Fotos: upload redimensionado no navegador (máx. 1400px, WebP) → POST /api/admin/stock/:id/images (vai para o
 * banco, servido em /media/estoque/:id) ou URL externa colada. A primeira foto é a capa do card.
 */
/** Mesmas 3 categorias das abas da loja (chave = a do catálogo Nike; rótulo em PT) */
export const CATEGORIES = [
  { key: "basketball", label: "Basquete" },
  { key: "lifestyle", label: "Casual" },
  { key: "running", label: "Corrida" }
];

/** Modelagem do par (o US da caixa é lido nessa escala). U = unissex: digite o US masculino da caixa (o feminino é +1,5). */
export const GENDERS = [
  { key: "M", label: "Masculino", us: "US masc." },
  { key: "W", label: "Feminino", us: "US fem." },
  { key: "U", label: "Unissex", us: "US masc. da caixa (fem. = +1,5)" },
  { key: "K", label: "Infantil (GS)", us: "US infantil (ex.: 5Y)" }
];

const EMPTY = {
  name: "", brand: "Nike", category: "", gender: "M", colorDescription: "", styleColor: "", badge: "", description: "",
  priceBrl: "", fullPriceBrl: "", costBrl: "", active: true, sortOrder: 0, images: [], sizes: []
};
// Tabela oficial Nike BR (mesma do packages/shared/src/sizes): BR → US, por modelagem — preenche o US ao clicar no BR
const US_BY_BR_MEN = { "34": "3.5", "34.5": "4", "35": "4.5", "35.5": "5", "36": "5.5", "37": "6", "37.5": "6.5", "38": "7", "39": "7.5", "39.5": "8", "40": "8.5", "40.5": "9", "41": "9.5", "42": "10", "42.5": "10.5", "43": "11", "43.5": "11.5", "44": "12", "45": "12.5", "46": "13", "46.5": "13.5", "47": "14", "48": "15" };
// feminino DERIVADO do masculino (W = M + 1,5; mesmo par físico → mesmo BR) — decisão de 23/08
const US_BY_BR_WOMEN = Object.fromEntries(Object.entries(US_BY_BR_MEN).map(([br, us]) => [br, String(Number(us) + 1.5)]));
const US_BY_BR_KIDS = { "31": "1Y", "32": "1.5Y", "33": "2.5Y", "34": "3.5Y", "35": "4.5Y", "36": "5.5Y", "36.5": "6Y", "37": "6.5Y", "38": "7Y" };
const usTableFor = (gender) => (gender === "W" ? US_BY_BR_WOMEN : gender === "K" ? US_BY_BR_KIDS : US_BY_BR_MEN);
const presetsFor = (gender) => Object.keys(usTableFor(gender)).sort((a, b) => Number(a) - Number(b)); // chaves inteiras vêm antes das decimais → ordena

const parseMoney = (v) => {
  if (v === "" || v == null) return null;
  const s = String(v).trim();
  const n = s.includes(",") ? Number(s.replace(/\./g, "").replace(",", ".")) : Number(s);
  return Number.isFinite(n) ? n : NaN;
};
const fmtMoneyInput = (v) => (v == null ? "" : String(v).replace(".", ","));

async function fileToDataUrl(file, max = 1400) {
  const bitmap = await new Promise((resolve, reject) => {
    if (typeof createImageBitmap === "function") return createImageBitmap(file).then(resolve, reject);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
  const w = bitmap.width || bitmap.naturalWidth, h = bitmap.height || bitmap.naturalHeight;
  const scale = Math.min(1, max / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  let out = canvas.toDataURL("image/webp", 0.86);
  if (!out.startsWith("data:image/webp")) out = canvas.toDataURL(file.type === "image/png" ? "image/png" : "image/jpeg", 0.88);
  return out;
}

const SECTION_UI = {
  stock: { base: "/admin/estoque", page: "/pronta-entrega", back: "Pronta entrega", h1new: <>Novo <em>produto</em></>, where: "Estoque próprio · aparece em /pronta-entrega" },
  hypados: { base: "/admin/hypados", page: "/hypados", back: "Hypados", h1new: <>Novo <em>hypado</em></>, where: "Estoque próprio · aparece em /hypados" }
};

export default function StockForm({ auth, notify, section = "stock" }) {
  const ui = SECTION_UI[section] || SECTION_UI.stock;
  const { id } = useParams();
  const isNew = !id || id === "novo";
  const navigate = useNavigate();
  const [form, setForm] = useState(isNew ? EMPTY : null);
  const [product, setProduct] = useState(null);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [urlInput, setUrlInput] = useState("");
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    if (isNew) return;
    try {
      const d = await auth.request(`/api/admin/stock/${id}`);
      setProduct(d);
      setForm({
        ...EMPTY, ...d,
        category: d.category || "", gender: d.gender || "M", colorDescription: d.colorDescription || "", styleColor: d.styleColor || "", badge: d.badge || "", description: d.description || "",
        priceBrl: fmtMoneyInput(d.priceBrl), fullPriceBrl: fmtMoneyInput(d.fullPriceBrl), costBrl: fmtMoneyInput(d.costBrl),
        images: d.images || [], sizes: (d.sizes || []).map((s) => ({ br: s.br, us: s.us || "", qty: s.qty }))
      });
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, [auth, id, isNew]);

  useEffect(() => { load(); }, [load]);

  const f = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const setSize = (i, k, v) => setForm((s) => ({ ...s, sizes: s.sizes.map((x, j) => (j === i ? { ...x, [k]: v } : x)) }));
  const addSize = (br = "") => setForm((s) => (br && s.sizes.some((x) => x.br === br) ? s : { ...s, sizes: [...s.sizes, { br, us: br && usTableFor(s.gender)[br] ? usTableFor(s.gender)[br] : "", qty: 1 }] }));
  // trocar a modelagem re-preenche o US dos tamanhos que vieram da tabela (não mexe em US digitado à mão fora dela)
  const setGender = (gender) => setForm((s) => {
    const oldT = usTableFor(s.gender), newT = usTableFor(gender);
    return { ...s, gender, sizes: s.sizes.map((x) => (!x.us || x.us === oldT[x.br] ? { ...x, us: newT[x.br] || "" } : x)) };
  });
  const rmSize = (i) => setForm((s) => ({ ...s, sizes: s.sizes.filter((_, j) => j !== i) }));
  const moveImg = (i, d) => setForm((s) => {
    const arr = [...s.images]; const j = i + d;
    if (j < 0 || j >= arr.length) return s;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    return { ...s, images: arr };
  });
  const rmImg = (i) => setForm((s) => ({ ...s, images: s.images.filter((_, j) => j !== i) }));

  function body() {
    const price = parseMoney(form.priceBrl);
    if (!form.name.trim()) throw new Error("Informe o nome do produto");
    if (!(price > 0)) throw new Error("Informe o preço no Pix (ex.: 1899,00)");
    if (!form.category) throw new Error("Escolha a categoria (Basquete, Casual ou Corrida)");
    const full = parseMoney(form.fullPriceBrl), cost = parseMoney(form.costBrl);
    if (Number.isNaN(full) || Number.isNaN(cost)) throw new Error("Preço 'de' ou custo inválido");
    const sizes = form.sizes.map((s) => ({ br: String(s.br).trim(), us: String(s.us || "").trim() || null, qty: Math.max(0, parseInt(s.qty, 10) || 0) })).filter((s) => s.br);
    return {
      section,
      name: form.name.trim(), brand: form.brand.trim() || "Nike", category: form.category || null, gender: form.gender || "M", colorDescription: form.colorDescription, styleColor: form.styleColor,
      badge: form.badge, description: form.description, priceBrl: price, fullPriceBrl: full, costBrl: cost,
      active: Boolean(form.active), sortOrder: parseInt(form.sortOrder, 10) || 0, images: form.images, sizes
    };
  }

  async function save(e) {
    e?.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const payload = body();
      if (isNew) {
        const d = await auth.request("/api/admin/stock", { method: "POST", body: JSON.stringify(payload) });
        notify?.("Produto criado — agora envie as fotos");
        navigate(`${ui.base}/${d.id}`, { replace: true });
        return;
      }
      const d = await auth.request(`/api/admin/stock/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
      setProduct(d);
      setForm((s) => ({ ...s, images: d.images, sizes: d.sizes.map((x) => ({ br: x.br, us: x.us || "", qty: x.qty })) }));
      setMsg({ ok: true, text: "Produto salvo" });
      notify?.("Produto salvo");
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function onFiles(e) {
    const files = [...(e.target.files || [])];
    e.target.value = "";
    if (!files.length) return;
    if (isNew) { setMsg({ ok: false, text: "Salve o produto antes de enviar fotos (ou cole uma URL)." }); return; }
    setUploading(files.length); setMsg(null);
    let last = null;
    try {
      for (const file of files) {
        if (!/^image\//.test(file.type)) continue;
        const dataUrl = await fileToDataUrl(file);
        last = await auth.request(`/api/admin/stock/${id}/images`, { method: "POST", body: JSON.stringify({ dataUrl }) });
        setForm((s) => ({ ...s, images: last.images }));
        setUploading((n) => n - 1);
      }
      notify?.(`${files.length} foto(s) enviada(s)`);
    } catch (err) {
      setMsg({ ok: false, text: `Falha no upload: ${err.message}` });
    } finally {
      setUploading(0);
    }
  }

  function addUrl() {
    const u = urlInput.trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u) && !u.startsWith("/")) { setMsg({ ok: false, text: "URL inválida (precisa começar com http:// ou https://)" }); return; }
    setForm((s) => ({ ...s, images: [...s.images, u] }));
    setUrlInput("");
  }

  async function remove() {
    if (!window.confirm(`Remover "${product?.name}" do estoque? As fotos enviadas também são apagadas. Pedidos já feitos não são afetados.`)) return;
    setBusy(true);
    try {
      await auth.request(`/api/admin/stock/${id}`, { method: "DELETE" });
      notify?.("Produto removido");
      navigate(ui.base, { replace: true });
    } catch (err) {
      setMsg({ ok: false, text: err.message });
      setBusy(false);
    }
  }

  if (!form) return <><header className="adm-head"><div><h1>{ui.back}</h1></div></header><ErrorBox error={error} />{!error && <Loading />}</>;

  const totalQty = form.sizes.reduce((a, s) => a + (parseInt(s.qty, 10) || 0), 0);
  const price = parseMoney(form.priceBrl), cost = parseMoney(form.costBrl);
  const margin = price > 0 && cost >= 0 && cost != null ? price - cost : null;

  return (
    <>
      <header className="adm-head">
        <div>
          <div className="sub" style={{ marginTop: 0, marginBottom: 8 }}><Link to={ui.base}>← {ui.back}</Link></div>
          <h1>{isNew ? ui.h1new : <>{product?.name || "Produto"}</>}</h1>
          <div className="sub">{isNew ? ui.where : `${product?.code} · ${totalQty} par(es) · ${form.active ? "ativo" : "inativo"}`}</div>
        </div>
        <div className="actions">
          {!isNew && <button className="btn danger" type="button" onClick={remove} disabled={busy}>Remover</button>}
          <button className="btn primary" type="button" onClick={save} disabled={busy}>{busy ? "Salvando…" : isNew ? "Criar produto" : "Salvar"}</button>
        </div>
      </header>

      {msg && <div className={msg.ok ? "ok" : "err"}>{msg.text}</div>}
      <ErrorBox error={error} />

      <form onSubmit={save} className="adm-grid3">
        <div>
          <div className="adm-card">
            <h3>Produto</h3>
            <div className="form-grid">
              <div className="field span2"><label>Nome *</label><input value={form.name} onChange={f("name")} placeholder="Ex.: Kobe 6 Protro" required /></div>
              <div className="field"><label>Marca</label><input value={form.brand} onChange={f("brand")} placeholder="Nike" /></div>
              <div className="field">
                <label>Categoria</label>
                <select value={form.category} onChange={f("category")}>
                  <option value="">— escolher —</option>
                  {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Modelagem</label>
                <select value={form.gender} onChange={(e) => setGender(e.target.value)}>
                  {GENDERS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
                </select>
              </div>
              <div className="field"><label>Colorway (cor)</label><input value={form.colorDescription} onChange={f("colorDescription")} placeholder="Ex.: Grinch / Green Apple" /></div>
              <div className="field"><label>SKU Nike (opcional)</label><input value={form.styleColor} onChange={f("styleColor")} placeholder="Ex.: CW2190-300" /></div>
              <div className="field span2"><label>Descrição (aparece no seletor de tamanho)</label><textarea rows={5} value={form.description} onChange={f("description")} placeholder="Par novo na caixa, com nota fiscal da Nike US. Pronta entrega — sai em até 1 dia útil." /></div>
              <div className="field"><label>Selo no card (opcional)</label><input value={form.badge} onChange={f("badge")} placeholder="Ex.: ÚLTIMO PAR (padrão: PRONTA ENTREGA)" maxLength={24} /></div>
              <div className="field"><label>Ordem na página (menor = primeiro)</label><input type="number" value={form.sortOrder} onChange={f("sortOrder")} /></div>
            </div>
          </div>

          <div className="adm-card">
            <h3>Tamanhos e quantidade <small>numeração BR · {GENDERS.find((g) => g.key === form.gender)?.us || "US"} (opcional) · pares disponíveis</small></h3>
            <div className="adm-chips" style={{ marginBottom: 12 }}>
              {presetsFor(form.gender).map((br) => (
                <button type="button" key={br} className={form.sizes.some((s) => s.br === br) ? "on" : ""} onClick={() => addSize(br)} title={`US ${usTableFor(form.gender)[br]}`}>{br}</button>
              ))}
              <button type="button" onClick={() => addSize("")}>+ outro</button>
            </div>
            {form.sizes.length === 0 ? (
              <div className="empty" style={{ padding: 20 }}>Clique nos números acima para adicionar os tamanhos que você tem.</div>
            ) : (
              <div className="adm-table-wrap">
                <table>
                  <thead><tr><th>BR</th><th>{GENDERS.find((g) => g.key === form.gender)?.us || "US (caixa)"}</th><th>Qtd</th><th></th></tr></thead>
                  <tbody>
                    {form.sizes.map((s, i) => (
                      <tr key={i}>
                        <td style={{ width: 120 }}><input value={s.br} onChange={(e) => setSize(i, "br", e.target.value)} placeholder="41" style={{ width: 90 }} /></td>
                        <td style={{ width: 140 }}><input value={s.us} onChange={(e) => setSize(i, "us", e.target.value)} placeholder="9.5" style={{ width: 100 }} /></td>
                        <td style={{ width: 140 }}><input type="number" min={0} max={999} value={s.qty} onChange={(e) => setSize(i, "qty", e.target.value)} style={{ width: 90 }} /></td>
                        <td className="num"><button type="button" className="btn sm danger" onClick={() => rmSize(i)}>remover</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="sub" style={{ marginTop: 10, fontSize: 11, color: "var(--muted)" }}>
              Qtd 0 = tamanho esgotado (some do seletor). A quantidade baixa sozinha quando um pedido é criado e volta se ele for cancelado/abandonado.
              O US é preenchido pela tabela oficial Nike BR da modelagem escolhida (pode corrigir à mão pelo que está na caixa); no site o cliente vê "BR 38 (US M 7)" ou "(US W 8.5)".
            </p>
          </div>

          <div className="adm-card">
            <h3>Fotos <small>a primeira é a capa do card · arraste não; use as setas</small></h3>
            <div className="stk-photos">
              {form.images.map((u, i) => (
                <div className="stk-photo" key={`${u}-${i}`}>
                  <img src={u} alt="" />
                  {i === 0 && <span className="cover">capa</span>}
                  <div className="ops">
                    <button type="button" onClick={() => moveImg(i, -1)} disabled={i === 0} title="Mover para a esquerda">←</button>
                    <button type="button" onClick={() => moveImg(i, 1)} disabled={i === form.images.length - 1} title="Mover para a direita">→</button>
                    <button type="button" className="x" onClick={() => rmImg(i)} title="Remover">✕</button>
                  </div>
                </div>
              ))}
              <label className={`stk-photo add${isNew ? " disabled" : ""}`} title={isNew ? "Salve o produto para enviar fotos" : "Enviar fotos"}>
                <input ref={fileRef} type="file" accept="image/*" multiple onChange={onFiles} disabled={isNew || uploading > 0} style={{ display: "none" }} />
                <span>{uploading > 0 ? `enviando ${uploading}…` : "+ enviar fotos"}</span>
                <small>{isNew ? "salve antes" : "JPG/PNG/WebP · redimensiona sozinho"}</small>
              </label>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <input value={urlInput} onChange={(e) => setUrlInput(e.target.value)} placeholder="ou cole a URL de uma foto (https://…)" style={{ flex: 1 }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addUrl(); } }} />
              <button type="button" className="btn" onClick={addUrl}>Adicionar URL</button>
            </div>
            {!isNew && form.images.length > 0 && <p className="sub" style={{ marginTop: 10, fontSize: 11, color: "var(--muted)" }}>Remover uma foto só vale depois de <b>Salvar</b>.</p>}
          </div>
        </div>

        <div>
          <div className="adm-card">
            <h3>Preço</h3>
            <div className="form-grid">
              <div className="field span2"><label>Preço no Pix (R$) *</label><input value={form.priceBrl} onChange={f("priceBrl")} placeholder="1899,00" inputMode="decimal" required /></div>
              <div className="field span2"><label>Preço "de" riscado (R$, opcional)</label><input value={form.fullPriceBrl} onChange={f("fullPriceBrl")} placeholder="2199,00" inputMode="decimal" /></div>
              <div className="field span2"><label>Custo do par (R$, só você vê)</label><input value={form.costBrl} onChange={f("costBrl")} placeholder="1200,00" inputMode="decimal" /></div>
            </div>
            <div className="tiles" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 14, marginBottom: 0 }}>
              <div className="tile"><span className="k">Cliente vê</span><span className="v small">{price > 0 ? brl(price) : "—"}</span><span className="d">no Pix · frete grátis</span></div>
              <div className="tile"><span className="k">Margem est.</span><span className={`v small`}>{margin != null ? brl(margin) : "—"}</span><span className="d">{margin != null && price > 0 ? `${Math.round((margin / price) * 100)}% do preço` : "informe o custo"}</span></div>
            </div>
            <p className="sub" style={{ marginTop: 10, fontSize: 11, color: "var(--muted)", lineHeight: 1.6 }}>
              Aqui o preço é o que você digitar — a fórmula de importação (dólar turismo, frete, comissão) não se aplica. A frase "em até Nx no cartão" segue a configuração geral.
            </p>
          </div>

          <div className="adm-card">
            <h3>Publicação</h3>
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 14 }}>
              <input type="checkbox" checked={form.active} onChange={f("active")} style={{ width: 18, height: 18 }} />
              Ativo — aparece em {ui.page}
            </label>
            {!isNew && (
              <dl className="stk-meta">
                <dt>Código</dt><dd className="mono">{product?.code}</dd>
                <dt>Link</dt>
                <dd>
                  {product?.path ? (
                    <>
                      <a href={product.path} target="_blank" rel="noreferrer">{typeof window !== "undefined" ? `${window.location.origin}${product.path}` : product.path}</a>
                      <button
                        type="button"
                        className="btn"
                        style={{ marginLeft: 8, padding: "2px 8px", fontSize: 11 }}
                        onClick={async () => {
                          const url = `${window.location.origin}${product.path}`;
                          try { await navigator.clipboard.writeText(url); setMsg({ ok: true, text: "Link do tênis copiado — é só colar no Instagram." }); }
                          catch { setMsg({ ok: false, text: `Não deu para copiar; o link é ${url}` }); }
                        }}
                      >
                        Copiar
                      </button>
                      <div className="sub" style={{ marginTop: 4 }}>Página própria do par (sem modal) — o link que vai no Instagram. Não muda ao renomear.</div>
                    </>
                  ) : (
                    <a href={ui.page} target="_blank" rel="noreferrer">{ui.page}</a>
                  )}
                </dd>
                <dt>Criado</dt><dd>{product?.createdAt ? new Date(product.createdAt).toLocaleString("pt-BR") : "—"}</dd>
                <dt>Atualizado</dt><dd>{product?.updatedAt ? new Date(product.updatedAt).toLocaleString("pt-BR") : "—"}</dd>
              </dl>
            )}
          </div>
        </div>
      </form>
    </>
  );
}
