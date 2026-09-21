import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { ErrorBox, Loading } from './ui.jsx';

export default function Imported({ auth, notify }) {
  const [selected, setSelected] = useState(null);
  const [sync, setSync] = useState(null);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [found, setFound] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let alive = true;
    auth.request('/api/admin/imported').then(d => {
      if (!alive) return;
      const byRef = new Map(d.products.map(p => [p.styleColor, p]));
      setSelected(d.refs ? d.refs.map(ref => byRef.get(ref) || { styleColor: ref, name: 'Indisponível no catálogo — substitua este tênis' }) : d.products);
      setSync(d.sync); setTotal(d.total);
    }).catch(e => { if (alive) setError(e); });
    return () => { alive = false; };
  }, [auth.request]);
  useEffect(() => {
    let alive = true;
    if (!q.trim()) { setFound([]); setSearching(false); return; }
    setSearching(true); setSearchError('');
    const timer = setTimeout(() => {
      api.imported({ q: q.trim(), limit: 24 }).then(d => { if (alive) setFound(d.products); })
        .catch(e => { if (alive) { setFound([]); setSearchError(e.message); } })
        .finally(() => { if (alive) setSearching(false); });
    }, 300);
    return () => { alive = false; clearTimeout(timer); };
  }, [q]);
  const change = next => { setSelected(next); setDirty(true); setSaved(false); };
  const move = (index, delta) => {
    const next = [...selected];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    change(next);
  };
  async function save() {
    setBusy(true); setError(null); setSaved(false);
    try {
      await auth.request('/api/admin/imported/top8', { method: 'PUT', body: JSON.stringify({ refs: selected.map(p => p.styleColor) }) });
      setDirty(false); setSaved(true); notify?.('Top 8 de Importados salvo');
    } catch (e) { setError(e); }
    finally { setBusy(false); }
  }
  if (!selected && !error) return <Loading />;
  return <>
    <header className="adm-head"><h1>Importados</h1><p className="sub">Escolha os oito tênis e a ordem em que aparecem na loja.</p></header>
    {error && <ErrorBox error={error} />}
    {selected && <>
      <p className="adm-note imported-sync">{total} tênis no catálogo local. Atualização a cada hora, das 06h às 00h (Brasília).<br />
        {sync?.lastSuccessAt ? `Última atualização concluída: ${new Date(sync.lastSuccessAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.` : 'Aguardando a primeira sincronização completa.'}
        {sync?.state === 'error' && <span role="status"> A última tentativa falhou. O catálogo anterior foi preservado.</span>}
        {sync?.state === 'running' && <span role="status"> Atualização em andamento.</span>}
      </p>
      <div className="imported-editor-head"><h2>Top 8 · {selected.length}/8</h2><button className="btn primary" disabled={busy || selected.length !== 8 || !dirty} onClick={save}>{busy ? 'Salvando…' : 'Salvar Top 8'}</button></div>
      <p className="adm-note">Remova um tênis para substituí-lo. Use “Subir” e “Descer” para ajustar a ordem. As alterações aparecem na loja ao salvar.</p>
      {saved && <p role="status">Top 8 salvo. A loja já usa essa seleção.</p>}
      <ol className="imported-selection">
        {selected.map((p, i) => <li key={p.styleColor}>
          <span className="imported-position">{i + 1}</span>
          {p.images?.[0] && <img src={p.images[0]} alt="" />}
          <div className="imported-product-name"><strong>{p.name}</strong><span>{p.styleColor}{p.colorDescription ? ` · ${p.colorDescription}` : ''}</span></div>
          <div className="imported-row-actions">
            <button className="btn" disabled={busy || !i} onClick={() => move(i, -1)} aria-label={`Subir ${p.name}`}>Subir</button>
            <button className="btn" disabled={busy || i === selected.length - 1} onClick={() => move(i, 1)} aria-label={`Descer ${p.name}`}>Descer</button>
            <button className="btn" disabled={busy} onClick={() => change(selected.filter((_, j) => j !== i))} aria-label={`Remover ${p.name}`}>Remover</button>
          </div>
        </li>)}
      </ol>
      {!selected.length && <p className="adm-note">Busque no catálogo abaixo para montar sua seleção.</p>}
      <label className="imported-search-label" htmlFor="imported-search">Adicionar tênis do catálogo</label>
      <input id="imported-search" className="imported-search" value={q} onChange={e => setQ(e.target.value)} placeholder="Busque pelo nome ou SKU Nike" maxLength={80} />
      <p className="adm-note" role="status">{searching ? 'Buscando…' : searchError || (q.trim() && !found.length ? 'Nenhum tênis encontrado no catálogo local.' : selected.length === 8 ? 'Sua seleção está completa. Remova um tênis para adicionar outro.' : `${8 - selected.length} posição(ões) disponível(is).`)}</p>
      <ul className="imported-selection">
        {!searching && found.map(p => <li key={p.styleColor}>
          {p.images?.[0] && <img src={p.images[0]} alt="" />}
          <div className="imported-product-name"><strong>{p.name}</strong><span>{p.styleColor} · {p.colorDescription}</span></div>
          <button className="btn" disabled={busy || selected.length >= 8 || selected.some(s => s.styleColor === p.styleColor)} onClick={() => change([...selected, p])}>
            {selected.some(s => s.styleColor === p.styleColor) ? 'Selecionado' : 'Adicionar'}
          </button>
        </li>)}
      </ul>
    </>}
  </>;
}
