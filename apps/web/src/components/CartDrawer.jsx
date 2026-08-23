import { useEffect, useState } from "react";
import ProductMedia from "./ProductMedia.jsx";
import { api } from "../lib/api.js";
import { brl, sizeText, customText } from "../lib/format.js";

export default function CartDrawer({ open, onClose, cart, onCheckout }) {
  const { list, total, changeQty, coupon, setCoupon } = cart;
  const installmentsLabel = (list || []).map((l) => l.item?.installmentsLabel).find(Boolean) || null;
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [applied, setApplied] = useState(null); // { code, description, discountBrl } quando o cupom vale
  const [couponMsg, setCouponMsg] = useState(null);

  // revalida sempre que abrir a sacola ou o total mudar — o desconto depende do subtotal (mínimo, %)
  useEffect(() => {
    let alive = true;
    if (!coupon || !open || total <= 0) { setApplied(null); if (!coupon) setCouponMsg(null); return; }
    api.validateCoupon(coupon, total)
      .then((r) => { if (!alive) return; if (r.ok) { setApplied(r); setCouponMsg(null); } else { setApplied(null); setCouponMsg(r.message || "Cupom inválido"); } })
      .catch(() => { if (alive) setApplied(null); });
    return () => { alive = false; };
  }, [coupon, total, open]);

  async function applyCoupon(e) {
    e?.preventDefault?.();
    const c = code.trim().toUpperCase();
    if (!c) return;
    setChecking(true); setCouponMsg(null);
    try {
      const r = await api.validateCoupon(c, total);
      if (r.ok) { setCoupon(c); setCode(""); setCouponMsg(null); }
      else setCouponMsg(r.message || "Cupom inválido");
    } catch { setCouponMsg("Não deu para conferir o cupom agora — tente de novo."); }
    finally { setChecking(false); }
  }
  const discount = applied?.discountBrl || 0;
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
                <span>TAM {sizeText(sizeInfo)} · QTD {qty}</span>
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
        {/* cupom de desconto — logo antes de finalizar */}
        {list.length > 0 && (
          <div className="coupon-box">
            {coupon ? (
              <div className="coupon-applied">
                <span>Cupom <b>{coupon}</b>{applied ? ` — ${applied.description}` : ""}</span>
                <button type="button" onClick={() => { setCoupon(null); setApplied(null); setCouponMsg(null); }} aria-label="Remover cupom">remover</button>
              </div>
            ) : (
              <form className="coupon-form" onSubmit={applyCoupon}>
                <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Cupom de desconto" aria-label="Cupom de desconto" maxLength={30} autoComplete="off" spellCheck={false} />
                <button type="submit" disabled={checking || !code.trim()}>{checking ? "…" : "Aplicar"}</button>
              </form>
            )}
            {couponMsg && <small className="coupon-msg">{couponMsg}</small>}
          </div>
        )}
        <div className="total-row" style={{ color: '#888', fontSize: '0.9rem', marginBottom: 4 }}>
          <span>Frete</span>
          <span style={{ color: 'var(--k-green)' }}>Grátis</span>
        </div>
        {discount > 0 && (
          <div className="total-row" style={{ color: 'var(--k-green)', fontSize: '0.9rem', marginBottom: 4 }}>
            <span>Desconto ({coupon})</span>
            <span>-{brl(discount)}</span>
          </div>
        )}
        <div className="total-row">
          <span>Total no Pix</span>
          <b>{brl(Math.max(0, total - discount))}</b>
        </div>
        {installmentsLabel && <div className="total-row" style={{ color: '#888', fontSize: '0.8rem', marginTop: -6, marginBottom: 12, textTransform: 'none', letterSpacing: 0 }}><span>ou {installmentsLabel}</span></div>}
        <button className="btn-pay" onClick={onCheckout} disabled={list.length === 0}>
          <span>Finalizar compra</span><small>Pix ou cartão · frete grátis</small>
        </button>
      </div>
    </aside>
  );
}
