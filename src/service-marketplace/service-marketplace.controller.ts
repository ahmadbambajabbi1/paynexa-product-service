import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  OptionalSessionAuthGuard,
  type OptionalAuthedRequest,
} from '../auth/optional-session-auth.guard';
import {
  SessionAuthGuard,
  type AuthedRequest,
} from '../auth/session-auth.guard';
import type { MemoryUploadedFile } from '../products/product-image-mime.util';
import { CreateServiceListingDto } from './dto/create-service-listing.dto';
import { PutServiceAvailabilityDto } from './dto/put-service-availability.dto';
import { SearchServiceListingsDto } from './dto/search-service-listings.dto';
import { SetProviderStatusDto } from './dto/set-provider-status.dto';
import { ServiceListingCompleteMetadataDto } from './dto/service-listing-complete-metadata.dto';
import {
  UpdateServiceBookingDto,
} from './dto/update-service-booking.dto';
import { UpdateServiceListingDto } from './dto/update-service-listing.dto';
import { RenderingLocationDto } from './dto/rendering-location.dto';
import { UpsertProviderProfileDto } from './dto/upsert-provider-profile.dto';
import { CreateServiceReviewDto } from './dto/create-service-review.dto';
import { ServiceMarketplaceService } from './service-marketplace.service';

@Controller('service-marketplace')
export class ServiceMarketplaceController {
  constructor(private readonly sm: ServiceMarketplaceService) {}

  private parseMultipartMetadata<T extends object>(
    cls: new () => T,
    raw: unknown,
  ): T {
    if (typeof raw !== 'string' || !raw.trim()) {
      throw new BadRequestException('Missing metadata (JSON string)');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BadRequestException('metadata must be valid JSON');
    }
    const meta = plainToInstance(cls, parsed);
    const errs = validateSync(meta as object, {
      whitelist: true,
      forbidNonWhitelisted: false,
    });
    if (errs.length) {
      const parts = errs.flatMap((e) => Object.values(e.constraints ?? {}));
      throw new BadRequestException(parts.join('; ') || 'Invalid metadata');
    }
    return meta;
  }

  @Get('categories')
  listCategories() {
    return this.sm.listCategories();
  }

  /** Active percentage flags for optional fees (customer vs provider). Used by checkout UI. */
  @Get('platform-service-fees')
  platformServiceFees() {
    return this.sm.getPublicMarketplaceFeePolicy();
  }

  @Get('listings/search')
  search(@Query() query: SearchServiceListingsDto) {
    return this.sm.searchListings(query);
  }

  @Get('listings/me')
  @UseGuards(SessionAuthGuard)
  listMyListings(@Req() req: AuthedRequest) {
    return this.sm.listMyListings(req.user.id);
  }

  @Get('listings/:id')
  @UseGuards(OptionalSessionAuthGuard)
  getListing(@Param('id') id: string, @Req() req: OptionalAuthedRequest) {
    return this.sm.getListing(id, req.user?.id);
  }

  @Post('providers/me')
  @UseGuards(SessionAuthGuard)
  upsertMyProvider(
    @Req() req: AuthedRequest,
    @Body() dto: UpsertProviderProfileDto,
  ) {
    return this.sm.upsertMyProviderProfile(req.user.id, dto);
  }

  @Put('providers/me/status')
  @UseGuards(SessionAuthGuard)
  setMyStatus(@Req() req: AuthedRequest, @Body() dto: SetProviderStatusDto) {
    return this.sm.setMyProviderStatus(req.user.id, dto);
  }

  @Post('providers/me/ping')
  @UseGuards(SessionAuthGuard)
  ping(@Req() req: AuthedRequest) {
    return this.sm.pingMyProvider(req.user.id);
  }

  @Patch('providers/me/rendering-location')
  @UseGuards(SessionAuthGuard)
  pingRenderingLocation(
    @Req() req: AuthedRequest,
    @Body() dto: RenderingLocationDto,
  ) {
    return this.sm.pingRenderingLocation(
      req.user.id,
      dto.latitude,
      dto.longitude,
      dto.locationLabel,
    );
  }

  @Post('listings')
  @UseGuards(SessionAuthGuard)
  createListing(
    @Req() req: AuthedRequest,
    @Body() dto: CreateServiceListingDto,
  ) {
    return this.sm.createListing(req.user.id, dto);
  }

  @Post('listings/complete')
  @UseGuards(SessionAuthGuard)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'cover', maxCount: 1 },
        { name: 'gallery', maxCount: 24 },
      ],
      { limits: { fileSize: 15 * 1024 * 1024 } },
    ),
  )
  async createListingComplete(
    @Req() req: AuthedRequest,
    @UploadedFiles()
    files: { cover?: MemoryUploadedFile[]; gallery?: MemoryUploadedFile[] },
    @Body('metadata') metadataRaw: unknown,
  ) {
    const meta = this.parseMultipartMetadata(
      ServiceListingCompleteMetadataDto,
      metadataRaw,
    );
    const cover = files.cover?.[0];
    if (!cover?.buffer?.length) {
      throw new BadRequestException('Missing cover file');
    }
    const gallery = files.gallery ?? [];
    if (gallery.length < 1) {
      throw new BadRequestException('At least one gallery image is required');
    }
    return this.sm.createListingComplete(req.user.id, meta, cover, gallery);
  }

  @Patch('listings/:id')
  @UseGuards(SessionAuthGuard)
  updateListing(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateServiceListingDto,
  ) {
    return this.sm.updateListing(req.user.id, id, dto);
  }

  @Post('listings/:id/publish')
  @UseGuards(SessionAuthGuard)
  publishListing(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.sm.publishMyServiceListing(req.user.id, id);
  }

  @Put('listings/:id/availability')
  @UseGuards(SessionAuthGuard)
  putAvailability(
    @Req() req: AuthedRequest,
    @Param('id') listingId: string,
    @Body() dto: PutServiceAvailabilityDto,
  ) {
    return this.sm.putListingAvailability(req.user.id, listingId, dto);
  }

  @Post('listings/:id/bookings')
  @UseGuards(SessionAuthGuard)
  createBooking(
    @Req() req: AuthedRequest,
    @Param('id') listingId: string,
    @Body()
    body: {
      scheduledAt?: string;
      agreedAmount?: number;
      notes?: string;
      serviceLatitude?: number;
      serviceLongitude?: number;
      serviceAddressText?: string;
      serviceLocationLabel?: string;
      serviceGooglePlaceId?: string;
    },
  ) {
    return this.sm.createBooking(req.user.id, listingId, {
      scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined,
      agreedAmount: body.agreedAmount,
      notes: body.notes,
      serviceLatitude: body.serviceLatitude,
      serviceLongitude: body.serviceLongitude,
      serviceAddressText: body.serviceAddressText,
      serviceLocationLabel: body.serviceLocationLabel,
      serviceGooglePlaceId: body.serviceGooglePlaceId,
    });
  }

  @Get('bookings/me')
  @UseGuards(SessionAuthGuard)
  listMyBookings(@Req() req: AuthedRequest) {
    return this.sm.listBookingsForClient(req.user.id);
  }

  @Get('bookings/provider')
  @UseGuards(SessionAuthGuard)
  listProviderBookings(@Req() req: AuthedRequest) {
    return this.sm.listBookingsForProviderUser(req.user.id);
  }

  @Get('listings/:id/bookings')
  @UseGuards(SessionAuthGuard)
  listBookingsForListing(
    @Req() req: AuthedRequest,
    @Param('id') listingId: string,
  ) {
    return this.sm.listBookingsForListingOwner(req.user.id, listingId);
  }

  @Patch('bookings/:id/state')
  @UseGuards(SessionAuthGuard)
  updateBookingState(
    @Req() req: AuthedRequest,
    @Param('id') bookingId: string,
    @Body() dto: UpdateServiceBookingDto,
  ) {
    return this.sm.updateBookingState(req.user.id, bookingId, dto);
  }

  @Post('bookings/:id/review')
  @UseGuards(SessionAuthGuard)
  submitBookingReview(
    @Req() req: AuthedRequest,
    @Param('id') bookingId: string,
    @Body() dto: CreateServiceReviewDto,
  ) {
    return this.sm.submitBookingReview(req.user.id, bookingId, dto);
  }
}
