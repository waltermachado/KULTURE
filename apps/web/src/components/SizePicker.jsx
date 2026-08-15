import { useState, useEffect } from 'react';
import { api } from '../lib/api';

export function SizePicker({ item, onClose, onAdd }) {
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedSize, setSelectedSize] = useState(null);

  useEffect(() => {
    const fetchSizes = async () => {
      try {
        const data = await api.get(`/product/${item.styleColor}`);
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
      <div className="modal open" style={{ maxWidth: '400px' }} role="dialog" aria-modal="true" aria-labelledby="sz-title">
        <div className="modal-header">
          <h3 className="modal-title" id="sz-title" style={{ padding: 0 }}>Tamanho <em>Brasil</em></h3>
          <button className="modal-close" onClick={onClose} aria-label="Fechar modal">×</button>
        </div>
        <div className="tab-panel active">
          {loading && <div className="sp-loading">Buscando tamanhos...</div>}
          {error && <div className="sp-error">{error}</div>}
          
          {product && (
            <div className="size-picker">
              <div className="sp-header">
                <h4 style={{ margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '240px' }}>{product.name}</h4>
                <span>Numeração BR</span>
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
