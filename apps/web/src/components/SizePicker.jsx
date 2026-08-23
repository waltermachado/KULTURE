import { useState, useEffect, useMemo } from 'react';
import { api } from '../lib/api';
import { launchDateLabel, sizeText, customKey, BY_YOU_DELIVERY_DAYS } from '../lib/format.js';

const EMPTY_CUSTOM = { textLeft: '', numberLeft: '', textRight: '', numberRight: '' };
const CUSTOM_RE = /[^A-Za-z0-9 .,'&!?#-]/g;

export function SizePicker({ item, onClose, onAdd }) {
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedSize, setSelectedSize] = useState(null);
  const [photo, setPhoto] = useState(0);
  const [custom, setCustom] = useState(EMPTY_CUSTOM); // Nike By You: gravação por pé
  const isByYou = Boolean(product?.byYou);
  const textMax = product?.customization?.textMax || 8;
  const setC = (k, v) => setCustom((c) => ({ ...c, [k]: k.startsWith('number') ? v.replace(/\D/g, '').slice(0, 2) : v.replace(CUSTOM_RE, '').slice(0, textMax) }));
  // O cliente só vê numeração BR — o US (modelagem M/W/K) é informação interna, fica no pedido para o backoffice.
  // Um tamanho sem BR na tabela (não deveria acontecer: as tabelas cobrem até M 18 / W 19,5) não entra na grade,
  // porque a única forma de mostrá-lo seria pelo US.
  const visibleSizes = useMemo(() => (product?.sizes || []).filter((s) => s.brLabel != null && String(s.brLabel).trim() !== ''), [product]);

  // galeria: fotos espelhadas pela api (vários ângulos); fallback = foto do card
  const gallery = useMemo(() => {
    const list = Array.isArray(product?.images) && product.images.length ? product.images : item.img ? [item.img] : [];
    return list;
  }, [product, item.img]);
  const prevPhoto = () => setPhoto((i) => (gallery.length ? (i - 1 + gallery.length) % gallery.length : 0));
  const nextPhoto = () => setPhoto((i) => (gallery.length ? (i + 1) % gallery.length : 0));

  // setas do teclado navegam a galeria
  useEffect(() => {
    if (gallery.length < 2) return;
    const onKey = (e) => {
      if (e.key === 'ArrowLeft') prevPhoto();
      if (e.key === 'ArrowRight') nextPhoto();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [gallery.length]);

  useEffect(() => {
    const fetchSizes = async () => {
      try {
        const data = await api.product(item.styleColor);
        setProduct(data.product);
      } catch (err) {
        setError(err.message || 'Falha ao buscar tamanhos disponíveis.');
      } finally {
        setLoading(false);
      }
    };
    fetchSizes();
  }, [item.styleColor]);

  const handleAdd = () => {
    if (!selectedSize) return;
    const customization = isByYou && Object.values(custom).some((v) => String(v).trim()) ? { ...custom } : null;
    const picked = {
      ...selectedSize,
      sizeLabel: sizeText(selectedSize), // "BR 38" — só o BR na sacola/checkout; o US entra no pedido pela api (escala do SKU)
      ...(customization ? { customization, customKey: customKey(customization) } : {})
    };
    onAdd(item, picked);
    onClose();
  };

  return (
    <>
      <div className="overlay open" onClick={onClose} aria-hidden="true"></div>
      <div className="modal open modal-wide" role="dialog" aria-modal="true" aria-labelledby="sz-title">
        <div className="modal-header">
          <h3 className="modal-title" id="sz-title" style={{ padding: 0, fontSize: 12, letterSpacing: ".24em", color: "var(--yellow)" }}>Escolha o tamanho <em>· numeração BR</em></h3>
          <button className="modal-close" onClick={onClose} aria-label="Fechar modal">×</button>
        </div>
        <div className="tab-panel active">
          {loading && <div className="sp-loading">Buscando tamanhos...</div>}
          {product?.byYou && <div className="sp-launch sp-byyou-flag"><b>Nike By You</b> — modelo customizável, feito sob encomenda: até {BY_YOU_DELIVERY_DAYS} dias para entrega. A Nike não informa estoque por tamanho; escolha o seu número abaixo.</div>}
          {error && <div className="sp-error">{error}</div>}
          
          {product && (
            <div className="size-picker">
              {/* foto do tênis escolhido no topo */}
              <div className="sp-hero">
                <div className="sp-gallery">
                  <div className="sp-hero-img">
                    {gallery[photo] ? <img key={gallery[photo]} src={gallery[photo]} alt={`${product.name} — foto ${photo + 1} de ${gallery.length}`} /> : null}
                    {gallery.length > 1 && (
                      <>
                        <button type="button" className="sp-arrow prev" onClick={prevPhoto} aria-label="Foto anterior">‹</button>
                        <button type="button" className="sp-arrow next" onClick={nextPhoto} aria-label="Próxima foto">›</button>
                        <span className="sp-count">{photo + 1}/{gallery.length}</span>
                      </>
                    )}
                  </div>
                  {gallery.length > 1 && (
                    <div className="sp-thumbs" role="tablist" aria-label="Fotos do produto">
                      {gallery.map((src, i) => (
                        <button key={src} type="button" role="tab" aria-selected={i === photo} className={`sp-thumb${i === photo ? ' active' : ''}`} onClick={() => setPhoto(i)} aria-label={`Foto ${i + 1}`}>
                          <img src={src} alt="" loading="lazy" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="sp-hero-info">
                  <span className="card-brand">{item.brand || "Nike"}</span>
                  <h4>{product.name}</h4>
                  {product.subtitle && <span className="sp-sub">{product.subtitle}</span>}
                  {item.price != null && (
                    <span className="price">
                      {Number(item.price).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                      {(item.pix ?? product.price?.pix) && <span className="pix-tag">no Pix</span>}
                    </span>
                  )}
                  {(item.installmentsLabel || product.price?.installments?.label) && (
                    <span className="sp-sub" style={{ textTransform: "none", letterSpacing: 0 }}>ou {item.installmentsLabel || product.price.installments.label}</span>
                  )}
                  {product.source === "stock" && (
                    <span className="sp-launch sp-stock">
                      <b>{product.section === "hypados" ? "Hypados · pronta entrega" : "Pronta entrega"}</b>
                      {product.stock?.total === 1 ? " — último par! Está no Brasil e sai assim que o pagamento cair." : " — está no Brasil e sai assim que o pagamento cair, sem espera de importação."}
                    </span>
                  )}
                  {product.source === "stock" && product.description && (
                    <p className="sp-desc">{product.description}</p>
                  )}
                  {product.launch?.comingSoon && (
                    <span className="sp-launch">
                      <b>Pré-venda</b>
                      {launchDateLabel(product.launch.date)
                        ? ` — lançamento na Nike US em ${launchDateLabel(product.launch.date)}. Compramos assim que liberar e te avisamos.`
                        : " — lançamento em breve na Nike US. Compramos assim que liberar e te avisamos."}
                    </span>
                  )}
                </div>
              </div>
              <div className="sp-header">
                <span>Escolha o tamanho</span>
                <span>{isByYou ? "Numeração BR · você indica o seu número" : product.source === "stock" ? "Numeração BR · estoque por tamanho" : "Numeração BR"}</span>
              </div>

              <div className="size-grid">
                {visibleSizes.length === 0 ? (
                  <div className="sp-error" style={{ gridColumn: '1/-1' }}>Esgotado</div>
                ) : (
                  visibleSizes.map((s, i) => (
                    // só o BR no chip; na pronta entrega a linha de baixo é a quantidade em estoque
                    <button
                      key={`${s.nikeSize}-${i}`}
                      className={`size-btn ${selectedSize?.nikeSize === s.nikeSize ? 'selected' : ''}`}
                      disabled={!s.available}
                      onClick={() => setSelectedSize(s)}
                      aria-label={`Tamanho BR ${s.brLabel}`}
                    >
                      {s.brLabel}
                      {product.source === "stock" && <span className="us">{s.qty === 1 ? "último" : `${s.qty} un.`}</span>}
                    </button>
                  ))
                )}
              </div>

              {/* Nike By You: sem tamanhos na Nike → o cliente indica o número e personaliza (texto ≤ 8 + nº 2 dígitos por pé) */}
              {isByYou && (
                <div className="sp-byyou">
                  <div className="sp-byyou-head">
                    <b>Nike By You · personalize</b>
                    <span>Opcional. Até {textMax} caracteres e um número de 2 dígitos em cada pé — como você digitar aqui, a gente configura na Nike.</span>
                  </div>
                  <div className="sp-byyou-grid">
                    {[["Left", "Pé esquerdo"], ["Right", "Pé direito"]].map(([side, label]) => (
                      <fieldset key={side} className="sp-foot">
                        <legend>{label}</legend>
                        <label>
                          <span>Texto <small>{custom[`text${side}`].length}/{textMax}</small></span>
                          <input type="text" value={custom[`text${side}`]} maxLength={textMax} placeholder="Ex.: KULTURE" onChange={(e) => setC(`text${side}`, e.target.value)} autoComplete="off" spellCheck={false} style={{ textTransform: 'uppercase' }} />
                        </label>
                        <label className="sp-num">
                          <span>Número</span>
                          <input type="text" inputMode="numeric" value={custom[`number${side}`]} maxLength={2} placeholder="00" onChange={(e) => setC(`number${side}`, e.target.value)} autoComplete="off" />
                        </label>
                      </fieldset>
                    ))}
                  </div>
                  <p className="sp-byyou-note">
                    Produto sob encomenda na Nike By You: <b>prazo de até {BY_YOU_DELIVERY_DAYS} dias para entrega</b>, maior que o dos
                    importados de linha. A gente confirma com você o tamanho e a gravação antes de fechar a compra nos EUA. Deixe em
                    branco para o par sem gravação.
                  </p>
                </div>
              )}

              <div className="sp-footer">
                <button 
                  className="btn-full" 
                  disabled={!selectedSize}
                  onClick={handleAdd}
                  style={{ marginTop: 0 }}
                >
                  {selectedSize ? `Confirmar · ${sizeText(selectedSize)}` : 'Confirmar Tamanho'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
