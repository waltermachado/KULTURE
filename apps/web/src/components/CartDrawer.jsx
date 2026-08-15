import ProductMedia from "./ProductMedia.jsx";
import { brl } from "../lib/format.js";

export default function CartDrawer({ open, onClose, cart, onCheckout }) {
  const { list, total, changeQty } = cart;
  return (
    <aside className={`drawer${open ? " open" : ""}`} aria-hidden={!open} aria-label="Carrinho">
      <div className="drawer-header">
        <h3>&#128722; Seu carrinho</h3>
        <button className="modal-close" onClick={onClose} aria-label="Fechar carrinho">
          &#10005;
        </button>
      </div>
      <div className="drawer-items">
        {list.length === 0 ? (
          <p className="cart-empty">Carrinho vazio... bora encher? &#128293;</p>
        ) : (
          list.map(({ item, qty, sizeInfo, key }) => (
            <div className="cart-item" key={key}>
              <div className="thumb">
                <ProductMedia src={item.img} alt={item.name} color={item.color} />
              </div>
              <div className="cart-item-info">
                <b>{item.name}</b>
                <div style={{ fontSize: '.75rem', color: '#999', margin: '2px 0 4px' }}>
                  Tamanho: BR {sizeInfo?.brLabel || sizeInfo?.nikeSize} {sizeInfo?.approximate ? '(Aprox)' : ''}
                </div>
                <span>{brl(item.price)}</span>
              </div>
              <div className="qty">
                <button onClick={() => changeQty(key, -1)} aria-label="Diminuir">
                  −
                </button>
                <span>{qty}</span>
                <button onClick={() => changeQty(key, 1)} aria-label="Aumentar">
                  +
                </button>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="drawer-footer">
        <div className="total-row" style={{ color: '#888', fontSize: '0.9rem', marginBottom: 4 }}>
          <span>Frete</span>
          <span style={{ color: 'var(--k-green)' }}>Grátis</span>
        </div>
        <div className="total-row">
          <span>Total</span>
          <b>{brl(total)}</b>
        </div>
        <button className="btn-pay" onClick={onCheckout} disabled={list.length === 0}>
          Pagar com InfinitePay <small>· Pix ou 12x</small>
        </button>
      </div>
    </aside>
  );
}
