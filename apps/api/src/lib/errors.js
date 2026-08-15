/**
 * Erro de aplicação com código estável para o frontend.
 * Formato de resposta padrão: { code, message, details? }
 */
export class AppError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  static badRequest(message, details) {
    return new AppError(400, "BAD_REQUEST", message, details);
  }
  static notFound(message = "Recurso não encontrado") {
    return new AppError(404, "NOT_FOUND", message);
  }
  static upstream(message, details) {
    return new AppError(502, "UPSTREAM_UNAVAILABLE", message, details);
  }
}

/** Handler global registrado no Fastify. */
export function errorHandler(error, request, reply) {
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({
      code: error.code,
      message: error.message,
      ...(error.details !== undefined ? { details: error.details } : {})
    });
  }

  // Erros de validação de schema do Fastify
  if (error.validation) {
    return reply.status(400).send({
      code: "VALIDATION_ERROR",
      message: "Parâmetros inválidos",
      details: error.validation.map((v) => ({ path: v.instancePath || v.params?.missingProperty, message: v.message }))
    });
  }

  const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
  if (status >= 500) request.log.error({ err: error }, "erro não tratado");
  return reply.status(status).send({
    code: status >= 500 ? "INTERNAL_ERROR" : error.code || "ERROR",
    message: status >= 500 ? "Erro interno" : error.message
  });
}
