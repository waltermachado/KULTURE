/**
 * Configuração pública do site (o que o front precisa saber e não é segredo).
 *   GET /api/config → { whatsapp: { phone, url } | null, installments: { max, label }, stock: { enabled }, testProduct }
 * `WHATSAPP_CONTACT_PHONE` = número com DDI, só dígitos (ex.: 5511999998888). Sem ele, `whatsapp` = null e o
 * front esconde o botão "chamar no WhatsApp" (o aviso de "não achou?" continua, sem link).
 */
export async function configRoutes(app) {
  app.get(
    "/api/config",
    { schema: { tags: ["catalog"], summary: "Configuração pública do site (WhatsApp de contato, parcelas)" } },
    async () => {
      const phone = app.env.WHATSAPP_CONTACT_PHONE || null;
      const max = Math.max(1, Number(app.env.MAX_INSTALLMENTS || 12));
      return {
        whatsapp: phone ? { phone, url: `https://wa.me/${phone}` } : null,
        installments: { max, label: `em até ${max}x no cartão com juros` },
        stock: { enabled: Boolean(app.stock) },
        testProduct: Boolean(app.env.TEST_PRODUCT_ENABLED)
      };
    }
  );
}
