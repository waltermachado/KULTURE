import { useState, useEffect, useMemo } from 'react';
import { api } from '../lib/api';

export function SizePicker({ item, onClose, onAdd }) {
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedSize, setSelectedSize] = useState(null);
  const [photo, setPhoto] = useState(0);

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
    if (selectedSize) {
      onAdd(item, selectedSize);
      onClose();
    }
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
                  {item.price != null && <span className="price">{Number(item.price).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</span>}
                </div>
              </div>
              <div className="sp-header">
                <span>Escolha o tamanho</span>
                <span>Numeração BR (US abaixo)</span>
              </div>
              
              <div className="size-grid">
                {product.sizes.length === 0 ? (
                  <div className="sp-error" style={{ gridColumn: '1/-1' }}>Esgotado</div>
                ) : (
                  product.sizes.map((s, i) => (
                    <button
                      key={`${s.nikeSize}-${i}`}
                      className={`size-btn ${selectedSize?.nikeSize === s.nikeSize ? 'selected' : ''}`}
                      disabled={!s.available}
                      onClick={() => setSelectedSize(s)}
                      aria-label={`Tamanho ${s.brLabel || s.nikeSize}${s.approximate ? ' (Aproximado)' : ''}`}
                    >
                      {s.brLabel ? s.brLabel : s.nikeSize}
                      <span className="us">US {s.nikeSize}</span>
                      {s.approximate && <span className="approx">Aprox.</span>}
                    </button>
                  ))
                )}
              </div>

              <div className="sp-footer">
                <button 
                  className="btn-full" 
                  disabled={!selectedSize}
                  onClick={handleAdd}
                  style={{ marginTop: 0 }}
                >
                  Confirmar Tamanho
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
