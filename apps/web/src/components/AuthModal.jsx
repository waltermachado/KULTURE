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
 * Fase 2 liga ao /api/auth; por enquanto os botões só avisam (toast).
 */
export default function AuthModal({ open, view, onSwitch, onClose, notify }) {
  const [cep, setCep] = useState("");
  const [addr, setAddr] = useState({ endereco: "", bairro: "", cidade: "", uf: "" });
  const [cepStatus, setCepStatus] = useState("");
  const [tracked, setTracked] = useState(false);

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
        <div className="tab-panel active">
          <Field label="E-mail" type="email" placeholder="voce@email.com" />
          <Field label="Senha" type="password" placeholder="••••••••" />
          <button className="btn-full" onClick={() => notify("Login será conectado ao backend (Fase 2)")}>
            Entrar
          </button>
          <div className="link-row">
            <a href="#" onClick={go("forgot")}>Esqueci minha senha</a>
            <a href="#" onClick={go("signup")}>Ainda não tenho cadastro</a>
          </div>
        </div>
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
        <div className="tab-panel active">
          <Field label="Nome completo" type="text" placeholder="Seu nome" />
          <Field label="E-mail" type="email" placeholder="voce@email.com" />
          <div className="row">
            <Field label="Telefone / WhatsApp" type="tel" placeholder="(11) 90000-0000" />
            <Field label="CPF" type="text" placeholder="000.000.000-00" />
          </div>
          <div className="row">
            <Field label="CEP" type="text" placeholder="00000-000" maxLength={9} value={cep} onChange={(e) => setCep(maskCep(e.target.value))} onBlur={buscaCEP} />
            <Field className="f2" label="Endereço" type="text" placeholder="Preenchido pelo CEP" value={addr.endereco} onChange={(e) => setAddr({ ...addr, endereco: e.target.value })} />
          </div>
          <div className="row">
            <Field label="Número" type="text" placeholder="123" />
            <Field className="f2" label="Complemento (opcional)" type="text" placeholder="Apto, bloco..." />
          </div>
          <div className="row">
            <Field label="Bairro" type="text" placeholder="Preenchido pelo CEP" value={addr.bairro} onChange={(e) => setAddr({ ...addr, bairro: e.target.value })} />
            <Field label="Cidade" type="text" placeholder="Preenchido pelo CEP" value={addr.cidade} onChange={(e) => setAddr({ ...addr, cidade: e.target.value })} />
            <Field className="f04" label="UF" type="text" placeholder="SP" maxLength={2} value={addr.uf} onChange={(e) => setAddr({ ...addr, uf: e.target.value.toUpperCase() })} />
          </div>
          {cepStatus && <small className="cep-status">{cepStatus}</small>}
          <div className="row">
            <Field label="Senha" type="password" placeholder="Mínimo 8 caracteres" />
            <Field label="Confirmar senha" type="password" placeholder="••••••••" />
          </div>
          <label className="check">
            <input type="checkbox" required /> Li e aceito os <a href="#">Termos de Uso</a> e a <a href="#">Política de Privacidade</a>. Autorizo o
            tratamento dos meus dados pessoais para cadastro, processamento de compras e envio de e-mails transacionais (confirmação, rastreio e
            nota fiscal), conforme a LGPD (Lei 13.709/2018).
          </label>
          <button className="btn-full" onClick={() => notify("Cadastro será conectado ao backend (Fase 2)")}>
            Criar conta
          </button>
          <a className="back-link" href="#" onClick={go("login")}>
            &#8592; Já tenho conta, voltar para o login
          </a>
        </div>
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
