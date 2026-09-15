import { AppError } from "../../lib/errors.js";

// Códigos Kulture, não um catálogo oficial de códigos InfinitePay.
// Nunca encaminhar texto arbitrário do provedor (pode conter dados pessoais).
export function paymentError({ status, operation = "links", reason } = {}) {
  let code = "PAYMENT_UNAVAILABLE";
  let message = "Não conseguimos abrir o pagamento agora. Tente novamente em instantes. Se continuar, fale com a Kulture.";
  let statusCode = 502;
  if (operation === "payment_check") {
    code = "PAYMENT_CHECK_UNAVAILABLE";
    message = "Ainda não conseguimos confirmar o pagamento. Se você já pagou, não pague novamente. Aguarde e consulte seu pedido ou fale com a Kulture.";
  } else if (status === 429) {
    code = "PAYMENT_BUSY";
    message = "O serviço de pagamento está recebendo muitas tentativas. Aguarde um minuto antes de tentar novamente.";
    statusCode = 503;
  } else if ([401, 403, 404].includes(status)) {
    code = "PAYMENT_CONFIGURATION_ERROR";
    message = "O pagamento está indisponível na loja. Fale com a Kulture para continuar sua compra.";
  } else if ([400, 422].includes(status)) {
    code = "PAYMENT_DATA_REJECTED";
    message = "Não conseguimos gerar o pagamento com os dados enviados. Confira nome, e-mail, telefone e endereço. Se estiver tudo certo, fale com a Kulture.";
    statusCode = 422;
  } else if (reason === "timeout") {
    code = "PAYMENT_TIMEOUT";
    message = "O serviço de pagamento demorou para responder. Aguarde um instante e tente novamente.";
    statusCode = 504;
  } else if (reason === "invalid_response") {
    code = "PAYMENT_INVALID_RESPONSE";
  }
  const error = new AppError(statusCode, code, message);
  // Metadados internos seguros, fora da resposta pública.
  error.paymentFailure = { operation, code, ...(status ? { providerStatus: status } : {}), ...(reason ? { reason } : {}) };
  return error;
}
