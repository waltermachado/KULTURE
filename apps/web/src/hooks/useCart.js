import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Carrinho local.
 * Chaveado por styleColor + nikeSize.
 * Persistido em localStorage para sobreviver a reload.
 */
const KEY = "kulture:cart:v2";

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function useCart() {
  const [items, setItems] = useState(load); // key -> { item, qty, sizeInfo }

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(items));
    } catch {
      /* quota / modo privado */
    }
  }, [items]);

  const add = useCallback((item, sizeInfo) => {
    if (!sizeInfo) return;
    // By You: a personalização entra na chave (mesmo tamanho com gravações diferentes = linhas diferentes)
    const compositeKey = `${item.styleColor}|${sizeInfo.nikeSize}${sizeInfo.customKey || ""}`;
    
    setItems((prev) => {
      const cur = prev[compositeKey];
      return { ...prev, [compositeKey]: { key: compositeKey, item, sizeInfo, qty: (cur?.qty ?? 0) + 1 } };
    });
  }, []);

  const changeQty = useCallback((key, delta) => {
    setItems((prev) => {
      const cur = prev[key];
      if (!cur) return prev;
      const qty = cur.qty + delta;
      const next = { ...prev };
      if (qty <= 0) delete next[key];
      else next[key] = { ...cur, qty };
      return next;
    });
  }, []);

  const clear = useCallback(() => setItems({}), []);

  const list = useMemo(() => Object.values(items), [items]);
  const count = useMemo(() => list.reduce((s, it) => s + it.qty, 0), [list]);
  const total = useMemo(() => list.reduce((s, it) => s + (it.item.price || 0) * it.qty, 0), [list]);

  return { list, count, total, add, changeQty, clear };
}
