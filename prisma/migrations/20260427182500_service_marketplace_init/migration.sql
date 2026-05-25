-- CreateEnum
CREATE TYPE "ServiceProviderStatus" AS ENUM ('ONLINE', 'OFFLINE', 'AWAY');

-- CreateEnum
CREATE TYPE "ServiceListingPriceType" AS ENUM ('FIXED', 'RANGE');

-- CreateEnum
CREATE TYPE "ServiceBookingStatus" AS ENUM (
  'PENDING_PAYMENT',
  'FUNDED',
  'ACCEPTED',
  'IN_PROGRESS',
  'COMPLETED',
  'DISPUTED',
  'CANCELLED',
  'REFUNDED'
);

-- CreateTable
CREATE TABLE "ServiceCategory" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ServiceCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceProvider" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "display_name" TEXT,
  "bio" TEXT,
  "verification_status" TEXT NOT NULL DEFAULT 'unverified',
  "status" "ServiceProviderStatus" NOT NULL DEFAULT 'OFFLINE',
  "last_seen_at" TIMESTAMP(3),
  "avg_response_time_sec" INTEGER NOT NULL DEFAULT 0,
  "rating_avg" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "rating_count" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ServiceProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceLocation" (
  "id" TEXT NOT NULL,
  "provider_id" TEXT NOT NULL,
  "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL,
  "address_text" TEXT,
  "region" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ServiceLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceListing" (
  "id" TEXT NOT NULL,
  "provider_id" TEXT NOT NULL,
  "category_id" TEXT NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "description" TEXT NOT NULL,
  "tags" JSONB NOT NULL DEFAULT '[]',
  "media" JSONB NOT NULL DEFAULT '[]',
  "price_type" "ServiceListingPriceType" NOT NULL DEFAULT 'FIXED',
  "price_amount" DECIMAL(18,2),
  "price_min" DECIMAL(18,2),
  "price_max" DECIMAL(18,2),
  "estimated_delivery_mins" INTEGER,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ServiceListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceAvailability" (
  "id" TEXT NOT NULL,
  "listing_id" TEXT NOT NULL,
  "day_of_week" INTEGER NOT NULL,
  "start_minute" INTEGER NOT NULL,
  "end_minute" INTEGER NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'Africa/Banjul',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ServiceAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceBooking" (
  "id" TEXT NOT NULL,
  "listing_id" TEXT NOT NULL,
  "client_user_id" TEXT NOT NULL,
  "provider_id" TEXT NOT NULL,
  "scheduled_at" TIMESTAMP(3) NOT NULL,
  "status" "ServiceBookingStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
  "transaction_id" TEXT,
  "escrow_wallet_hold_id" TEXT,
  "amount" DECIMAL(18,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'GMD',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ServiceBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceReview" (
  "id" TEXT NOT NULL,
  "booking_id" TEXT NOT NULL,
  "listing_id" TEXT NOT NULL,
  "provider_id" TEXT NOT NULL,
  "client_user_id" TEXT NOT NULL,
  "rating" INTEGER NOT NULL,
  "comment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ServiceReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCategory_code_key" ON "ServiceCategory"("code");

-- CreateIndex
CREATE INDEX "ServiceCategory_active_sort_order_idx" ON "ServiceCategory"("active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceProvider_user_id_key" ON "ServiceProvider"("user_id");

-- CreateIndex
CREATE INDEX "ServiceProvider_status_rating_avg_idx" ON "ServiceProvider"("status", "rating_avg");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceLocation_provider_id_key" ON "ServiceLocation"("provider_id");

-- CreateIndex
CREATE INDEX "ServiceLocation_latitude_longitude_idx" ON "ServiceLocation"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "ServiceListing_provider_id_active_createdAt_idx" ON "ServiceListing"("provider_id", "active", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ServiceListing_category_id_active_idx" ON "ServiceListing"("category_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceAvailability_listing_id_day_of_week_start_minute_end_minute_key" ON "ServiceAvailability"("listing_id", "day_of_week", "start_minute", "end_minute");

-- CreateIndex
CREATE INDEX "ServiceAvailability_listing_id_day_of_week_idx" ON "ServiceAvailability"("listing_id", "day_of_week");

-- CreateIndex
CREATE INDEX "ServiceBooking_client_user_id_createdAt_idx" ON "ServiceBooking"("client_user_id", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ServiceBooking_provider_id_createdAt_idx" ON "ServiceBooking"("provider_id", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ServiceBooking_listing_id_scheduled_at_idx" ON "ServiceBooking"("listing_id", "scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceReview_booking_id_key" ON "ServiceReview"("booking_id");

-- CreateIndex
CREATE INDEX "ServiceReview_provider_id_createdAt_idx" ON "ServiceReview"("provider_id", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ServiceReview_listing_id_createdAt_idx" ON "ServiceReview"("listing_id", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ServiceReview_rating_idx" ON "ServiceReview"("rating");

-- AddForeignKey
ALTER TABLE "ServiceLocation" ADD CONSTRAINT "ServiceLocation_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "ServiceProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceListing" ADD CONSTRAINT "ServiceListing_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "ServiceProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceListing" ADD CONSTRAINT "ServiceListing_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "ServiceCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceAvailability" ADD CONSTRAINT "ServiceAvailability_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "ServiceListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceBooking" ADD CONSTRAINT "ServiceBooking_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "ServiceListing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceBooking" ADD CONSTRAINT "ServiceBooking_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "ServiceProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceReview" ADD CONSTRAINT "ServiceReview_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "ServiceBooking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceReview" ADD CONSTRAINT "ServiceReview_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "ServiceListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceReview" ADD CONSTRAINT "ServiceReview_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "ServiceProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

