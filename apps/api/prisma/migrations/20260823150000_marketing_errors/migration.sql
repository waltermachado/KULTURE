-- AlterTable: detalhe das falhas por destinatário (primeiras 50) + provedor usado no envio
ALTER TABLE "marketing_campaigns" ADD COLUMN     "errors" JSONB,
ADD COLUMN     "provider" TEXT;
