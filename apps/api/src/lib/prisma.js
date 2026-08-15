import { PrismaClient } from "@prisma/client";

let client = null;

/** Singleton lazy: só abre o banco quando alguém realmente precisa. */
export function getPrisma() {
  if (!client) {
    client = new PrismaClient({
      log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"]
    });
  }
  return client;
}

export async function disconnectPrisma() {
  if (client) {
    await client.$disconnect();
    client = null;
  }
}
