import { useCallback, useEffect, useRef, useState } from "react";
import { Routes, Route, useNavigate, useLocation } from "react-router-dom";
import Header from "./components/Header.jsx";
import Home from "./pages/Home.jsx";
import Stock from "./pages/Stock.jsx";
import ModeBar from "./components/ModeBar.jsx";
import Checkout from "./pages/Checkout.jsx";
import Confirmation from "./pages/Confirmation.jsx";
import MockInfinitePay from "./pages/MockInfinitePay.jsx";
import Account from "./pages/Account.jsx";
import ResetPassword from "./pages/ResetPassword.jsx";
import AdminApp from "./admin/AdminApp.jsx";
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
  const location = useLocation();
  const isAdminArea = location.pathname === "/admin" || location.pathname.startsWith("/admin/");
  // seletor Importados × Pronta entrega × Hypados só nas páginas de vitrine
  const showModeBar = location.pathname === "/" || location.pathname.startsWith("/pronta-entrega") || location.pathname.startsWith("/hypados");
  const cart = useCart();
  const auth = useAuth();
  const [grid, setGrid] = useState({ status: "loading", products: [], title: TOP8_TITLE, sub: TOP8_SUB, query: "" });
  const [modal, setModal] = useState({ open: false, view: "login" });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedProductForSize, setSelectedProductForSize] = useState(null);
  const [toast, setToast] = useState({ message: "", visible: false });
  const toastTimer = useRef(null);
  const pageRef = useRef(null);      // wrapper das rotas — é ele que desliza na transição EUA ⇄ BR
  const pageAnims = useRef([]);
  const switchToken = useRef(0);

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

  /**
   * Transição entre as vitrines (opção C): a página atual sai para um lado (EUA→BR desliza para a esquerda,
   * BR→EUA para a direita) e a nova entra do lado oposto, enquanto o avião voa na ModeBar. Sobe ao topo na troca.
   * Um novo clique cancela a animação em curso; com prefers-reduced-motion só troca a rota.
   */
  const switchMode = useCallback(async (to, dir, { animate = true } = {}) => {
    const el = pageRef.current;
    const token = ++switchToken.current; // um clique novo invalida o anterior
    const stale = () => switchToken.current !== token;
    pageAnims.current.forEach((a) => { try { a.cancel(); } catch { /* ok */ } });
    pageAnims.current = [];
    const goTo = () => { navigate(to); window.scrollTo({ top: 0, behavior: "instant" }); };
    if (!animate || !el || typeof el.animate !== "function") { goTo(); return; }
    // resolve quando a animação termina OU por tempo — numa aba oculta o navegador não dispara o "finish"
    const settle = (anim, ms) => Promise.race([anim.finished.catch(() => {}), new Promise((r) => setTimeout(r, ms))]);
    const dx = dir === "east" ? -1 : 1; // sai para a esquerda quando vai para o Brasil (leste na barra)
    const dist = window.innerWidth < 640 ? 36 : 48;
    const easing = "cubic-bezier(.4,0,.2,1)";
    const out = el.animate(
      [{ transform: "translateX(0)", opacity: 1 }, { transform: `translateX(${dx * dist}px)`, opacity: 0 }],
      { duration: 260, easing, fill: "forwards" }
    );
    pageAnims.current.push(out);
    await settle(out, 320);
    if (stale()) return;
    goTo();
    const inn = el.animate(
      [{ transform: `translateX(${-dx * dist}px)`, opacity: 0 }, { transform: "translateX(0)", opacity: 1 }],
      { duration: 400, easing, fill: "both" }
    );
    pageAnims.current.push(inn);
    await settle(inn, 460);
    if (stale()) return;
    // libera o transform/opacity (fill) — não deixa containing block em position:fixed nem página presa invisível
    try { out.cancel(); inn.cancel(); } catch { /* ok */ }
    pageAnims.current = [];
  }, [navigate]);

  /**
   * Basquete / Casual / Corrida (abas do topo, blocos de categoria, rodapé) respeitam a seção atual:
   * na pronta entrega filtram o estoque (?cat=…) e ficam na página; nos importados buscam na Nike.
   * `key` null = "Início"/todos.
   */
  const pickCategory = useCallback((cat) => {
    const key = cat?.key ?? null;
    // nas seções de estoque próprio (pronta entrega e hypados) o filtro fica na própria página (?cat=…)
    const stockBase = location.pathname.startsWith("/pronta-entrega") ? "/pronta-entrega" : location.pathname.startsWith("/hypados") ? "/hypados" : null;
    if (stockBase) {
      navigate({ pathname: stockBase, search: key ? `?cat=${key}` : "" });
      setTimeout(() => document.getElementById("drops")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
      return;
    }
    search(cat?.q || "");
    navigate("/");
  }, [location.pathname, navigate, search]);

  const handleLogout = async () => {
    await auth.logout();
    notify("Você saiu da conta");
  };

  const overlayOpen = modal.open || drawerOpen;

  return (
    <>
      {!isAdminArea && (
        <Header
          cartCount={cart.count}
          onOpenCart={() => { setModal((m) => ({ ...m, open: false })); setDrawerOpen(true); }}
          onOpenLogin={() => openModal("login")}
          onSearch={(q) => { search(q); navigate('/'); }}
          onCategory={pickCategory}
          user={auth.user}
          isAdmin={auth.isAdmin}
          onLogout={handleLogout}
        />
      )}
      {showModeBar && <ModeBar onSwitch={switchMode} />}
      <div className="page-view" ref={pageRef}>
      <Routes>
        <Route path="/" element={<Home grid={grid} setSelectedProductForSize={setSelectedProductForSize} onCategory={pickCategory} />} />
        <Route path="/pronta-entrega" element={<Stock section="stock" setSelectedProductForSize={setSelectedProductForSize} onCategory={pickCategory} />} />
        <Route path="/hypados" element={<Stock section="hypados" setSelectedProductForSize={setSelectedProductForSize} onCategory={pickCategory} />} />
        <Route path="/checkout" element={<Checkout cart={cart} auth={auth} notify={notify} onOpenLogin={() => openModal("login")} />} />
        <Route path="/pedido/confirmacao" element={<Confirmation auth={auth} />} />
        <Route path="/pedido/confirmacao/:number" element={<Confirmation auth={auth} />} />
        <Route path="/mock/infinitepay/:number" element={<MockInfinitePay />} />
        <Route path="/conta" element={<Account auth={auth} onOpenLogin={() => openModal("login")} notify={notify} />} />
        <Route path="/redefinir-senha" element={<ResetPassword auth={auth} onOpenLogin={() => openModal("login")} />} />
        <Route path="/admin/*" element={<AdminApp auth={auth} onOpenLogin={() => openModal("login")} notify={notify} />} />
      </Routes>
      </div>
      {!isAdminArea && <Footer onOpenModal={openModal} onCategory={pickCategory} onSearch={(q) => { search(q); navigate('/'); }} />}

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
