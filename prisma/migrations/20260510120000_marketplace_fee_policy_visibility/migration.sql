-- CreateEnum
CREATE TYPE "CatalogListingVisibility" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateTable
CREATE TABLE "ServiceMarketplaceFeePolicy" (
    "id" TEXT NOT NULL,
    "provider_fee_enabled" BOOLEAN NOT NULL DEFAULT false,
    "provider_fee_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "customer_fee_enabled" BOOLEAN NOT NULL DEFAULT false,
    "customer_fee_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceMarketplaceFeePolicy_pkey" PRIMARY KEY ("id")
);

INSERT INTO "ServiceMarketplaceFeePolicy" ("id", "provider_fee_enabled", "provider_fee_percent", "customer_fee_enabled", "customer_fee_percent", "updated_at")
VALUES ('default', false, 0, false, 0, CURRENT_TIMESTAMP);

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "visibility" "CatalogListingVisibility" NOT NULL DEFAULT 'PUBLISHED';

-- AlterTable
ALTER TABLE "ServiceListing" ADD COLUMN "visibility" "CatalogListingVisibility" NOT NULL DEFAULT 'PUBLISHED';

-- AlterTable
ALTER TABLE "ServiceBooking" ADD COLUMN "customer_platform_fee_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN "provider_platform_fee_amount" DECIMAL(18,2) NOT NULL DEFAULT 0;

DROP INDEX IF EXISTS "Product_seller_user_id_createdAt_idx";

CREATE INDEX "Product_seller_user_id_visibility_createdAt_idx" ON "Product"("seller_user_id", "visibility", "createdAt" DESC);

DROP INDEX IF EXISTS "ServiceListing_provider_id_active_createdAt_idx";

CREATE INDEX "ServiceListing_provider_id_active_visibility_createdAt_idx" ON "ServiceListing"("provider_id", "active", "visibility", "createdAt" DESC);

DROP INDEX IF EXISTS "ServiceListing_category_id_active_idx";

CREATE INDEX "ServiceListing_category_id_active_visibility_idx" ON "ServiceListing"("category_id", "active", "visibility");
