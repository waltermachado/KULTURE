import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorBox, Loading, fmtDateTime } from "./ui.jsx";

/**
 * Marketing por e-mail — /admin/marketing.
 *  - Status do e-mail: provedor (SMTP da MailerSend em produção), remetente e teste de conexão/login.
 *  - Campanha: assunto, mensagem (linha em branco = novo parágrafo), imagem e botão opcionais, público.
 *    "Ver prévia" renderiza o HTML real; "Enviar teste para mim" manda só para o admin; "Enviar campanha"
 *    pede confirmação com o tamanho do público e dispara em segundo plano (a tabela acompanha o progresso).
 *  - Todo e-mail sai com link de descadastro; quem clicar some do público automaticamente.
 */
const EMPTY = { subject: "", body: "", ctaLabel: "", ctaUrl: "", imageUrl: "", audience: "all" };
const STATUS = { draft: ["Rascunho", "abandoned"], sending: ["Enviando…", "pending_payment"], sent: ["Enviada", "paid"], failed: ["Falhou", "cancelled"] };

export default function Marketing({ auth, notify }) {
  const [mail, setMail] = useState(null);          // /api/admin/mail/status
  const [mailBusy, setMailBusy] = useState(false);
  const [audience, setAudience] = useState(null);  // { audiences, counts }
  const [campaigns, setCampaigns] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [preview, setPreview] = useState(null);    // { subject, html }
  const [busy, setBusy] = useState(null);          // "preview" | "test" | "send"
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);
  const pollRef = useRef(null);
  const f = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.value }));
  const payload = () => ({
    subject: form.subject.trim(),
    body: form.body,
    ctaLabel: form.ctaLabel.trim() || null,
    ctaUrl: form.ctaUrl.trim() || null,
    imageUrl: form.imageUrl.trim() || null,
    audience: form.audience
  });

  const loadStatus = useCallback(async () => {
    setMailBusy(true);
    try { setMail(await auth.request("/api/admin/mail/status")); } catch (e) { setMail({ ok: false, error: e.message }); } finally { setMailBusy(false); }
  }, [auth]);
  const loadCampaigns = useCallback(async () => {
    try {
      const [a, c] = await Promise.all([auth.request("/api/admin/marketing/audience"), auth.request("/api/admin/marketing/campaigns")]);
      setAudience(a); setCampaigns(c.campaigns || []); setError(null);
    } catch (e) { setError(e); }
  }, [auth]);

  useEffect(() => { loadStatus(); loadCampaigns(); }, [loadStatus, loadCampaigns]);

  // enquanto houver campanha "sending", atualiza a tabela a cada 2s
  useEffect(() => {
    const sending = (campaigns || []).some((c) => c.status === "sending");
    clearInterval(pollRef.current);
    if (sending) pollRef.current = setInterval(loadCampaigns, 2000);
    return () => clearInterval(pollRef.current);
  }, [campaigns, loadCampaigns]);

  async function run(kind, fn) {
    setBusy(kind); setMsg(null);
    try { await fn(); } catch (e) { setMsg({ ok: false, text: e.message || "Falhou" }); } finally { setBusy(null); }
  }

  const doPreview = () => run("preview", async () => {
    const p = await auth.request("/api/admin/marketing/preview", { method: "POST", body: JSON.stringify(payload()) });
    setPreview(p);
  });
  const doTest = () => run("test", async () => {
    const r = await auth.request("/api/admin/marketing/test", { method: "POST", body: JSON.stringify(payload()) });
    if (r.ok) { setMsg({ ok: true, text: `Teste enviado para ${r.to} (${r.provider || mail?.provider || "e-mail"}). Confira a caixa de entrada — e o spam.` }); notify?.("Teste enviado"); }
    else setMsg({ ok: false, text: `O provedor recusou o teste: ${r.error || r.skipped || "erro desconhecido"}` });
  });
  const doSend = () => run("send", async () => {
    const n = audience?.counts?.[form.audience] ?? 0;
    if (!n) { setMsg({ ok: false, text: "Ninguém no público escolhido." }); return; }
    if (!window.confirm(`Enviar "${form.subject.trim()}" para ${n} pessoa(s) (${audience.audiences[form.audience]})?\n\nNão dá para cancelar depois de começar.`)) return;
    const r = await auth.request("/api/admin/marketing/campaigns", { method: "POST", body: JSON.stringify(payload()) });
    setMsg({ ok: true, text: `Campanha disparada para ${r.campaign.total} pessoa(s). Acompanhe o progresso abaixo.` });
    notify?.("Campanha disparada");
    setForm(EMPTY); setPreview(null);
    loadCampaigns();
  });
  const resend = (c) => run("send", async () => {
    if (!window.confirm(`Reenviar "${c.subject}" para o público atual?`)) return;
    await auth.request(`/api/admin/marketing/campaigns/${c.id}/send`, { method: "POST" });
    loadCampaigns();
  });
  const reuse = (c) => { setForm({ subject: c.subject, body: c.body, ctaLabel: c.ctaLabel || "", ctaUrl: c.ctaUrl || "", imageUrl: c.imageUrl || "", audience: c.audience }); setPreview(null); window.scrollTo({ top: 0, behavior: "smooth" }); };

  const canAct = form.subject.trim() && form.body.trim() && !busy;
  const count = audience?.counts?.[form.audience];

  return (
    <>
      <header className="adm-head">
        <div>
          <h1>Mar<em>keting</em></h1>
          <div className="sub">{audience ? `${audience.counts.all} pessoa(s) no público total · ${audience.counts.unsubscribed} descadastrada(s)` : "—"}</div>
        </div>
        <div className="actions">
          <button className="btn" type="button" onClick={loadStatus} disabled={mailBusy}>{mailBusy ? "Testando…" : "Testar conexão"}</button>
          <button className="btn" type="button" disabled={mailBusy || !mail} onClick={async () => {
            setMailBusy(true);
            try { const r = await auth.request("/api/admin/mail/test", { method: "POST" }); setMsg(r.ok ? { ok: true, text: `E-mail simples enviado para ${r.to}.` } : { ok: false, text: `Falhou: ${r.error || r.skipped}` }); }
            catch (e) { setMsg({ ok: false, text: e.message }); } finally { setMailBusy(false); }
          }}>E-mail de teste para mim</button>
        </div>
      </header>

      <ErrorBox error={error} />
      {msg && <div className={msg.ok ? "ok" : "err"}>{msg.text}</div>}

      <div className="adm-card">
        <h3>E-mail <small>{mail ? `provedor: ${mail.provider}` : "…"}</small></h3>
        {!mail ? <Loading /> : (
          <div className="mkt-status">
            <span className={`pill ${mail.ok ? "paid" : "cancelled"}`}>{mail.ok ? "conectado" : "com problema"}</span>
            <span>Remetente: <b>{mail.fromName} &lt;{mail.from}&gt;</b>{mail.replyTo ? ` · respostas para ${mail.replyTo}` : ""}</span>
            {mail.provider === "smtp" && <span className="mono">{mail.host}:{mail.port} · usuário {mail.user || "—"}</span>}
            {mail.error && <span className="mkt-err">{mail.error}</span>}
            {mail.note && <span className="sub">{mail.note}</span>}
            {mail.provider === "log" && <span className="mkt-err">MAIL_PROVIDER=log: nada sai de verdade. Em produção use MAIL_PROVIDER=smtp (MailerSend) — ver docs/DEPLOY.md.</span>}
          </div>
        )}
      </div>

      <div className="adm-grid2" style={{ marginTop: 16 }}>
        <div className="adm-card">
          <h3>Nova campanha</h3>
          <div className="form-grid">
            <div className="field span2"><label>Assunto *</label><input value={form.subject} onChange={f("subject")} maxLength={150} placeholder="Ex.: Chegou o Kobe 6 Protro na pronta entrega" /></div>
            <div className="field span2">
              <label>Mensagem * <small style={{ textTransform: "none", letterSpacing: 0 }}>— linha em branco separa os parágrafos; links viram clicáveis</small></label>
              <textarea value={form.body} onChange={f("body")} rows={9} maxLength={8000} placeholder={"Oi! Acabou de chegar…\n\nSão só 3 pares, numeração BR, envio imediato."} />
            </div>
            <div className="field span2"><label>Imagem (link, opcional)</label><input value={form.imageUrl} onChange={f("imageUrl")} placeholder="https://lojakulture.com.br/media/estoque/…" /></div>
            <div className="field"><label>Botão — texto</label><input value={form.ctaLabel} onChange={f("ctaLabel")} maxLength={60} placeholder="Ver o par" /></div>
            <div className="field"><label>Botão — link</label><input value={form.ctaUrl} onChange={f("ctaUrl")} placeholder="https://lojakulture.com.br/pronta-entrega/…" /></div>
            <div className="field span2">
              <label>Público</label>
              <select value={form.audience} onChange={f("audience")}>
                {audience ? Object.entries(audience.audiences).map(([k, label]) => <option key={k} value={k}>{label} — {audience.counts[k]}</option>) : <option value="all">Todos</option>}
              </select>
            </div>
          </div>
          <div className="mkt-actions">
            <button className="btn" type="button" onClick={doPreview} disabled={!canAct}>{busy === "preview" ? "…" : "Ver prévia"}</button>
            <button className="btn" type="button" onClick={doTest} disabled={!canAct}>{busy === "test" ? "Enviando…" : "Enviar teste para mim"}</button>
            <button className="btn primary" type="button" onClick={doSend} disabled={!canAct || !count}>{busy === "send" ? "Disparando…" : `Enviar campanha${count != null ? ` · ${count}` : ""}`}</button>
          </div>
          <p className="sub mkt-hint">
            Todo e-mail sai com link de descadastro (obrigatório pela LGPD): quem clicar some do público. Quem comprou como convidado
            entra em “quem já comprou”; contas podem desligar em “Minha conta”. Antes de disparar, mande um teste para você.
          </p>
        </div>

        <div className="adm-card">
          <h3>Prévia <small>{preview ? preview.subject : "clique em “Ver prévia”"}</small></h3>
          {preview ? (
            <iframe title="Prévia do e-mail" className="mkt-preview" srcDoc={preview.html} sandbox="" />
          ) : (
            <div className="mkt-preview empty">A prévia mostra exatamente o e-mail que o cliente recebe (moldura preta e amarela da loja, botão e rodapé com descadastro).</div>
          )}
        </div>
      </div>

      <div className="adm-card" style={{ marginTop: 16 }}>
        <h3>Campanhas <small>últimas 50</small></h3>
        {!campaigns ? <Loading /> : campaigns.length === 0 ? <p className="sub">Nenhuma campanha ainda.</p> : (
          <table>
            <thead><tr><th>Quando</th><th>Assunto</th><th>Público</th><th className="num">Enviados</th><th className="num">Falhas</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {campaigns.map((c) => {
                const [label, cls] = STATUS[c.status] || [c.status, ""];
                return (
                  <tr key={c.id}>
                    <td>{fmtDateTime(c.startedAt || c.createdAt)}</td>
                    <td>{c.subject}{c.lastError && <span className="sub" title={c.lastError}>último erro: {c.lastError}</span>}</td>
                    <td>{audience?.audiences?.[c.audience] || c.audience}</td>
                    <td className="num">{c.sent} / {c.total}</td>
                    <td className="num">{c.failed || "—"}</td>
                    <td><span className={`pill ${cls}`}>{label}</span></td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button className="btn sm" type="button" onClick={() => reuse(c)}>Reutilizar</button>
                      {(c.status === "draft" || c.status === "failed") && <button className="btn sm" type="button" style={{ marginLeft: 6 }} onClick={() => resend(c)} disabled={Boolean(busy)}>{c.status === "draft" ? "Enviar" : "Reenviar"}</button>}
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
