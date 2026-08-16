import { useState } from "react";
import PasswordInput from "../components/PasswordInput.jsx";
import { useNavigate, useSearchParams } from "react-router-dom";

/**
 * /redefinir-senha?token=… — destino do link enviado por e-mail (ou gerado pelo backoffice).
 */
export default function ResetPassword({ auth, onOpenLogin }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") || "";
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [done, setDone] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setMsg(null);
    if (pw.length < 8) return setMsg("A senha precisa ter pelo menos 8 caracteres");
    if (pw !== pw2) return setMsg("As senhas não coincidem");
    setBusy(true);
    try {
      await auth.resetPassword(token, pw);
      setDone(true);
    } catch (err) {
      setMsg(err.message || "Não foi possível redefinir a senha");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="reset-page">
      <div className="box">
        {!token ? (
          <>
            <h2>Link <em>inválido</em></h2>
            <p>Este link não tem o código de redefinição. Peça um novo em “Esqueci minha senha”.</p>
            <button className="btn-full" onClick={onOpenLogin}>Ir para o login</button>
          </>
        ) : done ? (
          <>
            <h2>Senha <em>redefinida</em></h2>
            <p>Pronto! Sua senha foi alterada e as sessões antigas foram encerradas. Entre com a nova senha.</p>
            <button className="btn-full" onClick={() => { navigate("/"); onOpenLogin(); }}>Entrar</button>
          </>
        ) : (
          <>
            <h2>Nova <em>senha</em></h2>
            <p>Escolha uma senha nova para a sua conta Kulture. O link vale uma vez só.</p>
            <form onSubmit={submit}>
              <PasswordInput label="Nova senha" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="mínimo 8 caracteres" autoFocus autoComplete="new-password" />
              <PasswordInput label="Repetir senha" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
              <button className="btn-full" type="submit" disabled={busy}>{busy ? "Salvando…" : "Salvar nova senha"}</button>
              {msg && <p className="msg err" style={{ color: "var(--red)", fontSize: 12, marginTop: 10 }}>{msg}</p>}
            </form>
          </>
        )}
      </div>
    </main>
  );
}
