-- Nota fiscal do pedido (manual hoje; Bling depois). PDF/XML guardados no banco — não dependem do volume.
CREATE TABLE "order_invoices" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "number" TEXT,
    "series" TEXT,
    "access_key" TEXT,
    "issued_at" TIMESTAMP(3),
    "pdf_data" BYTEA,
    "pdf_bytes" INTEGER,
    "xml_data" TEXT,
    "external_id" TEXT,
    "external_url" TEXT,
    "sent_at" TIMESTAMP(3),
    "sent_to" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "order_invoices_order_id_key" ON "order_invoices"("order_id");

-- AddForeignKey
ALTER TABLE "order_invoices" ADD CONSTRAINT "order_invoices_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
