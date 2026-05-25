-- Human-readable picked location + optional Google Places id
ALTER TABLE "ServiceBooking" ADD COLUMN IF NOT EXISTS "service_location_label" TEXT;
ALTER TABLE "ServiceBooking" ADD COLUMN IF NOT EXISTS "service_google_place_id" TEXT;
