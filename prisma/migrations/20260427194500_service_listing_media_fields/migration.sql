-- AlterTable
ALTER TABLE "ServiceListing" ADD COLUMN "cover_image" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "ServiceListing" ADD COLUMN "service_images" JSONB NOT NULL DEFAULT '[]';

