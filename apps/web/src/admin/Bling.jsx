import { useCallback, useEffect, useState } from "react";
import { ErrorBox, Loading, fmtDateTime } from "./ui.jsx";

/**
 * Bling — /admin/bling: conexão OAuth para a emissão de NF-e.
 * "Conectar ao Bling" abre a autorização em nova aba; o Bling volta em /api/bling/callback e os tokens ficam
 * guardados (renovação automática). Com a conexão ok + parte fiscal pronta na conta, a emissão automática entra
 * no card Nota fiscal do pedido.
 */
export default function Bling({ auth, notify }) {
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try { setSt(await auth.request("/api/admin/bling/status")); setError(null); }
    catch (e) { setError(e); }
  }, [auth]);
  useEffect(() => { load(); }, [load]);

  async function connect() {
    setBusy(true); setMsg(null);
    try {
      const { url } = await auth.request("/api/admin/bling/connect", { method: "POST" });
      window.open(url, "_blank", "noopener");
      setMsg({ ok: true, text: "Abrimos a autorização do Bling em outra aba. Autorize lá e depois clique em “Atualizar status”." });
    } catch (e) { setMsg({ ok: false, text: e.message }); } finally { setBusy(false); }
  }
  async function disconnect() {
    if (!window.confirm("Desconectar do Bling? A emissão automática para de funcionar até conectar de novo.")) return;
    setBusy(true);
    try { await auth.request("/api/admin/bling/disconnect", { method: "POST" }); notify?.("Bling desconectado"); await load(); }
    catch (e) { setMsg({ ok: false, text: e.message }); } finally { setBusy(false); }
  }

  return (
    <>
      <header className="adm-head">
        <div>
          <h1>Bl<em>ing</em></h1>
          <div className="sub">Emissão de NF-e · conexão OAuth</div>
        </div>
        <div className="actions">
          <button className="btn" type="button" onClick={load} disabled={busy}>Atualizar status</button>
          {st?.connected
            ? <button className="btn danger" type="button" onClick={disconnect} disabled={busy}>Desconectar</button>
            : <button className="btn primary" type="button" onClick={connect} disabled={busy || !st?.configured}>Conectar ao Bling</button>}
        </div>
      </header>

      <ErrorBox error={error} />
      {msg && <div className={msg.ok ? "ok" : "err"}>{msg.text}</div>}

      <div className="adm-card">
        <h3>Conexão</h3>
        {!st ? <Loading /> : (
          <div className="mkt-status">
            <span className={`pill ${st.connected ? (st.ok === false ? "pending_payment" : "paid") : "cancelled"}`}>
              {st.connected ? (st.ok === false ? "conectado, com aviso" : "conectado") : "não conectado"}
            </span>
            {!st.configured && <span className="mkt-err">Faltam BLING_CLIENT_ID e BLING_CLIENT_SECRET nas variáveis do servidor (Railway) — sem elas o botão não funciona.</span>}
            {st.company && <span>Empresa: <b>{st.company}</b></span>}
            {st.clientId && <span className="mono">app {st.clientId}</span>}
            {st.connectedAt && <span>Conectado em {fmtDateTime(st.connectedAt)}{st.refreshedAt ? ` · renovado ${fmtDateTime(st.refreshedAt)}` : ""}</span>}
            {st.error && <span className="mkt-err">{st.error}</span>}
            <span className="sub" style={{ flexBasis: "100%" }}>
              Link de redirecionamento que PRECISA estar no app do Bling (Cadastros → Aplicativos): <b className="mono">{st.callbackUrl}</b>
            </span>
          </div>
        )}
      </div>

      <div className="adm-card" style={{ marginTop: 16 }}>
        <h3>Checklist para a emissão automática</h3>
        <ol className="bl-check">
          <li>App no Bling com o <b>link de redirecionamento</b> acima e escopos de <b>NF-e</b> (e Contatos/Produtos).</li>
          <li><b>BLING_CLIENT_ID</b> e <b>BLING_CLIENT_SECRET</b> nas variáveis do Railway (nunca no git). Se o secret circulou por chat/print, gere outro.</li>
          <li>Clicar em <b>Conectar ao Bling</b> e autorizar (status fica “conectado”).</li>
          <li>Na conta Bling: <b>certificado digital A1</b> válido importado; configuração de NF-e (série e numeração; começar em <b>homologação</b> e depois virar produção).</li>
          <li>Com o contador: <b>natureza de operação</b> da venda (CFOP) e <b>NCM/origem</b> dos tênis (ex.: 6404.11.00) — sem isso a SEFAZ rejeita.</li>
          <li>Definir o gatilho: emitir quando o pedido é <b>pago</b> ou quando é <b>enviado pro endereço</b>.</li>
        </ol>
        <p className="adm-note">Feito o checklist, a emissão entra no card “Nota fiscal” do pedido (emitir → transmitir à SEFAZ → DANFE/XML anexados e enviados ao cliente pelo mesmo e-mail de hoje). Enquanto isso, a nota manual continua funcionando normalmente.</p>
      </div>
    </>
  );
}
