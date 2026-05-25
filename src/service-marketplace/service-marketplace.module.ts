import { Module } from '@nestjs/common';
import { InternalSecretGuard } from '../internal/internal-secret.guard';
import { ServiceMarketplaceController } from './service-marketplace.controller';
import { ServiceMarketplaceService } from './service-marketplace.service';
import { InternalServiceMarketplaceController } from './internal/internal-service-marketplace.controller';
import { MarketplaceUserSummaryClient } from './marketplace-user-summary.client';
import { R2UploadService } from '../products/r2-upload.service';
import { BookingRealtimeGateway } from './booking-realtime.gateway';

@Module({
  controllers: [
    ServiceMarketplaceController,
    InternalServiceMarketplaceController,
  ],
  providers: [
    ServiceMarketplaceService,
    MarketplaceUserSummaryClient,
    InternalSecretGuard,
    R2UploadService,
    BookingRealtimeGateway,
  ],
})
export class ServiceMarketplaceModule {}
