import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";

const TABS = [
  { label: "Início", q: "" },
  { label: "Basquete", q: "basketball shoes" },
  { label: "Casual", q: "lifestyle shoes" },
  { label: "Corrida", q: "running shoes" }
];

export default function Header({ cartCount, onOpenCart, onOpenLogin, onSearch, user, onLogout }) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState("Início");
  const navigate = useNavigate();
  const location = useLocation();

  function submit(e) {
    e.preventDefault();
    setActive("");
    onSearch(q.trim());
  }
  function tab(t) {
    setActive(t.label);
    if (location.pathname !== "/") navigate("/");
    onSearch(t.q);
  }

  return (
    <header className="nav">
      <div className="nav-inner">
        <a className="nav-logo" href="/" aria-label="Kulture BR — início" onClick={(e) => { e.preventDefault(); tab(TABS[0]); }}>
          <img src="/logo.png" alt="Kulture BR" />
        </a>
        <nav className="nav-tabs" aria-label="Categorias">
          {TABS.map((t) => (
            <button key={t.label} className={active === t.label ? "active" : ""} onClick={() => tab(t)}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="nav-actions">
          <form className="search-box" onSubmit={submit} role="search">
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar modelo" autoComplete="off" aria-label="Buscar modelo" />
            <button type="submit" title="Buscar" aria-label="Buscar">→</button>
          </form>
          {user ? (
            <div className="user-menu">
              <span className="user-greeting" title={user.email}>{user.name.split(" ")[0]}</span>
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
