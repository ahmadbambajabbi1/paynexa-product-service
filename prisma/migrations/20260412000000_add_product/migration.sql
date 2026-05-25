-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "seller_user_id" TEXT NOT NULL,
    "product_type_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "product_images" JSONB NOT NULL,
    "other_images" JSONB NOT NULL,
    "attributes" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Product_seller_user_id_createdAt_idx" ON "Product"("seller_user_id", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Product_product_type_id_idx" ON "Product"("product_type_id");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_product_type_id_fkey" FOREIGN KEY ("product_type_id") REFERENCES "ProductType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
