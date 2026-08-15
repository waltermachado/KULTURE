import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Carrinho local (Fase 3 move para o servidor: guest por cookie + merge no login).
 * Chaveado por styleColor (nunca por nome — colorways diferentes não podem colidir).
 * Persistido em localStorage para sobreviver a reload.
 */
const KEY = "kulture:cart:v1";

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function useCart() {
  const [items, setItems] = useState(load); // key -> { item, qty }

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(items));
    } catch {
      /* quota / modo privado */
    }
  }, [items]);

  const add = useCallback((item) => {
    setItems((prev) => {
      const cur = prev[item.key];
      return { ...prev, [item.key]: { item, qty: (cur?.qty ?? 0) + 1 } };
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
