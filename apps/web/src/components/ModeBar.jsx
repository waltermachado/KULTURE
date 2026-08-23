import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";

/**
 * Seletor de seção: IMPORTADOS (busca ao vivo na Nike US) × PRONTA ENTREGA (estoque no Brasil) × HYPADOS
 * (estoque próprio, drops hypados). Aparece logo abaixo do topo nas vitrines (desktop e mobile).
 *
 * Transições:
 *  - EUA ⇄ BR: avião (opção C aprovada em 17/08) — decola da bandeira ativa, cruza a barra com rastro
 *    tracejado e pousa na outra (~0,7s);
 *  - qualquer aba ⇄ HYPADOS: bola de basquete amarela Kulture QUICANDO da aba ativa até a aba de destino
 *    (3 quiques decrescentes, girando, com "squash" no contato) — sem rastro.
 *  Em paralelo o App desliza a página (`onSwitch(to, dir)`); `prefers-reduced-motion` → troca seca;
 *  um novo clique cancela a animação em curso.
 */
export const MODES = [
  { to: "/", key: "import", flag: "EUA", label: "Importados", sub: "direto dos EUA" },
  { to: "/hypados", key: "hypados", flag: "ball", label: "Hypados", sub: "drops mais quentes dos EUA 🇺🇸" },
  { to: "/pronta-entrega", key: "stock", flag: "BR", label: "Pronta entrega", sub: "estoque no Brasil" }
];
const ORDER = { import: 0, hypados: 1, stock: 2 };

const modeOf = (pathname) =>
  pathname.startsWith("/hypados") ? "hypados" : pathname.startsWith("/pronta-entrega") ? "stock" : "import";
const reduceMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Bola de basquete Kulture: amarela com gomos pretos (funciona no chip preto e voando sobre o amarelo). */
function BallSvg({ svgRef, className }) {
  return (
    <svg ref={svgRef} className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="10" fill="var(--yellow, #FFD31F)" stroke="#0B0B0B" strokeWidth="1.6" />
      <g stroke="#0B0B0B" strokeWidth="1.4" fill="none">
        <path d="M2 12h20" />
        <path d="M12 2v20" />
        <path d="M5 4.6a13.4 13.4 0 0 1 0 14.8" />
        <path d="M19 4.6a13.4 13.4 0 0 0 0 14.8" />
      </g>
    </svg>
  );
}

export default function ModeBar({ onSwitch }) {
  const { pathname } = useLocation();
  const active = modeOf(pathname);
  const [pending, setPending] = useState(null); // lado para onde a animação está indo (antes da rota trocar)
  const navRef = useRef(null);
  const planeRef = useRef(null);
  const ballRef = useRef(null);
  const trailRef = useRef(null);
  const flagRefs = useRef({});
  const running = useRef([]);

  // rota trocou → o destaque já está no lugar certo; limpa o "pendente"
  useEffect(() => { setPending(null); }, [pathname]);

  const cancelAll = () => {
    running.current.forEach((a) => { try { a.cancel(); } catch { /* já terminou */ } });
    running.current = [];
  };

  const centers = (fromKey, toKey) => {
    const nav = navRef.current;
    const from = flagRefs.current[fromKey], to = flagRefs.current[toKey];
    if (!nav || !from || !to) return null;
    const nb = nav.getBoundingClientRect();
    const center = (el) => { const r = el.getBoundingClientRect(); return { x: r.left - nb.left + r.width / 2, y: r.top - nb.top + r.height / 2 }; };
    return { nb, a: center(from), b: center(to) };
  };

  function fly(fromKey, toKey) {
    const plane = planeRef.current, trail = trailRef.current;
    const pos = centers(fromKey, toKey);
    if (!plane || !trail || !pos) return Promise.resolve();
    const { nb, a, b } = pos;
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

  /** Bola quicando da aba ativa até a de destino: 3 quiques decrescentes, girando, squash no contato. */
  function bounce(fromKey, toKey) {
    const ball = ballRef.current;
    const pos = centers(fromKey, toKey);
    if (!ball || !pos) return Promise.resolve();
    const { nb, a, b } = pos;
    const east = b.x > a.x;
    const spin = east ? 720 : -720; // graus totais no percurso
    const lift = nb.height < 60 ? 14 : 22;
    const x = (t) => a.x + (b.x - a.x) * t;
    const y = (t) => a.y + (b.y - a.y) * t; // "chão" acompanha a linha entre os chips
    const at = (off, dy, rotMul, sx = 1, sy = 1, opacity = 1) => ({
      transform: `translate(${x(off)}px, ${y(off) - dy}px) rotate(${spin * off}deg) scale(${sx}, ${sy})`,
      opacity,
      offset: off
    });
    // contatos (squash) e picos alternados; alturas caem a cada quique, como bola perdendo energia
    const frames = [
      { ...at(0, 0, 0, 0.5, 0.5, 0) },
      { ...at(0.04, 2, 1, 1, 1), easing: "ease-out" },
      { ...at(0.2, lift, 1), easing: "ease-in" },            // pico 1
      { ...at(0.36, -1, 1, 1.18, 0.78), easing: "ease-out" }, // quica
      { ...at(0.52, lift * 0.6, 1), easing: "ease-in" },      // pico 2
      { ...at(0.66, -1, 1, 1.14, 0.82), easing: "ease-out" }, // quica
      { ...at(0.78, lift * 0.34, 1), easing: "ease-in" },     // pico 3
      { ...at(0.88, -1, 1, 1.1, 0.86), easing: "ease-out" },  // quica
      { ...at(0.95, lift * 0.16, 1), easing: "ease-in" },     // piquinho final
      { ...at(1, 0, 1, 0.6, 0.6, 0) }                          // "encaixa" na aba e some
    ];
    const anim = ball.animate(frames, { duration: 850, easing: "linear" });
    running.current.push(anim);
    return anim.finished.catch(() => {});
  }

  function pick(e, m) {
    e.preventDefault();
    const current = pending ?? active;
    if (m.key === current) {
      // já está aqui: só sobe ao topo
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const dir = ORDER[m.key] > ORDER[current] ? "east" : "west";
    if (reduceMotion()) {
      onSwitch?.(m.to, dir, { animate: false });
      return;
    }
    cancelAll();
    setPending(m.key);
    // entrando ou saindo do HYPADOS → bola de basquete; entre EUA ⇄ BR → avião
    const useBall = m.key === "hypados" || current === "hypados";
    (useBall ? bounce : fly)(current, m.key);
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
          <span
            className={`mode-flag${m.flag === "ball" ? " ballchip" : ""}`}
            aria-hidden="true"
            ref={(el) => { flagRefs.current[m.key] = el; }}
          >
            {m.flag === "ball" ? <BallSvg className="chip-ball" /> : m.flag}
          </span>
          <span className="mode-text">
            <b>{m.label}</b>
            <small>{m.sub}</small>
          </span>
        </NavLink>
      ))}
      <svg ref={planeRef} className="mode-plane" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" />
      </svg>
      <BallSvg svgRef={ballRef} className="mode-ball" />
    </nav>
  );
}
