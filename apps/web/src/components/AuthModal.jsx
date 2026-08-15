import { useId, useState } from "react";

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
  const [tracked, setTracked] = useState(false);
  const [busy, setBusy] = useState(false);

  // Login fields
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPw, setLoginPw] = useState("");

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
        <span className="logo">Kulture</span>
        <button className="modal-close" onClick={onClose} aria-label="Fechar">
          &#10005;
        </button>
      </div>
      <div className="modal-title">{TITLES[view]}</div>

      {view === "login" && (
        <form className="tab-panel active" onSubmit={handleLogin}>
          <Field label="E-mail" type="email" placeholder="voce@email.com" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} />
          <Field label="Senha" type="password" placeholder="••••••••" value={loginPw} onChange={(e) => setLoginPw(e.target.value)} />
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
        <div className="tab-panel active">
          <Field label="E-mail cadastrado" type="email" placeholder="voce@email.com" />
          <button className="btn-full" onClick={() => notify("Recuperação de senha entra com o e-mail transacional")}>
            Enviar link de recuperação
          </button>
          <a className="back-link" href="#" onClick={go("login")}>
            &#8592; Voltar para o login
          </a>
        </div>
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
            <Field label="Senha" type="password" placeholder="Mínimo 8 caracteres" value={signupPw} onChange={(e) => setSignupPw(e.target.value)} />
            <Field label="Confirmar senha" type="password" placeholder="••••••••" value={signupPw2} onChange={(e) => setSignupPw2(e.target.value)} />
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
        <div className="tab-panel active">
          <Field label="Código de rastreio ou nº do pedido" type="text" placeholder="KLT-2026-0001" />
          <button className="btn-full" onClick={() => setTracked(true)}>
            Rastrear pedido
          </button>
          <div className={`track-result${tracked ? " show" : ""}`}>
            <b className="track-title">Pedido KLT-2026-0001</b>
            <div className="track-steps">
              {[
                ["Pagamento aprovado (InfinitePay)", false],
                ["Comprado na loja oficial (EUA)", false],
                ["Em trânsito internacional", false],
                ["Liberado na alfândega", true],
                ["Saiu para entrega", true]
              ].map(([label, pending]) => (
                <div className={`track-step${pending ? " pending" : ""}`} key={label}>
                  <span className="dot" /> {label}
                </div>
              ))}
            </div>
            <small className="track-note">* exemplo ilustrativo — dados reais virão dos pedidos (Fase 4)</small>
          </div>
          <a className="back-link" href="#" onClick={go("login")}>
            &#8592; Ir para o login
          </a>
        </div>
      )}
    </div>
  );
}
