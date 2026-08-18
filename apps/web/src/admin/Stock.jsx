import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ErrorBox, Loading, brl } from "./ui.jsx";

/**
 * Pronta entrega — lista dos produtos em estoque próprio (ativos e inativos), com busca.
 * Cadastro/edição em /admin/estoque/novo e /admin/estoque/:id (StockForm.jsx).
 */
export default function Stock({ auth }) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [input, setInput] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const qs = new URLSearchParams();
    if (q) qs.set("q", q);
    auth.request(`/api/admin/stock?${qs}`)
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e) => { if (alive) setError(e); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const products = data?.products || [];
  const active = products.filter((p) => p.active).length;
  const pairs = products.reduce((a, p) => a + (p.active ? p.totalQty : 0), 0);

  return (
    <>
      <header className="adm-head">
        <div>
          <h1>Pronta <em>entrega</em></h1>
          <div className="sub">{data ? `${products.length} produto(s) · ${active} ativo(s) · ${pairs} par(es) disponível(is)` : "—"}</div>
        </div>
        <div className="actions">
          <a className="btn" href="/pronta-entrega" target="_blank" rel="noreferrer">Ver a página ↗</a>
          <Link className="btn primary" to="/admin/estoque/novo">+ Novo produto</Link>
        </div>
      </header>

      <div className="adm-toolbar">
        <form onSubmit={(e) => { e.preventDefault(); setQ(input.trim()); }} style={{ display: "contents" }}>
          <input type="search" placeholder="Buscar nome, código PE-, SKU, cor…" value={input} onChange={(e) => setInput(e.target.value)} />
          <button className="btn" type="submit">Buscar</button>
        </form>
      </div>

      <ErrorBox error={error} />
      <div className="adm-table-wrap">
        {loading && !data ? <Loading /> : (
          <table>
            <thead>
              <tr>
                <th>Produto</th><th>Código</th><th>Tamanhos · qtd</th><th className="num">Preço Pix</th><th className="num">Custo</th><th>Fotos</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {products.length === 0 && (
                <tr><td colSpan={7} className="empty">{q ? "Nada encontrado." : "Nenhum produto cadastrado ainda — clique em “Novo produto”."}</td></tr>
              )}
              {products.map((p) => (
                <tr key={p.id} className="link" onClick={() => navigate(`/admin/estoque/${p.id}`)}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div className="stk-thumb">{p.images?.[0] ? <img src={p.images[0]} alt="" /> : <span>—</span>}</div>
                      <div>
                        <b>{p.name}</b>
                        <span className="sub">{[p.brand, p.colorDescription || p.subtitle].filter(Boolean).join(" · ")}</span>
                      </div>
                    </div>
                  </td>
                  <td><span className="mono">{p.code}</span>{p.styleColor && <span className="sub">SKU {p.styleColor}</span>}</td>
                  <td>
                    <div className="stk-sizes">
                      {p.sizes.length === 0 && <span className="sub">sem tamanhos</span>}
                      {p.sizes.map((s) => (
                        <span key={s.id} className={`stk-size${s.qty <= 0 ? " out" : ""}`} title={s.us ? `US ${s.us}` : ""}>{s.br}<i>{s.qty}</i></span>
                      ))}
                    </div>
                  </td>
                  <td className="num">
                    <b>{brl(p.priceBrl)}</b>
                    {p.fullPriceBrl ? <span className="sub" style={{ textDecoration: "line-through" }}>{brl(p.fullPriceBrl)}</span> : null}
                  </td>
                  <td className="num">{p.costBrl != null ? brl(p.costBrl) : <span className="sub">—</span>}</td>
                  <td>{p.images?.length || 0}</td>
                  <td>
                    <span className={`pill ${p.active ? (p.totalQty > 0 ? "ok" : "abandoned") : "cancelled"}`}>
                      {p.active ? (p.totalQty > 0 ? "no ar" : "esgotado") : "inativo"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="sub" style={{ marginTop: 14, fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>
        Produtos ativos aparecem em <b>/pronta-entrega</b> (esgotados continuam visíveis, sem botão de compra). O estoque por tamanho é
        reservado quando o pedido é criado e volta sozinho se o pedido for cancelado ou abandonado.
      </p>
    </>
  );
}
