import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";

/**
 * Seletor de seção: IMPORTADOS (busca ao vivo na Nike US) × PRONTA ENTREGA (estoque no Brasil).
 * Aparece logo abaixo do topo nas duas vitrines (desktop e mobile).
 *
 * Transição "avião EUA ⇄ BR" (opção C aprovada em 17/08):
 *  - ao clicar no outro lado, o aviãozinho decola da bandeira ativa, cruza a barra deixando um rastro
 *    tracejado e pousa na outra bandeira (~0,7s); o bloco amarelo (.mode-hl) desliza junto;
 *  - em paralelo, o App faz a página sair para um lado e a nova entrar do outro (`onSwitch(to, dir)`);
 *  - `prefers-reduced-motion` → troca seca; um novo clique cancela a animação em curso.
 * No mobile é o mesmo voo, só mais curto (a barra tem ~375px) e o avião menor.
 */
export const MODES = [
  { to: "/", key: "import", flag: "EUA", label: "Importados", sub: "direto dos EUA" },
  { to: "/pronta-entrega", key: "stock", flag: "BR", label: "Pronta entrega", sub: "estoque no Brasil" }
];

const modeOf = (pathname) => (pathname.startsWith("/pronta-entrega") ? "stock" : "import");
const reduceMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export default function ModeBar({ onSwitch }) {
  const { pathname } = useLocation();
  const active = modeOf(pathname);
  const [pending, setPending] = useState(null); // lado para onde o avião está indo (antes da rota trocar)
  const navRef = useRef(null);
  const planeRef = useRef(null);
  const trailRef = useRef(null);
  const flagRefs = useRef({});
  const running = useRef([]);

  // rota trocou → o destaque já está no lugar certo; limpa o "pendente"
  useEffect(() => { setPending(null); }, [pathname]);

  const cancelAll = () => {
    running.current.forEach((a) => { try { a.cancel(); } catch { /* já terminou */ } });
    running.current = [];
  };

  function fly(fromKey, toKey) {
    const nav = navRef.current, plane = planeRef.current, trail = trailRef.current;
    const from = flagRefs.current[fromKey], to = flagRefs.current[toKey];
    if (!nav || !plane || !trail || !from || !to) return Promise.resolve();
    const nb = nav.getBoundingClientRect();
    const center = (el) => { const r = el.getBoundingClientRect(); return { x: r.left - nb.left + r.width / 2, y: r.top - nb.top + r.height / 2 }; };
    const a = center(from), b = center(to);
    const east = b.x > a.x; // EUA→BR voa para a direita
    const rot = east ? 90 : -90;
    const lift = nb.height < 60 ? 10 : 16; // barra mais baixa no mobile → arco mais raso

    trail.style.left = `${Math.min(a.x, b.x)}px`;
    trail.style.width = `${Math.abs(b.x - a.x)}px`;
    trail.style.top = `${a.y}px`;
    trail.style.transformOrigin = east ? "left center" : "right center";
    const t = trail.animate(
      [{ transform: "scaleX(0)", opacity: 0.55 }, { transform: "scaleX(1)", opacity: 0.55, offset: 0.8 }, { transform: "scaleX(1)", opacity: 0 }],
      { duration: 900, easing: "cubic-bezier(.4,0,.2,1)" }
    );
    const p = plane.animate(
      [
        { transform: `translate(${a.x}px, ${a.y}px) rotate(${rot}deg) scale(.7)`, opacity: 0 },
        { transform: `translate(${a.x + (b.x - a.x) * 0.12}px, ${a.y - lift * 0.4}px) rotate(${rot}deg) scale(1)`, opacity: 1, offset: 0.15 },
        { transform: `translate(${(a.x + b.x) / 2}px, ${a.y - lift}px) rotate(${rot}deg) scale(1.05)`, opacity: 1, offset: 0.5 },
        { transform: `translate(${a.x + (b.x - a.x) * 0.88}px, ${a.y - lift * 0.4}px) rotate(${rot}deg) scale(1)`, opacity: 1, offset: 0.85 },
        { transform: `translate(${b.x}px, ${b.y}px) rotate(${rot}deg) scale(.7)`, opacity: 0 }
      ],
      { duration: 700, easing: "cubic-bezier(.4,0,.2,1)" }
    );
    running.current.push(t, p);
    return p.finished.catch(() => {});
  }

  function pick(e, m) {
    e.preventDefault();
    const current = pending ?? active;
    if (m.key === current) {
      // já está aqui: só sobe ao topo
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const dir = m.key === "stock" ? "east" : "west";
    if (reduceMotion()) {
      onSwitch?.(m.to, dir, { animate: false });
      return;
    }
    cancelAll();
    setPending(m.key);
    fly(current, m.key);
    onSwitch?.(m.to, dir, { animate: true });
  }

  const shown = pending ?? active;
  return (
    <nav ref={navRef} className={`mode-bar mode-${shown}`} aria-label="Seção da loja">
      <span className="mode-hl" aria-hidden="true" />
      <span ref={trailRef} className="mode-trail" aria-hidden="true" />
      {MODES.map((m) => (
        <NavLink
          key={m.key}
          to={m.to}
          end
          className={`mode-link${shown === m.key ? " on" : ""}`}
          aria-current={active === m.key ? "page" : undefined}
          onClick={(e) => pick(e, m)}
        >
          <span className="mode-flag" aria-hidden="true" ref={(el) => { flagRefs.current[m.key] = el; }}>{m.flag}</span>
          <span className="mode-text">
            <b>{m.label}</b>
            <small>{m.sub}</small>
          </span>
        </NavLink>
      ))}
      <svg ref={planeRef} className="mode-plane" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" />
      </svg>
    </nav>
  );
}
