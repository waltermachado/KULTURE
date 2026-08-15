import { useCallback, useEffect, useRef, useState } from "react";
import { Routes, Route, useNavigate } from "react-router-dom";
import Header from "./components/Header.jsx";
import Home from "./pages/Home.jsx";
import Checkout from "./pages/Checkout.jsx";
import Confirmation from "./pages/Confirmation.jsx";
import Footer from "./components/Footer.jsx";
import AuthModal from "./components/AuthModal.jsx";
import CartDrawer from "./components/CartDrawer.jsx";
import Toast from "./components/Toast.jsx";
import { SizePicker } from "./components/SizePicker.jsx";
import { useCart } from "./hooks/useCart.js";
import { useAuth } from "./hooks/useAuth.js";
import { api, SEED } from "./lib/api.js";
import { toCard } from "./lib/format.js";

const TOP8_TITLE = (
  <>
    Top 8 <em>mais vendidos</em>
  </>
);
const TOP8_SUB = "// os mais usados na NBA — dados ao vivo via kulture-api (cache 1h)";

export default function App() {
  const navigate = useNavigate();
  const cart = useCart();
  const auth = useAuth();
  const [grid, setGrid] = useState({ status: "loading", products: [], title: TOP8_TITLE, sub: TOP8_SUB, query: "" });
  const [modal, setModal] = useState({ open: false, view: "login" });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedProductForSize, setSelectedProductForSize] = useState(null);
  const [toast, setToast] = useState({ message: "", visible: false });
  const toastTimer = useRef(null);

  const notify = useCallback((message) => {
    setToast({ message, visible: true });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast((t) => ({ ...t, visible: false })), 2200);
  }, []);

  const loadTop8 = useCallback(async () => {
    setGrid((g) => ({ ...g, status: "loading", title: TOP8_TITLE, sub: TOP8_SUB, query: "" }));
    try {
      const d = await api.top8();
      const products = (d.products || []).map(toCard);
      if (!products.length) throw new Error("vazio");
      setGrid({ status: "ok", products, title: TOP8_TITLE, sub: `${TOP8_SUB}${d.cached ? " · cache" : ""}${d.stale ? " · stale" : ""}`, query: "" });
    } catch {
      setGrid({ status: "ok", products: SEED.map(toCard), title: TOP8_TITLE, sub: "// backend offline — mostrando destaques salvos", query: "" });
    }
  }, []);

  const search = useCallback(
    async (q) => {
      if (!q) return loadTop8();
      const title = (
        <>
          Resultados para <em>{q}</em>
        </>
      );
      setGrid({ status: "loading", products: [], title, sub: "// buscando ao vivo na Nike US...", query: q });
      document.getElementById("drops")?.scrollIntoView({ behavior: "smooth", block: "start" });
      try {
        const d = await api.search(q);
        const products = (d.products || []).map(toCard);
        setGrid({
          status: products.length ? "ok" : "empty",
          products,
          title,
          sub: `// ${products.length} resultado(s)${d.cached ? " (cache)" : ""}${d.stale ? " (stale)" : ""}`,
          query: q
        });
      } catch {
        setGrid({ status: "error", products: [], title, sub: "// erro ao buscar", query: q });
      }
    },
    [loadTop8]
  );

  useEffect(() => {
    loadTop8();
  }, [loadTop8]);

  // Esc fecha tudo
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        setModal((m) => ({ ...m, open: false }));
        setDrawerOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const openModal = (view) => {
    setDrawerOpen(false);
    setModal({ open: true, view });
  };
  const closeAll = () => {
    setModal((m) => ({ ...m, open: false }));
    setDrawerOpen(false);
    setSelectedProductForSize(null);
  };
  const addToCart = (p, sizeInfo) => {
    cart.add(p, sizeInfo);
    notify("Adicionado ao carrinho! 🔥");
  };

  const handleLogout = async () => {
    await auth.logout();
    notify("Você saiu da conta");
  };

  const overlayOpen = modal.open || drawerOpen;

  return (
    <>
      <Header
        cartCount={cart.count}
        onOpenCart={() => { setModal((m) => ({ ...m, open: false })); setDrawerOpen(true); }}
        onOpenLogin={() => openModal("login")}
        onSearch={(q) => { search(q); navigate('/'); }}
        user={auth.user}
        onLogout={handleLogout}
      />
      <Routes>
        <Route path="/" element={<Home grid={grid} setSelectedProductForSize={setSelectedProductForSize} />} />
        <Route path="/checkout" element={<Checkout cart={cart} auth={auth} notify={notify} />} />
        <Route path="/pedido/confirmacao" element={<Confirmation auth={auth} />} />
      </Routes>
      <Footer onOpenModal={openModal} />

      <div className={`overlay${overlayOpen ? " open" : ""}`} onClick={closeAll} />
      <AuthModal open={modal.open} view={modal.view} onSwitch={(view) => setModal({ open: true, view })} onClose={closeAll} notify={notify} auth={auth} />
      {selectedProductForSize && (
        <SizePicker 
          item={selectedProductForSize} 
          onClose={() => setSelectedProductForSize(null)} 
          onAdd={addToCart} 
        />
      )}
      <CartDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} cart={cart} onCheckout={() => { setDrawerOpen(false); navigate("/checkout"); }} />
      <Toast message={toast.message} visible={toast.visible} />
    </>
  );
}
