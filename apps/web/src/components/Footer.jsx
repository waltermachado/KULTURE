export default function Footer({ onOpenModal }) {
  const link = (view, label) => (
    <a
      href="#"
      onClick={(e) => {
        e.preventDefault();
        onOpenModal(view);
      }}
    >
      {label}
    </a>
  );
  return (
    <footer>
      <div className="footer-inner">
        <div>
          <span className="footer-logo">Kulture</span>
          <p className="footer-note">Cultura de rua, basquete e os sneakers mais quentes dos EUA. Direto pra sua porta.</p>
          <div className="footer-tag-wrap">
            <span className="pay-tag">&#128274; Pagamentos via InfinitePay</span>
          </div>
        </div>
        <div>
          <h4>Loja</h4>
          <a href="#drops">Drops</a>
          <a href="#drops">Basquete</a>
          <a href="#drops">Lifestyle</a>
          <a href="#drops">Promoções</a>
        </div>
        <div>
          <h4>Conta</h4>
          {link("login", "Entrar")}
          {link("signup", "Criar cadastro")}
          {link("track", "Rastrear pedido")}
        </div>
        <div>
          <h4>Ajuda</h4>
          <a href="#">Trocas e devoluções</a>
          <a href="#">Prazos de entrega</a>
          <a href="#">Fale conosco</a>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} Kulture. Todos os direitos reservados.</span>
        <span>Preços em BRL já incluem frete internacional e comissão · câmbio ao vivo</span>
      </div>
    </footer>
  );
}
