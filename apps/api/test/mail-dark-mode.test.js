import { describe, expect, it } from 'vitest';
import { preserveEmailColors } from '../src/modules/mail/dark-mode.js';
import { buildOrderRegisteredEmail, buildOrderPaidEmail, buildPasswordResetEmail, buildMarketingEmail } from '../src/modules/mail/mailer.js';

const order = {
  number: 'KLT-PREVIEW', customerName: 'Cliente <teste>', status: 'paid',
  paymentMethod: 'pix', installments: 1, totalBrl: 1999, subtotalBrl: 1999,
  shippingBrl: 0, address: {}, items: [{ name: 'Tênis & teste', brLabel: '41', quantity: 1, unitPriceBrl: 1999 }]
};

describe('cores dos emails no celular', () => {
  it('protege todos os modelos pela moldura compartilhada', () => {
    const emails = [buildOrderRegisteredEmail(order), buildOrderPaidEmail(order),
      buildPasswordResetEmail({ name: 'Cliente', link: 'https://lojakulture.com.br/redefinir-senha?token=teste' }),
      buildMarketingEmail({ subject: 'Novidades', body: 'Confira os pares', siteUrl: 'https://lojakulture.com.br' })];
    for (const { html } of emails) {
      expect(html).toContain('class="km-bg-0b0b0b body"');
      expect(html).toContain('u + .body .km-ink-f4f2ed');
      expect(html).toContain('@media (prefers-color-scheme:dark)');
      expect(html).toContain('background-image:linear-gradient(#0b0b0b,#0b0b0b)');
      expect(html).not.toContain('Nada chega depois');
    }
  });

  it('mantém a cor herdada após negrito e quebra de linha, sem alterar links ou imagens', () => {
    const html = preserveEmailColors('<html><head><style></style></head><body class="body"><p style="color:#8A8880;">Antes <strong style="color:#F4F2ED;">forte</strong><br /> depois <a href="https://example.com/?a=1&amp;b=2" style="color:#FFD31F;">link</a><img src="https://example.com/photo.png" alt="foto" /></p></body></html>');
    expect(html).toContain('<span class="km-ink-8a8880"> depois </span>');
    expect(html).toContain('<span class="km-ink-f4f2ed">forte</span>');
    expect(html).toContain('<span class="km-ink-ffd31f">link</span>');
    expect(html).toContain('href="https://example.com/?a=1&amp;b=2"');
    expect(html).toContain('<img src="https://example.com/photo.png" alt="foto" />');
  });

  it('preserva escape, preheader oculto e texto simples', () => {
    const { html, text } = buildOrderRegisteredEmail(order);
    expect(html).toContain('Cliente &lt;teste&gt;');
    expect(html).not.toContain('<teste>');
    expect(html).toContain('color:transparent;');
    expect(text).toContain('Cliente <teste>');
    expect(text).not.toContain('km-ink');
    expect(html).toContain('background-color:#FFD31F;');
    expect(html).toContain('u + .body .km-ink-0b0b0b');
  });
});
