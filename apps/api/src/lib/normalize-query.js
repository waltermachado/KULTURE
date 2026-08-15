/** "Kobe 6  Protro" → "kobe-6-protro" (chave de cache estável, sem acento). */
export function normalizeQuery(q) {
  return String(q ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}
