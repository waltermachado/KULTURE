import { defineConfig } from "vitest/config";

// Os testes de auth/orders/admin batem no MESMO banco (DATABASE_URL) e o orders.test.js limpa
// as tabelas de pedido no beforeAll — rodar arquivos em paralelo faz um teste apagar o pedido do outro.
// Serializa os arquivos e dá folga de tempo (argon2 + banco remoto).
export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 90_000
  }
});
