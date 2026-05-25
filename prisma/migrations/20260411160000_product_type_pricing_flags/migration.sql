-- AlterTable
ALTER TABLE "ProductType" ADD COLUMN "lawyer_pricing_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ProductType" ADD COLUMN "agent_pricing_enabled" BOOLEAN NOT NULL DEFAULT false;
