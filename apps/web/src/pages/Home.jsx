import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Hero from "../components/Hero.jsx";
import Marquee from "../components/Marquee.jsx";
import ProductGrid from "../components/ProductGrid.jsx";
import Features from "../components/Features.jsx";
import { api } from "../lib/api.js";
import { toCard, CATEGORIES } from "../lib/format.js";

export default function Home({ grid, setSelectedProductForSize, onCategory }) {
  const [params, setParams] = useSearchParams();
  const size = params.get('tam') || '';
  const q = grid.query || '';
  const heroCat = CATEGORIES.find(c => c.q === q)?.key || null;
  const [pinned, setPinned] = useState(null);
  const [sizes, setSizes] = useState([]);
  const [sizeStatus, setSizeStatus] = useState('loading');
  const [result, setResult] = useState({ status: 'loading', products: [], total: 0 });
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const filtered = Boolean(q || size);
  useEffect(() => { setPage(0); }, [q, size]);
  useEffect(() => {
    let alive = true;
    api.featured('import', heroCat).then(d => { if (alive) setPinned(d.product ? toCard(d.product) : null); })
      .catch(() => { if (alive) setPinned(null); });
    return () => { alive = false; };
  }, [heroCat]);
  useEffect(() => {
    let alive = true;
    const load = () => api.imported({ q, limit: 1 }).then(d => {
      if (alive) { setSizes(d.sizes || []); setSizeStatus('ok'); }
    }).catch(() => { if (alive) setSizeStatus('error'); });
    setSizeStatus('loading');
    void load();
    const timer = setInterval(load, 60_000);
    window.addEventListener('focus', load);
    return () => { alive = false; clearInterval(timer); window.removeEventListener('focus', load); };
  }, [q, refresh]);
  useEffect(() => {
    let alive = true;
    setResult({ status: 'loading', products: [], total: 0 });
    (filtered ? api.imported({ q, size, offset: page * 48 }) : api.top8())
      .then(d => { if (alive) setResult({ ...d, status: d.products.length ? 'ok' : 'empty', products: d.products.map(toCard) }); })
      .catch(() => { if (alive) setResult({ status: 'error', products: [], total: 0 }); });
    return () => { alive = false; };
  }, [q, size, page, filtered, refresh]);
  const setSize = value => {
    const next = new URLSearchParams(params);
    if (value) next.set('tam', value); else next.delete('tam');
    setPage(0); setParams(next);
  };
  const featured = (!q || heroCat) && !size ? pinned || result.products[0] : null;
  const state = { ...result, query: q,
    title: filtered ? <>Tênis {size ? <em>no tamanho {size}</em> : <em>para você</em>}</> : <>Top 8 <em>mais vendidos</em></>,
    sub: filtered ? `${result.total} modelo(s)${q ? ` · ${q}` : ''}` : 'Os favoritos da quadra, selecionados para você.' };
  return <>
    <div className="import-size-filter">
      <label htmlFor="import-size">Encontre seu tamanho <span>Numeração BR</span></label>
      <select id="import-size" value={size} onChange={e => setSize(e.target.value)} disabled={sizeStatus === 'loading' && !sizes.length} aria-describedby="import-size-note">
        <option value="">Todos os tamanhos</option>
        {sizes.map(s => <option key={s.br} value={s.br}>BR {s.br} · {s.count} modelo(s)</option>)}
        {size && !sizes.some(s => s.br === size) && <option value={size}>BR {size} · sem disponibilidade</option>}
      </select>
      <span id="import-size-note" role="status">{sizeStatus === 'loading' ? 'Carregando tamanhos…' : sizeStatus === 'error' ? 'Não foi possível atualizar os tamanhos.' : sizes.length ? 'Escolha antes de buscar seu próximo par.' : 'Nenhum tamanho disponível no momento.'}</span>
      {size && <button className="cat-chip" onClick={() => setSize('')}>Limpar tamanho</button>}
      {sizeStatus === 'error' && <button className="cat-chip" onClick={() => setRefresh(n => n + 1)}>Tentar novamente</button>}
    </div>
    <Hero featured={featured} onPick={setSelectedProductForSize} />
    <Marquee />
    <ProductGrid state={state} onAdd={setSelectedProductForSize} loadingMsg="Carregando tênis…" emptyMsg={filtered ? 'Nenhum tênis disponível para esses filtros. Experimente outro tamanho ou busca.' : 'A seleção de importados está sendo atualizada. Volte em instantes.'} />
    {result.status === 'error' && <div className="import-pagination"><button className="cat-chip" onClick={() => setRefresh(n => n + 1)}>Tentar novamente</button></div>}
    {filtered && result.total > 48 && <nav className="import-pagination" aria-label="Páginas de tênis">
      <button className="cat-chip" disabled={!page} onClick={() => setPage(n => n - 1)}>Anterior</button>
      <span>Página {page + 1} de {Math.ceil(result.total / 48)}</span>
      <button className="cat-chip" disabled={(page + 1) * 48 >= result.total} onClick={() => setPage(n => n + 1)}>Próxima</button>
    </nav>}
    <Features onCategory={onCategory} />
  </>;
}
