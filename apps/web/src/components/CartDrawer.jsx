import ProductMedia from "./ProductMedia.jsx";
import { brl, sizeText, customText } from "../lib/format.js";

export default function CartDrawer({ open, onClose, cart, onCheckout }) {
  const { list, total, changeQty } = cart;
  const installmentsLabel = (list || []).map((l) => l.item?.installmentsLabel).find(Boolean) || null;
  return (
    <aside className={`drawer${open ? " open" : ""}`} aria-hidden={!open} aria-label="Carrinho">
      <div className="drawer-header">
        <h3>Sua sacola</h3>
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
                <b>{item.name}{item.launch?.comingSoon ? <em className="tag-pre">Pré-venda</em> : null}{item.stock ? <em className="tag-pre tag-stock">Pronta entrega</em> : null}</b>
                <span>TAM {sizeText(sizeInfo)}{sizeInfo?.approximate ? ' (aprox.)' : ''} · QTD {qty}</span>
                {customText(sizeInfo?.customization) && <span className="cart-custom">By You · {customText(sizeInfo.customization)}</span>}
                <span className="line-price">{brl(item.price * qty)}</span>
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
          <span>Total no Pix</span>
          <b>{brl(total)}</b>
        </div>
        {installmentsLabel && <div className="total-row" style={{ color: '#888', fontSize: '0.8rem', marginTop: -6, marginBottom: 12, textTransform: 'none', letterSpacing: 0 }}><span>ou {installmentsLabel}</span></div>}
        <button className="btn-pay" onClick={onCheckout} disabled={list.length === 0}>
          <span>Finalizar compra</span><small>Pix ou cartão · frete grátis</small>
        </button>
      </div>
    </aside>
  );
}
