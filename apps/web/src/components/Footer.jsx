import { Link } from "react-router-dom";

export default function Footer({ onOpenModal, onSearch, onCategory }) {
  const link = (view, label) => (
    <button className="foot-link" key={label} onClick={() => onOpenModal(view)}>{label}</button>
  );
  // categorias respeitam a seção atual (pronta entrega filtra; importados busca); "Jordan" é só busca na Nike
  const cat = (q, label, key = null) => (
    <button className="foot-link" key={label} onClick={() => (key ? onCategory?.({ key, q, label }) : onSearch?.(q))}>{label}</button>
  );
  return (
    <footer>
      <div className="footer-inner">
        <div>
          <span className="footer-logo"><img src="/logo.png" alt="Kulture BR" /></span>
          <p className="footer-note">Sneakers de basquete, corrida e casual — curadoria e autenticidade, importados dos EUA com envio para todo o Brasil.</p>
          <div className="footer-tag-wrap">
            <a className="footer-btn" href="https://wa.me/5585992578888" target="_blank" rel="noreferrer">WhatsApp</a>
            <a className="footer-btn" href="https://instagram.com/kulturebr" target="_blank" rel="noreferrer">Instagram</a>
          </div>
        </div>
        <div>
          <h4>Loja</h4>
          <Link className="foot-link" to="/pronta-entrega">Pronta entrega (no Brasil)</Link>
          {cat("basketball shoes", "Basquete", "basketball")}
          {cat("lifestyle shoes", "Casual", "lifestyle")}
          {cat("running shoes", "Corrida", "running")}
          {cat("air jordan", "Jordan")}
        </div>
        <div>
          <h4>Conta</h4>
          {link("login", "Entrar")}
          {link("signup", "Criar cadastro")}
          {link("track", "Rastrear pedido")}
        </div>
        <div>
          <h4>Contato</h4>
          <a href="tel:+5585992578888">(85) 99257-8888</a>
          <a href="mailto:contato@kulturebr.com">contato@kulturebr.com</a>
          <span className="foot-link" style={{ cursor: "default" }}>Seg a Sex · 9h às 18h</span>
          <div className="pays">
            {["PIX", "VISA", "MASTER", "ELO", "AMEX"].map((p) => <span key={p}>{p}</span>)}
          </div>
        </div>
      </div>
      <div className="footer-bottom">
        <span>Kulture BR LTDA · 64.579.440/0001-28</span>
        <span>© {new Date().getFullYear()} · Todos os direitos reservados</span>
      </div>
    </footer>
  );
}
