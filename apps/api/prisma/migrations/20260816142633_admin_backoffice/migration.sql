-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "cancelled_at" TIMESTAMP(3),
ADD COLUMN     "carrier" TEXT,
ADD COLUMN     "delivered_at" TIMESTAMP(3),
ADD COLUMN     "internal_notes" TEXT,
ADD COLUMN     "refunded_at" TIMESTAMP(3),
ADD COLUMN     "shipped_at" TIMESTAMP(3),
ADD COLUMN     "tracking_code" TEXT,
ADD COLUMN     "tracking_url" TEXT;

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "requested_by" TEXT NOT NULL DEFAULT 'self',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
