import { useId, useState } from "react";

/**
 * Campo de senha com botão "mostrar/ocultar" dentro da caixa.
 * Uso: <PasswordInput label="Senha" value={pw} onChange={(e) => setPw(e.target.value)} />
 * `label` opcional (sem label, renderiza só o input+botão para encaixar em layouts próprios).
 */
export default function PasswordInput({ label, className = "", id: idProp, ...props }) {
  const autoId = useId();
  const id = idProp || autoId;
  const [show, setShow] = useState(false);
  const input = (
    <div className="pw-wrap">
      <input id={id} {...props} type={show ? "text" : "password"} autoComplete={props.autoComplete || "current-password"} />
      <button
        type="button"
        className="pw-toggle"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Ocultar senha" : "Mostrar senha"}
        aria-pressed={show}
        title={show ? "Ocultar senha" : "Mostrar senha"}
        tabIndex={-1}
      >
        {show ? <EyeOff /> : <Eye />}
      </button>
    </div>
  );
  if (!label) return input;
  return (
    <div className={`field ${className}`.trim()}>
      <label htmlFor={id}>{label}</label>
      {input}
    </div>
  );
}

function Eye() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOff() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-6.5 0-10-7-10-7a19.8 19.8 0 0 1 4.22-5.06" />
      <path d="M9.9 4.24A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a19.8 19.8 0 0 1-2.16 3.19" />
      <path d="M14.12 14.12A3 3 0 0 1 9.88 9.88" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}
