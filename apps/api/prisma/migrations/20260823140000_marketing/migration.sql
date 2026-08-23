-- AlterTable: opt-in de marketing por usuário (padrão: recebe; o link de descadastro desliga)
ALTER TABLE "users" ADD COLUMN     "marketing_opt_in" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable: descadastros (também cobre quem comprou como convidado)
CREATE TABLE "marketing_unsubscribes" (
    "email" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'link',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketing_unsubscribes_pkey" PRIMARY KEY ("email")
);

-- CreateTable: campanhas enviadas pelo backoffice
CREATE TABLE "marketing_campaigns" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "cta_label" TEXT,
    "cta_url" TEXT,
    "image_url" TEXT,
    "audience" TEXT NOT NULL DEFAULT 'all',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "total" INTEGER NOT NULL DEFAULT 0,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "marketing_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "marketing_campaigns_created_at_idx" ON "marketing_campaigns"("created_at");
