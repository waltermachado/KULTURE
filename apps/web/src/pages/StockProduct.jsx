import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import ProductMedia from "../components/ProductMedia.jsx";
import WhatsappCta from "../components/WhatsappCta.jsx";
import { api } from "../lib/api.js";
import { brl, toCard, sizeText, HYPADOS_DELIVERY_LABEL } from "../lib/format.js";

/** Seções de estoque próprio — caminho, nome e selo (mesmos de STOCK_SECTIONS na api). */
const SECTION = {
  stock: { path: "/pronta-entrega", label: "Pronta entrega", badge: "PRONTA ENTREGA" },
  hypados: { path: "/hypados", label: "Hypados", badge: "HYPADOS" }
};

/**
 * Página própria de um tênis de estoque próprio — /pronta-entrega/:ref e /hypados/:ref (ref = slug da URL ou
 * code PE-/HY-). Sem modal: é o link que o dono cola no Instagram para a pessoa cair direto no par e comprar.
 * Lê GET /api/stock/:ref (todos os tamanhos, com quantidade); "Comprar agora" põe na sacola e vai ao checkout.
 * A seção da URL não manda: se o par é hypado e o link veio como /pronta-entrega/…, a URL é corrigida (replace).
 */
export default function StockProduct({ section = "stock", onAdd, onOpenCart, notify }) {
  const { ref } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [state, setState] = useState({ status: "loading", product: null });
  const [size, setSize] = useState(null);
  const [photo, setPhoto] = useState(0);

  useEffect(() => {
    let alive = true;
    setState({ status: "loading", product: null });
    setSize(null);
    setPhoto(0);
    window.scrollTo({ top: 0, behavior: "instant" });
    api
      .stockProduct(ref)
      .then((d) => { if (alive) setState({ status: "ok", product: d.product }); })
      .catch((e) => { if (alive) setState({ status: e?.status === 404 ? "gone" : "error", product: null }); });
    return () => { alive = false; };
  }, [ref]);

  const product = state.product;
  const sec = SECTION[product?.section] || SECTION[section] || SECTION.stock;

  // URL canônica: /hypados/slug para hypado, /pronta-entrega/slug para pronta entrega (também troca code → slug)
  useEffect(() => {
    if (product?.path && product.path !== location.pathname) navigate({ pathname: product.path, search: location.search }, { replace: true });
  }, [product?.path, location.pathname, location.search, navigate]);

  // título da aba (o preview do link — Open Graph — é montado pela api ao servir o index.html)
  useEffect(() => {
    const prev = document.title;
    if (product) document.title = `${product.name} — ${brl(product.price?.brl)} no Pix | Kulture`;
    return () => { document.title = prev; };
  }, [product]);

  const card = useMemo(() => (product ? toCard(product, 0) : null), [product]);
  const gallery = useMemo(() => (Array.isArray(product?.images) ? product.images.filter(Boolean) : []), [product]);
  const sizes = product?.sizes || [];
  const soldOut = !product || !(product.stock?.total > 0) || sizes.every((s) => !s.available);
  const installments = product?.price?.installments?.label || null;

  const prevPhoto = () => setPhoto((i) => (gallery.length ? (i - 1 + gallery.length) % gallery.length : 0));
  const nextPhoto = () => setPhoto((i) => (gallery.length ? (i + 1) % gallery.length : 0));
  useEffect(() => {
    if (gallery.length < 2) return;
    const onKey = (e) => {
      if (e.key === "ArrowLeft") prevPhoto();
      if (e.key === "ArrowRight") nextPhoto();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [gallery.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const picked = () => ({ ...size, sizeLabel: sizeText(size) }); // só o BR — o US fica no pedido, para o backoffice
  const buyNow = () => {
    if (!size || !card) return;
    onAdd?.(card, picked());
    navigate("/checkout");
  };
  const addToBag = () => {
    if (!size || !card) return;
    onAdd?.(card, picked());
    onOpenCart?.();
  };
  const share = async () => {
    if (!product) return;
    const url = `${window.location.origin}${product.path}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: product.name, text: `${product.name} — ${brl(product.price?.brl)} no Pix · Kulture`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      notify?.("Link copiado! 🔗");
    } catch {
      /* compartilhamento cancelado / sem permissão */
    }
  };

  if (state.status === "loading") {
    return (
      <section className="pp">
        <nav className="pp-crumbs"><Link to={sec.path}>← {sec.label}</Link></nav>
        <p className="grid-msg">Carregando o par…</p>
      </section>
    );
  }

  if (state.status !== "ok" || !product) {
    const gone = state.status === "gone";
    return (
      <section className="pp">
        <nav className="pp-crumbs"><Link to={sec.path}>← {sec.label}</Link></nav>
        <div className="pp-gone">
          <div className="kicker">{gone ? "Já foi" : "Ops"}</div>
          <h1>{gone ? <>Este par <em>não está mais disponível</em></> : <>Não deu para <em>carregar o par</em></>}</h1>
          <p>
            {gone
              ? "Ele saiu do estoque ou o link mudou. Dá uma olhada no que está disponível agora — ou chama no WhatsApp que a gente caça pra você."
              : "Tente de novo em instantes."}
          </p>
          <Link className="btn-cta" to={sec.path}><span>Ver {sec.label.toLowerCase()}</span><span className="arrow">→</span></Link>
        </div>
        <WhatsappCta variant="strip" context="stock" />
      </section>
    );
  }

  const badgeLabel = product.badge || sec.badge;
  const badgeClass = product.badge ? " red" : product.section === "hypados" ? " hypados" : " stock";

  return (
    <section className="pp">
      <nav className="pp-crumbs" aria-label="Você está em">
        <Link to={sec.path}>← {sec.label}</Link>
        {product.categoryLabel && (
          <>
            <span className="sep">/</span>
            <Link to={{ pathname: sec.path, search: `?cat=${product.category}` }}>{product.categoryLabel}</Link>
          </>
        )}
        <span className="here"><span className="sep">/</span>{product.name}</span>
      </nav>

      <div className="pp-grid">
        {/* galeria */}
        <div className="pp-gallery">
          <div className="sp-hero-img">
            {gallery[photo]
              ? <img key={gallery[photo]} src={gallery[photo]} alt={`${product.name} — foto ${photo + 1} de ${gallery.length}`} />
              : <ProductMedia src="" alt={product.name} color="#F6B234" />}
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
                <button key={src} type="button" role="tab" aria-selected={i === photo} className={`sp-thumb${i === photo ? " active" : ""}`} onClick={() => setPhoto(i)} aria-label={`Foto ${i + 1}`}>
                  <img src={src} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* informações + tamanhos + compra */}
        <div className="pp-info">
          <div className="pp-top">
            <span className="card-brand">{product.brand || "Nike"}</span>
            <span className="card-flags">
              <span className={`badge${badgeClass}`}>{badgeLabel}</span>
              {product.section === "hypados" && <span className="card-eta">{HYPADOS_DELIVERY_LABEL}</span>}
            </span>
          </div>
          <h1>{product.name}</h1>
          {(product.categoryLabel || product.colorDescription) && (
            <span className="pp-sub">{[product.categoryLabel, product.colorDescription].filter(Boolean).join(" · ")}</span>
          )}
          <div className="pp-price">
            <span className="price">{brl(product.price?.brl)}<span className="pix-tag">no Pix</span></span>
            {product.price?.fullBrl && <span className="price-old">{brl(product.price.fullBrl)}</span>}
          </div>
          {installments && <span className="pp-inst">ou {installments}</span>}
          <span className={`sp-launch ${product.section === "hypados" ? "sp-hypados" : "sp-stock"}`}>
            <b>{sec.label}</b>
            {product.section === "hypados"
              ? soldOut
                ? " — esgotado no momento. Chama no WhatsApp que a gente garimpa o seu grail."
                : product.stock?.total === 1
                  ? ` — último par disponível! Difícil de achar: garimpado nos EUA pelos contatos Kulture BR e importado pra você assim que o pagamento cair. ${HYPADOS_DELIVERY_LABEL}.`
                  : ` — difícil de achar: garimpado nos EUA pelos contatos Kulture BR e importado pra você assim que o pagamento cair. ${HYPADOS_DELIVERY_LABEL}. Frete grátis.`
              : soldOut
                ? " — esgotado no momento. Chama no WhatsApp que a gente avisa quando voltar ou importa pra você."
                : product.stock?.total === 1
                  ? " — último par! Está no Brasil e sai assim que o pagamento cair."
                  : " — está no Brasil e sai assim que o pagamento cair, sem espera de importação. Frete grátis."}
          </span>
          {product.description && <p className="pp-desc">{product.description}</p>}

          <div className="sp-header pp-sizes-head">
            <span>Escolha o tamanho</span>
            <span>Numeração BR · estoque por tamanho</span>
          </div>
          <div className="size-grid">
            {sizes.length === 0 ? (
              <div className="sp-error" style={{ gridColumn: "1/-1" }}>Esgotado</div>
            ) : (
              sizes.map((s, i) => (
                <button
                  key={`${s.nikeSize}-${i}`}
                  type="button"
                  className={`size-btn ${size?.nikeSize === s.nikeSize ? "selected" : ""}`}
                  disabled={!s.available}
                  onClick={() => setSize(s)}
                  aria-label={`Tamanho BR ${s.brLabel}${s.available ? "" : " (esgotado)"}`}
                >
                  {s.brLabel}
                  <span className="us">{!s.available ? "esgotado" : s.qty === 1 ? "último" : `${s.qty} un.`}</span>
                </button>
              ))
            )}
          </div>

          <div className="pp-actions">
            {soldOut ? (
              <button className="btn-full" type="button" disabled>Esgotado</button>
            ) : (
              <>
                <button className="btn-full" type="button" onClick={buyNow} disabled={!size}>
                  {size ? `Comprar agora · ${sizeText(size)}` : "Escolha um tamanho"} <span>→</span>
                </button>
                <button className="btn-ghost" type="button" onClick={addToBag} disabled={!size}>Adicionar à sacola</button>
              </>
            )}
            <button className="pp-share" type="button" onClick={share} aria-label="Compartilhar este par">
              🔗 {typeof navigator !== "undefined" && navigator.share ? "Compartilhar" : "Copiar link"}
            </button>
          </div>
          <ul className="pp-trust">
            <li>100% original · na caixa</li>
            {product.section === "hypados"
              ? <li>Garimpado nos EUA · contatos Kulture BR</li>
              : <li>Em estoque no Brasil · envio imediato</li>}
            <li>Frete grátis · Pix ou cartão</li>
          </ul>
        </div>
      </div>

      <WhatsappCta variant="strip" query="" context="stock" />
    </section>
  );
}
