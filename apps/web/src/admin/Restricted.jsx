import { useCallback, useEffect, useState } from "react";
import { ErrorBox, Loading } from "./ui.jsx";

/**
 * RESTRITOS — /admin/restritos.
 * Modelos que nunca aparecem na loja: somem da busca ao vivo, do top8/vitrine e a página do tênis
 * responde "não encontrado" (ninguém compra por link direto). Bloqueia por NOME (contém, sem
 * caixa/acento) ou por SKU exato. Salvar vale na hora — o filtro roda depois do cache do catálogo.
 */
export default function Restricted({ auth, notify }) {
  const [terms, setTerms] = useState(null); // null = carregando
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setTerms((await auth.request("/api/admin/restricted")).terms);
      setDirty(false);
      setError(null);
    } catch (e) { setError(e); }
  }, [auth]);
  useEffect(() => { load(); }, [load]);

  function add(e) {
    e?.preventDefault?.();
    const t = input.trim().replace(/\s+/g, " ");
    if (!t) return;
    if (terms.some((x) => x.toLowerCase() === t.toLowerCase())) { setMsg({ ok: false, text: `"${t}" já está na lista.` }); return; }
    setTerms([...terms, t]);
    setInput("");
    setDirty(true);
    setMsg(null);
  }

  function remove(t) {
    setTerms(terms.filter((x) => x !== t));
    setDirty(true);
    setMsg(null);
  }

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const r = await auth.request("/api/admin/restricted", { method: "PUT", body: JSON.stringify({ terms }) });
      setTerms(r.terms);
      setDirty(false);
      setMsg({ ok: true, text: "Lista salva — já vale na busca (não precisa esperar o cache)." });
      notify?.("Restritos salvos");
    } catch (err) { setMsg({ ok: false, text: err.message }); } finally { setBusy(false); }
  }

  return (
    <>
      <header className="adm-head">
        <div>
          <h1>Res<em>tritos</em></h1>
          <div className="sub">{terms ? `${terms.length} modelo(s) bloqueado(s) na loja` : "—"}</div>
        </div>
      </header>

      <ErrorBox error={error} />
      {msg && <div className={msg.ok ? "ok" : "err"}>{msg.text}</div>}

      <div className="adm-card">
        <h3>Modelos restritos <small>não aparecem na busca, no destaque nem na vitrine; o link direto responde “não encontrado”</small></h3>
        <form onSubmit={add} className="adm-toolbar" style={{ marginTop: 12, marginBottom: 4 }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder='Nome (contém) ou SKU exato — ex.: "Nike Mind 001" ou "DZ0000-100"'
            maxLength={120}
            style={{ flex: 1, minWidth: 260 }}
          />
          <button className="btn" type="submit" disabled={!input.trim()}>Adicionar</button>
          <button className="btn primary" type="button" disabled={busy || !dirty} onClick={save}>{busy ? "Salvando…" : "Salvar lista"}</button>
        </form>
        {!terms ? <Loading /> : terms.length === 0 ? (
          <p className="sub" style={{ marginTop: 10 }}>Nenhum modelo restrito — a busca mostra tudo que a Nike US devolver.</p>
        ) : (
          <table style={{ marginTop: 10 }}>
            <thead><tr><th>Termo</th><th>Bloqueia</th><th></th></tr></thead>
            <tbody>
              {terms.map((t) => (
                <tr key={t}>
                  <td><span className="mono" style={{ fontSize: 14 }}>{t}</span></td>
                  <td className="sub">{/^[A-Za-z0-9]{5,10}-[0-9]{3}$/.test(t) ? "SKU exato" : "nome que contenha o termo"}</td>
                  <td style={{ textAlign: "right" }}>
                    <button className="btn sm danger" type="button" disabled={busy} onClick={() => remove(t)}>Remover</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="adm-note" style={{ marginTop: 10 }}>
          Vale só para os <b>importados</b> (busca ao vivo na Nike US). Pronta entrega e Hypados são cadastrados por você — para tirar um, desative no próprio cadastro.
          {dirty && <> · <b>Alterações não salvas</b> — clique em “Salvar lista”.</>}
        </p>
      </div>
    </>
  );
}
