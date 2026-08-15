import { useState } from "react";

export default function Header({ cartCount, onOpenCart, onOpenLogin, onSearch, user, onLogout }) {
  const [q, setQ] = useState("");

  function submit(e) {
    e.preventDefault();
    onSearch(q.trim());
  }

  return (
    <header>
      <div className="header-inner">
        <a className="logo" href="#top" aria-label="Kulture — início">
          Kulture
        </a>
        <nav aria-label="Categorias">
          <a href="#drops">Drops</a>
          <a href="#drops" onClick={() => onSearch("basketball shoes")}>Basquete</a>
          <a href="#drops" onClick={() => onSearch("lifestyle shoes")}>Lifestyle</a>
          <a href="#drops">Promos</a>
        </nav>
        <div className="header-actions">
          <form className="search-box" onSubmit={submit} role="search">
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar tênis..."
              autoComplete="off"
              aria-label="Buscar tênis"
            />
            <button type="submit" title="Buscar" aria-label="Buscar">
              &#128269;
            </button>
          </form>
          <button className="cart-btn" onClick={onOpenCart} title="Carrinho" aria-label={`Carrinho, ${cartCount} itens`}>
            &#128722;
            <span className="cart-count">{cartCount}</span>
          </button>
          {user ? (
            <div className="user-menu">
              <span className="user-greeting" title={user.email}>
                {user.name.split(" ")[0]}
              </span>
              <button className="btn-login btn-logout" onClick={onLogout} title="Sair">
                Sair
              </button>
            </div>
          ) : (
            <button className="btn-login" onClick={onOpenLogin}>
              Entrar
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
