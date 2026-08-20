import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import PasswordInput from "../components/PasswordInput.jsx";
import { brl, sizeText, customText } from "../lib/format.js";

export default function Checkout({ cart, auth, notify, onOpenLogin }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  // convidado pode criar a conta AQUI mesmo (opcional, marcado por padrão): registra com os dados do
  // formulário + senha e o pedido já nasce vinculado; desmarcado, segue como convidado (comportamento antigo).
  const [account, setAccount] = useState({ create: true, password: "", confirm: "" });
  const [accountErr, setAccountErr] = useState(null); // "taken" = e-mail já tem conta | texto livre
  const fromUser = (u) => ({
    name: u?.name || "",
    email: u?.email || "",
    phone: u?.phone || "",
    cpf: u?.cpf || "",
    cep: u?.address?.cep || "",
    city: u?.address?.city || "",
    state: u?.address?.state || "",
    street: u?.address?.street || "",
    number: u?.address?.number || "",
    neighborhood: u?.address?.neighborhood || "",
    complement: u?.address?.complement || ""
  });
  const [form, setForm] = useState(() => fromUser(auth.user));

  // Se a sessão chegar depois (refresh via cookie), pré-preenche só os campos ainda vazios.
  useEffect(() => {
    if (!auth.user) return;
    const u = fromUser(auth.user);
    setForm((f) => Object.fromEntries(Object.keys(f).map((k) => [k, f[k] || u[k]])));
  }, [auth.user]);

  // contrato do useCart: list = [{ key, item, sizeInfo, qty }], total já é a soma dos itens
  const lines = cart.list ?? [];
  const subtotal = cart.total ?? 0;
  const shipping = 0; // frete embutido no preço — cliente vê "Grátis"

  const handleChange = (e) => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  const handleCepBlur = async (e) => {
    const cep = e.target.value.replace(/\D/g, "");
    if (cep.length === 8) {
      try {
        const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
        const data = await res.json();
        if (!data.erro) {
          setForm(f => ({
            ...f,
            street: data.logradouro,
            neighborhood: data.bairro,
            city: data.localidade,
            state: data.uf
          }));
        }
      } catch (err) {
        // ignore
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (lines.length === 0) return notify("Seu carrinho está vazio");
    setAccountErr(null);

    const addressPayload = {
      cep: form.cep.replace(/\D/g, ""),
      street: form.street,
      number: form.number,
      complement: form.complement,
      neighborhood: form.neighborhood,
      city: form.city,
      state: form.state
    };

    // convidado que marcou "criar conta": valida a senha e registra ANTES do pedido — o checkout
    // segue autenticado e o pedido cai direto em "Meus pedidos"
    let token = auth.user ? auth.getToken?.() : null;
    if (!auth.user && account.create) {
      if (account.password.length < 8) return setAccountErr("A senha precisa ter pelo menos 8 caracteres");
      if (account.password !== account.confirm) return setAccountErr("As senhas não coincidem");
      setLoading(true);
      try {
        await auth.register({
          email: form.email,
          password: account.password,
          name: form.name,
          cpf: form.cpf.replace(/\D/g, ""),
          phone: form.phone,
          address: addressPayload
        });
        token = auth.getToken?.();
        notify("Conta criada! 🎉");
      } catch (err) {
        setLoading(false);
        if (err.code === "EMAIL_TAKEN" || err.status === 409) return setAccountErr("taken");
        return setAccountErr(err.message || "Não foi possível criar a conta");
      }
    } else {
      setLoading(true);
    }
    
    // Idempotency Key pra evitar duplicidade se o usuário clicar 2x
    const idempotencyKey = crypto.randomUUID();

    const payload = {
      items: lines.map((l) => ({
        styleColor: l.item.styleColor,
        nikeSize: l.sizeInfo.nikeSize,
        quantity: l.qty,
        // modelagem escolhida (Masculino/Feminino/Infantil) e, no Nike By You, a personalização por pé
        ...(l.sizeInfo.pickedGender ? { sizeGender: l.sizeInfo.pickedGender } : {}),
        ...(l.sizeInfo.customization ? { customization: l.sizeInfo.customization } : {})
      })),
      customer: { name: form.name, email: form.email, phone: form.phone, cpf: form.cpf.replace(/\D/g, "") },
      address: addressPayload
    };

    try {
      // caminho relativo: em dev o Vite faz proxy de /api; em produção a api serve o front (mesma origem)
      const res = await fetch("/api/checkout", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
          ...(token ? { Authorization: `Bearer ${token}` } : {}) // logado ou conta recém-criada acima
        },
        body: JSON.stringify(payload)
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Erro no checkout");
      
      cart.clear();
      // Redireciona para o gateway
      window.location.href = data.checkoutUrl;
    } catch (err) {
      notify(err.message);
      setLoading(false);
    }
  };

  if (lines.length === 0) {
    return (
      <main style={{ padding: "100px 20px", textAlign: "center", minHeight: "60vh" }}>
        <h2>Seu carrinho está vazio.</h2>
        <button className="btn btn-primary" onClick={() => navigate("/")} style={{ marginTop: 20 }}>Voltar às compras</button>
      </main>
    );
  }

  return (
    <main className="checkout-page">
      <section>
        <h2 style={{ marginBottom: 24, fontSize: 24 }}>Finalizar Compra</h2>
        <form id="checkout-form" onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          
          <div className="form-section">
            <h3 style={{ marginBottom: 12, fontSize: 18, color: "var(--k-yellow)" }}>Dados Pessoais</h3>
            <input name="name" placeholder="Nome Completo" value={form.name} onChange={handleChange} required />
            <input name="email" type="email" placeholder="E-mail" value={form.email} onChange={handleChange} required />
            <div style={{ display: "flex", gap: 10 }}>
              <input name="cpf" placeholder="CPF (Apenas números)" value={form.cpf} onChange={handleChange} maxLength="14" required />
              <input name="phone" placeholder="WhatsApp (DDD + Número)" value={form.phone} onChange={handleChange} required />
            </div>
          </div>

          {!auth.user && (
            <div className="form-section co-account">
              <label className="check" style={{ margin: 0 }}>
                <input
                  type="checkbox"
                  checked={account.create}
                  onChange={(e) => { setAccount((a) => ({ ...a, create: e.target.checked })); setAccountErr(null); }}
                />
                <span><b>Criar minha conta com esses dados</b> — acompanhe o pedido em "Meus pedidos", sem redigitar nada na próxima compra.</span>
              </label>
              {account.create && (
                <div style={{ display: "flex", gap: 10 }}>
                  <PasswordInput
                    placeholder="Crie uma senha (mín. 8 caracteres)"
                    value={account.password}
                    onChange={(e) => { setAccount((a) => ({ ...a, password: e.target.value })); setAccountErr(null); }}
                    autoComplete="new-password"
                    required
                  />
                  <PasswordInput
                    placeholder="Repita a senha"
                    value={account.confirm}
                    onChange={(e) => { setAccount((a) => ({ ...a, confirm: e.target.value })); setAccountErr(null); }}
                    autoComplete="new-password"
                    required
                  />
                </div>
              )}
              {accountErr === "taken" ? (
                <p className="co-account-err">
                  Este e-mail já tem conta na Kulture.{" "}
                  <button type="button" onClick={() => onOpenLogin?.()}>Entrar com essa conta</button>{" "}
                  — ou desmarque a opção acima para comprar sem entrar (o pedido é vinculado pelo e-mail do mesmo jeito).
                </p>
              ) : accountErr ? (
                <p className="co-account-err">{accountErr}</p>
              ) : null}
            </div>
          )}

          <div className="form-section">
            <h3 style={{ marginBottom: 12, fontSize: 18, color: "var(--k-yellow)" }}>Entrega</h3>
            <div style={{ display: "flex", gap: 10 }}>
              <input name="cep" placeholder="CEP" value={form.cep} onChange={handleChange} onBlur={handleCepBlur} maxLength="9" required />
              <input name="city" placeholder="Cidade" value={form.city} onChange={handleChange} readOnly style={{ flex: 1, backgroundColor: "#222" }} />
              <input name="state" placeholder="UF" value={form.state} onChange={handleChange} readOnly style={{ width: 60, backgroundColor: "#222" }} />
            </div>
            <input name="street" placeholder="Rua / Avenida" value={form.street} onChange={handleChange} required />
            <div style={{ display: "flex", gap: 10 }}>
              <input name="number" placeholder="Número" value={form.number} onChange={handleChange} required />
              <input name="complement" placeholder="Complemento (Opcional)" value={form.complement} onChange={handleChange} />
            </div>
            <input name="neighborhood" placeholder="Bairro" value={form.neighborhood} onChange={handleChange} required />
          </div>

        </form>
      </section>

      <aside className="checkout-summary">
        <h3 style={{ marginBottom: 20 }}>Resumo do Pedido</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 24 }}>
          {lines.map(({ key, item, sizeInfo, qty }) => (
            <div key={key} style={{ display: "flex", gap: 12, fontSize: 14 }}>
              <img src={item.img} alt={item.name} style={{ width: 50, height: 50, objectFit: "cover", borderRadius: 4, background: "#222" }} />
              <div>
                <div style={{ fontWeight: 600 }}>{item.name}{item.launch?.comingSoon ? <em className="tag-pre">Pré-venda</em> : null}{item.stock ? <em className="tag-pre tag-stock">Pronta entrega</em> : null}</div>
                <div style={{ color: "#888", fontSize: 12 }}>Tam: {sizeText(sizeInfo)} × {qty}</div>
                {customText(sizeInfo?.customization) && <div style={{ color: "#888", fontSize: 12 }}>By You · {customText(sizeInfo.customization)}</div>}
                <div style={{ color: "var(--k-yellow)", fontWeight: 700 }}>{brl((item.price || 0) * qty)}</div>
              </div>
            </div>
          ))}
        </div>
        
        <div style={{ borderTop: "1px solid #333", paddingTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Subtotal</span>
            <span>{brl(subtotal)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Frete</span>
            <span style={{ color: "var(--k-green)" }}>Grátis</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 18, fontWeight: 700, color: "var(--k-yellow)" }}>
            <span>Total no Pix</span>
            <span>{brl(subtotal)}</span>
          </div>
        </div>

        <button 
          form="checkout-form"
          type="submit" 
          className="btn btn-primary" 
          style={{ width: "100%", marginTop: 24, fontSize: 16, padding: "16px 0" }}
          disabled={loading}
        >
          {loading ? "Processando..." : "Ir para o Pagamento"}
        </button>
        <p style={{ textAlign: "center", fontSize: 12, color: "#666", marginTop: 12 }}>
          Ambiente 100% seguro via InfinitePay.
        </p>
      </aside>
    </main>
  );
}
