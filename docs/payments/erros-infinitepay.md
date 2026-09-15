# CPF e mensagens de pagamento

Revisado em 09/09/2026. Implementação local; requer publicação para valer na loja.

## O que a documentação permite afirmar

Fontes oficiais consultadas:
- [Documentação do Checkout](https://www.infinitepay.io/checkout-documentacao)
- [Como usar o Checkout Integrado](https://ajuda.infinitepay.io/pt-BR/articles/10766888-como-usar-o-checkout-integrado-da-infinitepay)

As páginas descrevem criação do link, consulta de pagamento e webhook de aprovação. Não apresentam um catálogo completo de códigos/mensagens de erro de `/links` ou `/payment_check`. O HTTP 400 mostrado na seção de webhook é a resposta **da nossa loja**, para solicitar reenvio; não é um catálogo de recusas da InfinitePay.

Os códigos abaixo são **internos da Kulture**. O tratamento por HTTP é preventivo: não presume motivo específico de recusa bancária. Não foram feitas chamadas de criação de links reais para provocar erros. Corpos desconhecidos do provedor nunca são exibidos ao cliente.

## Tabela implementada

| Situação detectável | Código Kulture | Mensagem ao cliente |
|---|---|---|
| CPF com formato/dígitos inválidos, ou sequência repetida | `INVALID_CPF` | Confira o CPF: informe os 11 números de um CPF válido. |
| Criação do link responde HTTP 400 ou 422 | `PAYMENT_DATA_REJECTED` | Não conseguimos gerar o pagamento com os dados enviados. Confira nome, e-mail, telefone e endereço. Se estiver tudo certo, fale com a Kulture. |
| Criação do link responde HTTP 401, 403 ou 404 | `PAYMENT_CONFIGURATION_ERROR` | O pagamento está indisponível na loja. Fale com a Kulture para continuar sua compra. |
| Criação do link responde HTTP 429 | `PAYMENT_BUSY` | O serviço de pagamento está recebendo muitas tentativas. Aguarde um minuto antes de tentar novamente. |
| Tempo limite de 10 segundos, incluindo leitura do corpo | `PAYMENT_TIMEOUT` | O serviço de pagamento demorou para responder. Aguarde um instante e tente novamente. |
| Resposta de sucesso inválida: HTML, JSON inválido, sem URL HTTPS ou `success:false` | `PAYMENT_INVALID_RESPONSE` | Não conseguimos abrir o pagamento agora. Tente novamente em instantes. Se continuar, fale com a Kulture. |
| Rede indisponível, HTTP 5xx ou outro erro não classificado | `PAYMENT_UNAVAILABLE` | Não conseguimos abrir o pagamento agora. Tente novamente em instantes. Se continuar, fale com a Kulture. |
| Qualquer falha na consulta de confirmação | `PAYMENT_CHECK_UNAVAILABLE` | Ainda não conseguimos confirmar o pagamento. Se você já pagou, não pague novamente. Aguarde e consulte seu pedido ou fale com a Kulture. |
| Consulta válida com `paid:false` | Estado pendente | Aguardando confirmação de pagamento. |
| Valor confirmado diverge do pedido | `mismatch:true` | O valor recebido precisa ser conferido pela Kulture. Não pague novamente. Fale com a gente e informe o número do pedido. |
| Navegador não consegue enviar/ler o checkout | Erro local de conexão | Não conseguimos conectar ao pagamento. Confira sua conexão e tente novamente. |

A confirmação não usa mensagens que incentivem uma nova cobrança. A página oferece “Consultar novamente” quando a consulta falha. No checkout, erros permanecem visíveis e conservam os dados do formulário e o carrinho. Quando existe pedido, sua referência acompanha o erro.

## Erros da tela hospedada pela InfinitePay

Recusa de cartão, limite, antifraude, CPF/titularidade recusados na tela do provedor e Pix expirado não têm retorno individual documentado no contrato consultado. A loja não recebe esses motivos pelo webhook de aprovação. **Não estão classificados automaticamente.** É necessário um retorno real/documentado do provedor para implementar mensagens específicas sem inventar a causa. `paid:false` não significa “cartão recusado”.

## Validação de CPF

Uma função compartilhada verifica os 11 dígitos, rejeita repetições e calcula os dois verificadores pelo módulo 11. Aceita pontuação usual e preserva zeros à esquerda; rejeita letras e valores numéricos em vez de corrigir silenciosamente. Não comprova titularidade, existência ou situação cadastral na Receita.

Servidor: cadastro, edição de perfil, checkout (antes de qualquer pedido/lock), edição de cliente no painel e venda manual. CPF continua opcional nos fluxos em que já era opcional, mas um valor preenchido deve ser válido; no checkout é obrigatório. Cadastros antigos não são alterados automaticamente e são revalidados no checkout.

Navegador: cadastro e checkout mostram erro junto ao formulário; perfil mostra a mensagem de validação antes de salvar. Painel recebe a mesma validação do servidor.

## Diagnóstico e limites

A criação de links não repete automaticamente o POST após falha. Uma nova tentativa manual ainda pode criar um novo pedido, como no fluxo existente; esta alteração não implementa reaproveitamento de pedidos nem altera reservas de estoque.

Falhas na geração geram evento `payment_link_failed` com operação, código Kulture, status HTTP (quando disponível) e motivo técnico categorizado. A resposta pública inclui o número do pedido; não inclui corpo bruto do provedor, CPF, telefone ou credenciais. O registro técnico de erro também omite esses dados. O histórico prévio não permite recuperar retroativamente motivos que não foram gravados.

A integração atual de criação do link envia nome, e-mail, telefone e endereço; **não envia CPF**. Portanto, CPF inválido no cadastro não prova que tenha causado uma falha em `/links`.
