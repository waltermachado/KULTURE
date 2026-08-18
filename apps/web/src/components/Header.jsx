import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { CATEGORIES } from "../lib/format.js";

const TABS = [{ label: "Início", q: "", key: null }, ...CATEGORIES.map((c) => ({ label: c.label, q: c.q, key: c.key }))];

/**
 * Topo: logo · abas (Início / Basquete / Casual / Corrida) · busca · conta · sacola.
 * As abas respeitam a seção: nos importados buscam na Nike; na pronta entrega filtram o estoque (?cat=…) e a
 * página não muda. A aba ativa segue a URL (na pronta entrega = o filtro; nos importados = a última busca por aba).
 */
export default function Header({ cartCount, onOpenCart, onOpenLogin, onSearch, onCategory, user, isAdmin, onLogout }) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState("Início");
  const navigate = useNavigate();
  const location = useLocation();
  const onStock = location.pathname.startsWith("/pronta-entrega");
  const stockCat = onStock ? new URLSearchParams(location.search).get("cat") : null;

  function submit(e) {
    e.preventDefault();
    setActive("");
    onSearch(q.trim());
  }
  function tab(t) {
    setActive(t.label);
    if (onCategory) return onCategory(t.key ? t : null);
    if (location.pathname !== "/") navigate("/");
    onSearch(t.q);
  }
  const isActive = (t) => (onStock ? (stockCat ? t.key === stockCat : t.key === null) : location.pathname === "/" && active === t.label);

  return (
    <header className="nav">
      <div className="nav-inner">
        <a className="nav-logo" href="/" aria-label="Kulture BR — início" onClick={(e) => { e.preventDefault(); tab(TABS[0]); }}>
          <img src="/logo.png" alt="Kulture BR" />
        </a>
        <nav className="nav-tabs" aria-label="Categorias">
          {TABS.map((t) => (
            <button key={t.label} className={isActive(t) ? "active" : ""} onClick={() => tab(t)}>
              {t.label}
            </button>
          ))}
        </nav>
        {/* filho direto da grade: no desktop fica entre as abas e as ações; no mobile (≤640px) desce para uma 2ª linha, largura total */}
        <form className="search-box" onSubmit={submit} role="search">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar modelo"
            autoComplete="off"
            enterKeyHint="search"
            aria-label="Buscar modelo"
          />
          <button type="submit" title="Buscar" aria-label="Buscar">→</button>
        </form>
        <div className="nav-actions">
          {user ? (
            <div className="user-menu">
              {isAdmin && (
                <button className="btn-login btn-admin" onClick={() => navigate("/admin")} title="Backoffice">Admin</button>
              )}
              <button className="user-greeting as-link" title={`Minha conta — ${user.email}`} onClick={() => navigate("/conta")}>
                {user.name.split(" ")[0]}
              </button>
              <button className="btn-login btn-logout" onClick={onLogout} title="Sair">Sair</button>
            </div>
          ) : (
            <button className="btn-login" onClick={onOpenLogin}>Entrar</button>
          )}
          <button className="cart-btn" onClick={onOpenCart} aria-label={`Sacola, ${cartCount} itens`}>
            Sacola <span className="cart-count">{cartCount}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
