-- Where the client wants the service performed (navigation for provider).
ALTER TABLE "ServiceBooking" ADD COLUMN IF NOT EXISTS "service_latitude" DOUBLE PRECISION;
ALTER TABLE "ServiceBooking" ADD COLUMN IF NOT EXISTS "service_longitude" DOUBLE PRECISION;
ALTER TABLE "ServiceBooking" ADD COLUMN IF NOT EXISTS "service_address_text" TEXT;
