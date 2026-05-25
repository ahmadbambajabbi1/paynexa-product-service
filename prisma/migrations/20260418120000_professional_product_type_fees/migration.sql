-- CreateEnum
CREATE TYPE "ProfessionalFeeRole" AS ENUM ('LAWYER', 'AGENT');

-- CreateTable
CREATE TABLE "ProfessionalProductTypeFee" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "product_type_id" TEXT NOT NULL,
    "role" "ProfessionalFeeRole" NOT NULL,
    "fee_amount" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfessionalProductTypeFee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalProductTypeFee_user_id_product_type_id_key" ON "ProfessionalProductTypeFee"("user_id", "product_type_id");

-- CreateIndex
CREATE INDEX "ProfessionalProductTypeFee_user_id_idx" ON "ProfessionalProductTypeFee"("user_id");

-- AddForeignKey
ALTER TABLE "ProfessionalProductTypeFee" ADD CONSTRAINT "ProfessionalProductTypeFee_product_type_id_fkey" FOREIGN KEY ("product_type_id") REFERENCES "ProductType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
