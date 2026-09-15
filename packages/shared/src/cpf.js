/** Valida somente formato e dígitos verificadores; não consulta situação cadastral/titularidade. */
export const CPF_ERROR = "Confira o CPF: informe os 11 números de um CPF válido.";
export function normalizeCpf(value) {
  return typeof value === "string" ? value.replace(/[.\-\s]/g, "") : "";
}
export function isValidCpf(value) {
  const cpf = normalizeCpf(value);
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  for (let length = 9; length <= 10; length++) {
    let sum = 0;
    for (let i = 0; i < length; i++) sum += Number(cpf[i]) * (length + 1 - i);
    const remainder = sum % 11;
    if (Number(cpf[length]) !== (remainder < 2 ? 0 : 11 - remainder)) return false;
  }
  return true;
}
