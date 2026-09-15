import { isValidCpf, normalizeCpf, CPF_ERROR } from "@kulture/shared/cpf";
import { AppError } from "./errors.js";
export function validatedCpf(value, { required = false } = {}) {
  if (!required && (value == null || value === "")) return null;
  if (!isValidCpf(value)) throw new AppError(400, "INVALID_CPF", CPF_ERROR, { field: "cpf" });
  return normalizeCpf(value);
}
