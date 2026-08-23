import OrderTimeline from "./OrderTimeline.jsx";
import { useId, useState } from "react";
import PasswordInput from "./PasswordInput.jsx";

const TITLES = {
  login: <>Login</>,
  forgot: (
    <>
      Diga seu <em>e-mail</em> para recuperação de senha
    </>
  ),
  signup: (
    <>
      Criar <em>cadastro</em>
    </>
  ),
  track: (
    <>
      Rastrear <em>pedido</em>
    </>
  )
};

function Field({ label, className = "", ...props }) {
  const id = useId();
  return (
    <div className={`field ${className}`.trim()}>
      <label htmlFor={id}>{label}</label>
      <input id={id} {...props} />
    </div>
  );
}

function maskCep(v) {
  const d = v.replace(/\D/g, "").slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

/**
 * Modal de conta: login / esqueci / cadastro / rastreio.
 * Fase 2: login e register ligados ao /api/auth.
 */
export default function AuthModal({ open, view, onSwitch, onClose, notify, auth }) {
  const [cep, setCep] = useState("");
  const [addr, setAddr] = useState({ endereco: "", bairro: "", cidade: "", uf: "" });
  const [cepStatus, setCepStatus] = useState("");
  const [trackNumber, setTrackNumber] = useState("");
  const [tracked, setTracked] = useState(null); // { order } | { error }
  const [busy, setBusy] = useState(false);

  // Login fields
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPw, setLoginPw] = useState("");

  // Forgot
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSent, setForgotSent] = useState(false);

  // Signup fields
  const [signupName, setSignupName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPhone, setSignupPhone] = useState("");
  const [signupCpf, setSignupCpf] = useState("");
  const [signupPw, setSignupPw] = useState("");
  const [signupPw2, setSignupPw2] = useState("");
  const [signupTerms, setSignupTerms] = useState(false);
  const [signupNumber, setSignupNumber] = useState("");
  const [signupComplement, setSignupComplement] = useState("");

  async function buscaCEP() {
    const raw = cep.replace(/\D/g, "");
    if (raw.length !== 8) return;
    setCepStatus("Buscando CEP...");
    try {
      const r = await fetch(`https://viacep.com.br/ws/${raw}/json/`);
      const d = await r.json();
      if (d.erro) return setCepStatus("CEP não encontrado — preencha manualmente");
      setAddr({ endereco: d.logradouro || "", bairro: d.bairro || "", cidade: d.localidade || "", uf: d.uf || "" });
      setCepStatus("Endereço preenchido automaticamente ✓");
    } catch {
      setCepStatus("Erro ao consultar CEP — preencha manualmente");
    }
  }

  const go = (v) => (e) => {
    e.preventDefault();
    onSwitch(v);
  };

  async function handleLogin(e) {
    e.preventDefault();
    if (!loginEmail || !loginPw) return notify("Preencha email e senha");
    setBusy(true);
    try {
      const user = await auth.login(loginEmail, loginPw);
      notify(`Bem-vindo, ${user.name}! 🔥`);
      setLoginEmail("");
      setLoginPw("");
      onClose();
    } catch (err) {
      notify(err.message || "Erro ao fazer login");
    } finally {
      setBusy(false);
    }
  }

  async function handleTrack(e) {
    e.preventDefault();
    const n = trackNumber.trim().toUpperCase();
    if (!n) return notify("Digite o número do pedido (KLT-…)");
    setBusy(true);
    setTracked(null);
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(n)}`, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(res.status === 404 ? "Pedido não encontrado" : "Não foi possível consultar agora");
      setTracked({ order: await res.json() });
    } catch (err) {
      setTracked({ error: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function handleForgot(e) {
    e.preventDefault();
    const email = (forgotEmail || loginEmail).trim();
    if (!email) return notify("Digite o e-mail cadastrado");
    setBusy(true);
    try {
      await auth.forgotPassword(email);
      setForgotSent(true);
      notify("Se o e-mail tiver cadastro, o link foi enviado ✉️");
    } catch (err) {
      notify(err.message || "Erro ao pedir recuperação");
    } finally {
      setBusy(false);
    }
  }

  async function handleSignup(e) {
    e.preventDefault();
    if (!signupName || !signupEmail || !signupPw) return notify("Preencha nome, email e senha");
    if (signupPw.length < 8) return notify("Senha deve ter no mínimo 8 caracteres");
    if (signupPw !== signupPw2) return notify("As senhas não coincidem");
    if (!signupTerms) return notify("Aceite os termos para continuar");
    setBusy(true);
    try {
      const user = await auth.register({
        email: signupEmail,
        password: signupPw,
        name: signupName,
        cpf: signupCpf || undefined,
        phone: signupPhone || undefined,
        // endereço vai junto no cadastro para o cliente não digitar de novo no checkout
        address: {
          cep: cep.replace(/\D/g, ""),
          street: addr.endereco,
          number: signupNumber,
          complement: signupComplement,
          neighborhood: addr.bairro,
          city: addr.cidade,
          state: addr.uf
        }
      });
      notify(`Conta criada! Bem-vindo, ${user.name}! 🎉`);
      setSignupName("");
      setSignupEmail("");
      setSignupPhone("");
      setSignupCpf("");
      setSignupPw("");
      setSignupPw2("");
      setSignupTerms(false);
      onClose();
    } catch (err) {
      notify(err.message || "Erro ao criar conta");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`modal${open ? " open" : ""}`} role="dialog" aria-modal="true" aria-hidden={!open}>
      <div className="modal-header">
        <span className="logo"><img src="/logo.png" alt="Kulture BR" /></span>
        <button className="modal-close" onClick={onClose} aria-label="Fechar">
          &#10005;
        </button>
      </div>
      <div className="modal-title">{TITLES[view]}</div>

      {view === "login" && (
        <form className="tab-panel active" onSubmit={handleLogin}>
          <Field label="E-mail" type="email" placeholder="voce@email.com" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} />
          <PasswordInput label="Senha" placeholder="••••••••" value={loginPw} onChange={(e) => setLoginPw(e.target.value)} autoComplete="current-password" />
          <button className="btn-full" type="submit" disabled={busy}>
            {busy ? "Entrando..." : "Entrar"}
          </button>
          <div className="link-row">
            <a href="#" onClick={go("forgot")}>Esqueci minha senha</a>
            <a href="#" onClick={go("signup")}>Ainda não tenho cadastro</a>
          </div>
        </form>
      )}

      {view === "forgot" && (
        <form className="tab-panel active" onSubmit={handleForgot}>
          {forgotSent ? (
            <p style={{ color: "var(--muted-2)", fontSize: 14, lineHeight: 1.6, marginBottom: 14 }}>
              Se <b style={{ color: "var(--paper)" }}>{(forgotEmail || loginEmail).trim()}</b> tiver cadastro, enviamos um link para redefinir a senha.
              Ele vale por 1 hora. Não chegou? Veja o spam ou fale com a gente no WhatsApp.
            </p>
          ) : (
            <>
              <Field label="E-mail cadastrado" type="email" placeholder="voce@email.com" value={forgotEmail || loginEmail} onChange={(e) => setForgotEmail(e.target.value)} />
              <button className="btn-full" type="submit" disabled={busy}>
                {busy ? "Enviando..." : "Enviar link de recuperação"}
              </button>
            </>
          )}
          <a className="back-link" href="#" onClick={(e) => { setForgotSent(false); go("login")(e); }}>
            &#8592; Voltar para o login
          </a>
        </form>
      )}

      {view === "signup" && (
        <form className="tab-panel active" onSubmit={handleSignup}>
          <Field label="Nome completo" type="text" placeholder="Seu nome" value={signupName} onChange={(e) => setSignupName(e.target.value)} />
          <Field label="E-mail" type="email" placeholder="voce@email.com" value={signupEmail} onChange={(e) => setSignupEmail(e.target.value)} />
          <div className="row">
            <Field label="Telefone / WhatsApp" type="tel" placeholder="(11) 90000-0000" value={signupPhone} onChange={(e) => setSignupPhone(e.target.value)} />
            <Field label="CPF" type="text" placeholder="000.000.000-00" value={signupCpf} onChange={(e) => setSignupCpf(e.target.value)} />
          </div>
          <div className="row">
            <Field label="CEP" type="text" placeholder="00000-000" maxLength={9} value={cep} onChange={(e) => setCep(maskCep(e.target.value))} onBlur={buscaCEP} />
            <Field className="f2" label="Endereço" type="text" placeholder="Preenchido pelo CEP" value={addr.endereco} onChange={(e) => setAddr({ ...addr, endereco: e.target.value })} />
          </div>
          <div className="row">
            <Field label="Número" type="text" placeholder="123" value={signupNumber} onChange={(e) => setSignupNumber(e.target.value)} />
            <Field className="f2" label="Complemento (opcional)" type="text" placeholder="Apto, bloco..." value={signupComplement} onChange={(e) => setSignupComplement(e.target.value)} />
          </div>
          <div className="row">
            <Field label="Bairro" type="text" placeholder="Preenchido pelo CEP" value={addr.bairro} onChange={(e) => setAddr({ ...addr, bairro: e.target.value })} />
            <Field label="Cidade" type="text" placeholder="Preenchido pelo CEP" value={addr.cidade} onChange={(e) => setAddr({ ...addr, cidade: e.target.value })} />
            <Field className="f04" label="UF" type="text" placeholder="SP" maxLength={2} value={addr.uf} onChange={(e) => setAddr({ ...addr, uf: e.target.value.toUpperCase() })} />
          </div>
          {cepStatus && <small className="cep-status">{cepStatus}</small>}
          <div className="row">
            <PasswordInput label="Senha" placeholder="Mínimo 8 caracteres" value={signupPw} onChange={(e) => setSignupPw(e.target.value)} autoComplete="new-password" />
            <PasswordInput label="Confirmar senha" placeholder="••••••••" value={signupPw2} onChange={(e) => setSignupPw2(e.target.value)} autoComplete="new-password" />
          </div>
          <label className="check">
            <input type="checkbox" checked={signupTerms} onChange={(e) => setSignupTerms(e.target.checked)} /> Li e aceito os <a href="#">Termos de Uso</a> e a <a href="#">Política de Privacidade</a>. Autorizo o
            tratamento dos meus dados pessoais para cadastro, processamento de compras e envio de e-mails transacionais (confirmação, rastreio e
            nota fiscal), conforme a LGPD (Lei 13.709/2018).
          </label>
          <button className="btn-full" type="submit" disabled={busy}>
            {busy ? "Criando conta..." : "Criar conta"}
          </button>
          <a className="back-link" href="#" onClick={go("login")}>
            &#8592; Já tenho conta, voltar para o login
          </a>
        </form>
      )}

      {view === "track" && (
        <form className="tab-panel active" onSubmit={handleTrack}>
          <Field label="Nº do pedido" type="text" placeholder="KLT-2026-000123" value={trackNumber} onChange={(e) => setTrackNumber(e.target.value)} />
          <button className="btn-full" type="submit" disabled={busy}>
            {busy ? "Consultando..." : "Rastrear pedido"}
          </button>
          {tracked?.error && <small className="cep-status" style={{ color: "var(--red)", marginTop: 12 }}>{tracked.error}</small>}
          {tracked?.order && (() => {
            const o = tracked.order;
            return (
              <div className="track-result show">
                <b className="track-title">Pedido {o.number}{o.customerName ? ` · ${o.customerName}` : ""}</b>
                <OrderTimeline order={o} />
                {o.trackingUrl && <a href={o.trackingUrl} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 10, fontSize: 12 }}>Abrir rastreio na transportadora ↗</a>}
                <small className="track-note">Entre na sua conta para ver todos os detalhes do pedido.</small>
              </div>
            );
          })()}
          <a className="back-link" href="#" onClick={go("login")}>
            &#8592; Ir para o login
          </a>
        </form>
      )}
    </div>
  );
}
